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

  // ONESHOT period is deadline − modifiedAt. If the deadline lies
  // before the modification, the task is already "in its last 0 %"
  // — treat as urgent until executed.
  const period = Math.max(0, deadline - modifiedAt);

  // Already executed (any execution counts for ONESHOT — there's
  // only one due window).
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
    // Past deadline, never executed → missed.
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
