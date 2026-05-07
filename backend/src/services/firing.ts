import { clock } from "../clock.ts";
// Pure next-fire-time computation. No DB, no clock — caller passes
// `now` so this is property-testable. Plan §17 risk #6 (DST) is
// addressed by computing in user TZ then materialising the absolute
// epoch — Phase 1 takes the simpler "naive UTC" path; we'll layer
// proper TZ handling once a user reports a DST regression.

import type { ScheduleRule } from "../shared/schemas.ts";

const DAY_SEC = 24 * 60 * 60;

/** Returns the next fire time strictly greater than `nowSec`, or null
 *  for ONESHOT rules that have already fired. Times are epoch seconds. */
export const computeNextFireAt = (
  rule: ScheduleRule,
  nowSec: number,
  // Optional anchor for ONESHOT (the deadline-hint epoch); when null
  // ONESHOT fires immediately on creation and never again.
  oneshotAt: number | null = null,
): number | null => {
  switch (rule.kind) {
    case "DAILY":
      return nextDailySlot(rule.times, nowSec);
    case "PERIODIC":
      // Step `intervalDays` from now. The first fire is +intervalDays
      // after creation — matching how a "remind me every 3 days"
      // intuition works (you don't want it firing the moment you
      // hit Save).
      return nowSec + rule.intervalDays * DAY_SEC;
    case "ONESHOT": {
      if (oneshotAt === null) return null;
      if (oneshotAt <= nowSec) return null;
      // No cadence — single-shot fire at the deadline.
      if (!rule.intervalDays || rule.intervalDays <= 0) return oneshotAt;
      // Cadence — fire `intervalDays` from now, capped at the
      // deadline so the final fire is the deadline itself.
      const next = nowSec + rule.intervalDays * DAY_SEC;
      return next < oneshotAt ? next : oneshotAt;
    }
  }
};

/** Compute the next absolute fire time across an array of "HH:MM" slots.
 *  Today's earliest unpassed slot if any; otherwise tomorrow's first slot. */
const nextDailySlot = (times: string[], nowSec: number): number => {
  // Convert nowSec to UTC date components so we can rebuild "today
  // at HH:MM UTC". Phase 1 stores schedules in UTC; per-user TZ
  // lands when the schema gets a `tz` column we actually read.
  const nowMs = nowSec * 1000;
  const todayStartSec = Math.floor(nowMs / (DAY_SEC * 1000)) * DAY_SEC;
  const candidates: number[] = [];
  for (const t of times) {
    const [h, m] = t.split(":").map((s) => parseInt(s, 10));
    if (h === undefined || m === undefined) continue;
    candidates.push(todayStartSec + h * 3600 + m * 60);
    candidates.push(todayStartSec + DAY_SEC + h * 3600 + m * 60);
  }
  candidates.sort((a, b) => a - b);
  for (const c of candidates) {
    if (c > nowSec) return c;
  }
  // Should never reach here given we add tomorrow's slots above; guard
  // anyway so the type-system can prove a number return.
  return nowSec + DAY_SEC;
};
