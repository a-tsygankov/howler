// Pure urgency-tier computation for the unified dashboard. Each
// task is classified URGENT / NON_URGENT / HIDDEN from its schedule
// rule, the schedule's modifiedAt (acts as a creation/edit "reset"),
// and the task's most recent execution timestamp — no DB, no clock,
// no occurrence rows. The point is to give every client (web, dial,
// future native) the exact same view of "what to show right now"
// without depending on the cron→queue→occurrence pipeline having
// fired anything.
//
// Logic (matches the spec the user wrote, m-2026-05-06):
//  - Compute prev_deadline (most recent scheduled deadline ≤ now)
//    and next_deadline (next scheduled deadline > now).
//  - period = next_deadline - prev_deadline for recurring rules,
//    deadline - modifiedAt for ONESHOT.
//  - If prev_deadline > max(modifiedAt, lastExecutionAt): the prior
//    slot was missed → URGENT.
//  - Otherwise compare time-remaining to next_deadline against
//    period: ≤ 25 % → URGENT, ≤ 50 % → NON_URGENT, > 50 % → HIDDEN.
//  - "First expected execution": if modifiedAt > prev_deadline we
//    treat the task as if it were completed at prev_deadline.
//    Newly-created tasks therefore never show up as "missed".

import type { ScheduleRule } from "../shared/schemas.ts";

const DAY_SEC = 24 * 60 * 60;

export type Urgency = "URGENT" | "NON_URGENT" | "HIDDEN";

export interface UrgencyInput {
  rule: ScheduleRule;
  // Schedule.modified_at — the "reset" anchor. The schema enforces
  // NOT NULL on every entity's updated_at, so this is always a
  // concrete epoch second.
  scheduleModifiedAt: number;
  // Set on ONESHOT tasks only (mirrors tasks.deadline_hint).
  oneshotDeadline: number | null;
  // Latest task_executions.ts for this task, or null if never run.
  lastExecutionAt: number | null;
  nowSec: number;
}

export interface UrgencyResult {
  urgency: Urgency;
  prevDeadline: number | null;
  nextDeadline: number | null;
  periodSec: number | null;
  isMissed: boolean;
  secondsUntilNext: number | null;
}

export const computeUrgency = (input: UrgencyInput): UrgencyResult => {
  const {
    rule,
    scheduleModifiedAt,
    oneshotDeadline,
    lastExecutionAt,
    nowSec,
  } = input;

  if (rule.kind === "ONESHOT") {
    return urgencyForOneshot(
      oneshotDeadline,
      scheduleModifiedAt,
      lastExecutionAt,
      nowSec,
      rule.intervalDays ?? null,
    );
  }

  // DAILY / PERIODIC: anchored on the rule + modifiedAt.
  const next = computeNextDeadline(rule, scheduleModifiedAt, nowSec);
  if (next === null) {
    return {
      urgency: "HIDDEN",
      prevDeadline: null,
      nextDeadline: null,
      periodSec: null,
      isMissed: false,
      secondsUntilNext: null,
    };
  }
  const prev = computePrevDeadline(rule, scheduleModifiedAt, nowSec);
  const period =
    rule.kind === "PERIODIC"
      ? rule.intervalDays * DAY_SEC
      : prev !== null
        ? next - prev
        : DAY_SEC; // DAILY with no prev slot today — fall back to 24 h

  const completedReference = Math.max(
    scheduleModifiedAt,
    lastExecutionAt ?? Number.NEGATIVE_INFINITY,
  );
  const isMissed = prev !== null && prev > completedReference;

  if (isMissed) {
    return {
      urgency: "URGENT",
      prevDeadline: prev,
      nextDeadline: next,
      periodSec: period,
      isMissed: true,
      secondsUntilNext: next - nowSec,
    };
  }

  // Did the user already complete *this* cycle? If lastExecution
  // landed after the previous deadline, the current next deadline
  // is effectively satisfied — shift the urgency window forward by
  // one cycle so the row drops off until the *next* one approaches.
  // Without this, completing a task while we're already inside the
  // last 25 % of its window leaves it stuck on URGENT (next slot
  // is still close, even though the user just did it).
  const completedThisCycle =
    prev !== null &&
    lastExecutionAt !== null &&
    lastExecutionAt >= prev;
  if (completedThisCycle) {
    const nextNext = computeNextDeadlineAfter(rule, scheduleModifiedAt, next);
    if (nextNext === null) {
      return {
        urgency: "HIDDEN",
        prevDeadline: next,
        nextDeadline: null,
        periodSec: period,
        isMissed: false,
        secondsUntilNext: null,
      };
    }
    const shiftedPeriod =
      rule.kind === "PERIODIC" ? period : nextNext - next;
    const remaining = nextNext - nowSec;
    const fraction = shiftedPeriod > 0 ? remaining / shiftedPeriod : 0;
    return {
      urgency: tierFromFraction(fraction),
      prevDeadline: next,
      nextDeadline: nextNext,
      periodSec: shiftedPeriod,
      isMissed: false,
      secondsUntilNext: remaining,
    };
  }

  const remaining = next - nowSec;
  const fraction = period > 0 ? remaining / period : 0;
  return {
    urgency: tierFromFraction(fraction),
    prevDeadline: prev,
    nextDeadline: next,
    periodSec: period,
    isMissed: false,
    secondsUntilNext: remaining,
  };
};

// computeNextDeadline anchored at `after` instead of `nowSec` —
// returns the first scheduled deadline strictly after `after`.
const computeNextDeadlineAfter = (
  rule: ScheduleRule,
  scheduleModifiedAt: number,
  after: number,
): number | null => computeNextDeadline(rule, scheduleModifiedAt, after);

const tierFromFraction = (fraction: number): Urgency => {
  if (fraction <= 0.25) return "URGENT";
  if (fraction <= 0.5) return "NON_URGENT";
  return "HIDDEN";
};

const urgencyForOneshot = (
  deadline: number | null,
  modifiedAt: number,
  lastExecutionAt: number | null,
  nowSec: number,
  intervalDays: number | null,
): UrgencyResult => {
  if (deadline === null) {
    return {
      urgency: "HIDDEN",
      prevDeadline: null,
      nextDeadline: null,
      periodSec: null,
      isMissed: false,
      secondsUntilNext: null,
    };
  }

  // ── ONESHOT with reminder cadence ─────────────────────────────
  // Behaves like a PERIODIC every `intervalDays` between modifiedAt
  // and the deadline. Each cadence cycle is its own "deadline" for
  // urgency purposes. After the actual deadline: missed unless the
  // user executed at any point post-modification.
  if (intervalDays !== null && intervalDays > 0) {
    const cycle = intervalDays * DAY_SEC;
    if (nowSec >= deadline) {
      // Past the absolute deadline.
      const completed =
        lastExecutionAt !== null && lastExecutionAt >= modifiedAt;
      if (completed) {
        return {
          urgency: "HIDDEN",
          prevDeadline: deadline,
          nextDeadline: null,
          periodSec: cycle,
          isMissed: false,
          secondsUntilNext: null,
        };
      }
      return {
        urgency: "URGENT",
        prevDeadline: deadline,
        nextDeadline: null,
        periodSec: cycle,
        isMissed: true,
        secondsUntilNext: 0,
      };
    }
    // Find the next cadence cycle (capped at the deadline).
    const elapsed = nowSec - modifiedAt;
    let next: number;
    let prev: number | null;
    if (elapsed <= 0) {
      next = Math.min(modifiedAt + cycle, deadline);
      prev = null;
    } else {
      const kNext = Math.floor(elapsed / cycle) + 1;
      next = Math.min(modifiedAt + kNext * cycle, deadline);
      const kPrev = Math.ceil(elapsed / cycle) - 1;
      prev = kPrev >= 1 ? modifiedAt + kPrev * cycle : null;
    }
    const completedRef = Math.max(
      modifiedAt,
      lastExecutionAt ?? Number.NEGATIVE_INFINITY,
    );
    const isMissed = prev !== null && prev > completedRef;
    if (isMissed) {
      return {
        urgency: "URGENT",
        prevDeadline: prev,
        nextDeadline: next,
        periodSec: cycle,
        isMissed: true,
        secondsUntilNext: next - nowSec,
      };
    }
    const remaining = next - nowSec;
    const fraction = cycle > 0 ? remaining / cycle : 0;
    return {
      urgency: tierFromFraction(fraction),
      prevDeadline: prev,
      nextDeadline: next,
      periodSec: cycle,
      isMissed: false,
      secondsUntilNext: remaining,
    };
  }

  // ── ONESHOT without cadence — single deadline, no reminders ───
  // Period is deadline − modifiedAt. If the deadline lies before
  // the modification, the task is already "in its last 0 %" —
  // treat as urgent until executed.
  const period = Math.max(0, deadline - modifiedAt);

  // Already executed (any execution counts — only one due window).
  if (lastExecutionAt !== null) {
    return {
      urgency: "HIDDEN",
      prevDeadline: deadline,
      nextDeadline: null,
      periodSec: period,
      isMissed: false,
      secondsUntilNext: null,
    };
  }

  if (nowSec >= deadline) {
    return {
      urgency: "URGENT",
      prevDeadline: deadline,
      nextDeadline: null,
      periodSec: period,
      isMissed: true,
      secondsUntilNext: 0,
    };
  }

  const remaining = deadline - nowSec;
  const fraction = period > 0 ? remaining / period : 0;
  return {
    urgency: tierFromFraction(fraction),
    prevDeadline: null,
    nextDeadline: deadline,
    periodSec: period,
    isMissed: false,
    secondsUntilNext: remaining,
  };
};

/** Most recent scheduled deadline strictly before nowSec, or null if
 *  none yet. Strict-less-than so a deadline whose time is exactly
 *  "now" is the *current* deadline, not the previous one — that
 *  matters at second boundaries (e.g. exactly at the cron tick). */
export const computePrevDeadline = (
  rule: ScheduleRule,
  scheduleModifiedAt: number,
  nowSec: number,
): number | null => {
  if (rule.kind === "ONESHOT") return null;
  if (rule.kind === "PERIODIC") {
    const period = rule.intervalDays * DAY_SEC;
    if (period <= 0) return null;
    const elapsed = nowSec - scheduleModifiedAt;
    if (elapsed <= 0) return null;
    // Largest k such that modifiedAt + k*period < nowSec.
    const k = Math.ceil(elapsed / period) - 1;
    if (k < 1) return null;
    return scheduleModifiedAt + k * period;
  }
  // DAILY: scan today's + yesterday's slots for the latest one < now.
  const todayStartSec = Math.floor(nowSec / DAY_SEC) * DAY_SEC;
  const candidates: number[] = [];
  for (const t of rule.times) {
    const [hRaw, mRaw] = t.split(":");
    const h = parseInt(hRaw ?? "", 10);
    const m = parseInt(mRaw ?? "", 10);
    if (Number.isNaN(h) || Number.isNaN(m)) continue;
    candidates.push(todayStartSec + h * 3600 + m * 60);
    candidates.push(todayStartSec - DAY_SEC + h * 3600 + m * 60);
  }
  candidates.sort((a, b) => b - a); // descending
  for (const c of candidates) if (c < nowSec) return c;
  return null;
};

/** Next scheduled deadline > nowSec, or null for ONESHOT past its
 *  deadline. Mirrors `computeNextFireAt` but anchored on the
 *  schedule's own modifiedAt for PERIODIC rules so a freshly-edited
 *  task realigns the rhythm to "now + intervalDays". */
const computeNextDeadline = (
  rule: ScheduleRule,
  scheduleModifiedAt: number,
  nowSec: number,
): number | null => {
  if (rule.kind === "PERIODIC") {
    const period = rule.intervalDays * DAY_SEC;
    if (period <= 0) return null;
    const elapsed = nowSec - scheduleModifiedAt;
    if (elapsed < period) return scheduleModifiedAt + period;
    const k = Math.floor(elapsed / period) + 1;
    return scheduleModifiedAt + k * period;
  }
  if (rule.kind === "DAILY") {
    const todayStartSec = Math.floor(nowSec / DAY_SEC) * DAY_SEC;
    const candidates: number[] = [];
    for (const t of rule.times) {
      const [hRaw, mRaw] = t.split(":");
      const h = parseInt(hRaw ?? "", 10);
      const m = parseInt(mRaw ?? "", 10);
      if (Number.isNaN(h) || Number.isNaN(m)) continue;
      candidates.push(todayStartSec + h * 3600 + m * 60);
      candidates.push(todayStartSec + DAY_SEC + h * 3600 + m * 60);
    }
    candidates.sort((a, b) => a - b);
    for (const c of candidates) if (c > nowSec) return c;
    return null;
  }
  return null;
};
