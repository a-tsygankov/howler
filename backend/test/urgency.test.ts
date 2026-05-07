import { describe, it, expect } from "vitest";
import { computeUrgency, computePrevDeadline } from "../src/services/urgency.ts";

const HOUR = 3600;
const DAY = 86400;
// 2026-05-06 00:00 UTC
const T0 = 1778025600;

describe("computeUrgency — DAILY", () => {
  // 3 slots → 8 h between consecutive slots.
  const rule = {
    version: 1 as const,
    kind: "DAILY" as const,
    times: ["08:00", "16:00", "00:00"],
  };

  it("URGENT in the last quarter of the gap to the next slot", () => {
    // 7:00 — 1 h before 08:00 deadline, gap = 8 h, fraction = 1/8 ≈ 12 %
    const r = computeUrgency({
      rule,
      scheduleModifiedAt: T0 + 1, // before any slot today, so prev=null
      oneshotDeadline: null,
      lastExecutionAt: null,
      nowSec: T0 + 7 * HOUR,
    });
    expect(r.urgency).toBe("URGENT");
    expect(r.isMissed).toBe(false);
    expect(r.nextDeadline).toBe(T0 + 8 * HOUR);
  });

  it("NON_URGENT in the second-to-last quarter", () => {
    // 12:00 — 4 h before 16:00, gap = 8 h, fraction = 4/8 = 50 % → NON_URGENT
    const r = computeUrgency({
      rule,
      scheduleModifiedAt: T0 + 8 * HOUR + 1, // after 08:00, so 08:00 not "missed"
      oneshotDeadline: null,
      lastExecutionAt: null,
      nowSec: T0 + 12 * HOUR,
    });
    expect(r.urgency).toBe("NON_URGENT");
    expect(r.isMissed).toBe(false);
  });

  it("HIDDEN when more than half the gap remains", () => {
    // 10:00 — 6 h before 16:00, gap = 8 h, fraction = 6/8 = 75 % → HIDDEN
    const r = computeUrgency({
      rule,
      scheduleModifiedAt: T0 + 8 * HOUR + 1,
      oneshotDeadline: null,
      lastExecutionAt: null,
      nowSec: T0 + 10 * HOUR,
    });
    expect(r.urgency).toBe("HIDDEN");
  });

  it("URGENT when previous slot was missed (no execution, modifiedAt before)", () => {
    // 09:00 — 1 h after 08:00 deadline, never executed since.
    // modifiedAt is yesterday, so 08:00 is missed.
    const r = computeUrgency({
      rule,
      scheduleModifiedAt: T0 - DAY,
      oneshotDeadline: null,
      lastExecutionAt: null,
      nowSec: T0 + 9 * HOUR,
    });
    expect(r.urgency).toBe("URGENT");
    expect(r.isMissed).toBe(true);
    expect(r.prevDeadline).toBe(T0 + 8 * HOUR);
  });

  it("not missed when modifiedAt > previous deadline (first-expected-execution rule)", () => {
    // Same wall time but the schedule was edited at 08:30, after the
    // 08:00 slot. The previous slot is treated as completed.
    const r = computeUrgency({
      rule,
      scheduleModifiedAt: T0 + 8 * HOUR + 30 * 60,
      oneshotDeadline: null,
      lastExecutionAt: null,
      nowSec: T0 + 9 * HOUR,
    });
    expect(r.isMissed).toBe(false);
  });

  it("not missed when an execution exists since the previous deadline", () => {
    const r = computeUrgency({
      rule,
      scheduleModifiedAt: T0 - DAY,
      oneshotDeadline: null,
      lastExecutionAt: T0 + 8 * HOUR + 5 * 60, // executed 5 min after 08:00
      nowSec: T0 + 9 * HOUR,
    });
    expect(r.isMissed).toBe(false);
  });

  it("cycle-done shifts the urgency window forward", () => {
    // [08, 16, 00] — 8 h gaps. At 15:00 (1 h before 16:00) the row
    // is normally URGENT (12 % of an 8-h gap remains). But if the
    // user already executed at 14:00 (between 08:00 and 16:00),
    // the current cycle is satisfied — the row should jump to the
    // 16:00 → 00:00 window, where 9 h remains of an 8 h gap →
    // HIDDEN.
    const r = computeUrgency({
      rule,
      scheduleModifiedAt: T0 - DAY,
      oneshotDeadline: null,
      lastExecutionAt: T0 + 14 * HOUR,
      nowSec: T0 + 15 * HOUR,
    });
    expect(r.urgency).toBe("HIDDEN");
    expect(r.isMissed).toBe(false);
    // prev / next reflect the *shifted* window.
    expect(r.prevDeadline).toBe(T0 + 16 * HOUR);
    expect(r.nextDeadline).toBe(T0 + 24 * HOUR);
  });
});

describe("computeUrgency — PERIODIC", () => {
  const rule = {
    version: 1 as const,
    kind: "PERIODIC" as const,
    intervalDays: 3,
  };

  it("HIDDEN early in the cycle (>50 % remaining)", () => {
    // 1 day after creation — 2 days remain of the 3-day period.
    const r = computeUrgency({
      rule,
      scheduleModifiedAt: T0,
      oneshotDeadline: null,
      lastExecutionAt: null,
      nowSec: T0 + 1 * DAY,
    });
    expect(r.urgency).toBe("HIDDEN");
    expect(r.nextDeadline).toBe(T0 + 3 * DAY);
  });

  it("NON_URGENT in the second-to-last quarter", () => {
    // 2.0 days in (33 % remains of 3-day period).
    const r = computeUrgency({
      rule,
      scheduleModifiedAt: T0,
      oneshotDeadline: null,
      lastExecutionAt: null,
      nowSec: T0 + 2 * DAY,
    });
    expect(r.urgency).toBe("NON_URGENT");
  });

  it("URGENT in the last quarter before the next deadline", () => {
    // 2.5 days in (17 % remains).
    const r = computeUrgency({
      rule,
      scheduleModifiedAt: T0,
      oneshotDeadline: null,
      lastExecutionAt: null,
      nowSec: T0 + 2 * DAY + 12 * HOUR,
    });
    expect(r.urgency).toBe("URGENT");
  });

  it("URGENT + missed when a deadline has passed without execution", () => {
    // 4 days in: deadline at T0+3d came and went.
    const r = computeUrgency({
      rule,
      scheduleModifiedAt: T0,
      oneshotDeadline: null,
      lastExecutionAt: null,
      nowSec: T0 + 4 * DAY,
    });
    expect(r.urgency).toBe("URGENT");
    expect(r.isMissed).toBe(true);
    expect(r.prevDeadline).toBe(T0 + 3 * DAY);
    expect(r.nextDeadline).toBe(T0 + 6 * DAY);
  });

  it("execution since the previous deadline reverses 'missed'", () => {
    const r = computeUrgency({
      rule,
      scheduleModifiedAt: T0,
      oneshotDeadline: null,
      lastExecutionAt: T0 + 3 * DAY + HOUR,
      nowSec: T0 + 4 * DAY,
    });
    expect(r.isMissed).toBe(false);
  });
});

describe("computeUrgency — ONESHOT", () => {
  const rule = { version: 1 as const, kind: "ONESHOT" as const };

  it("HIDDEN when the deadline is far away (>50 % remains)", () => {
    // Period = 8 days; we're 1 day in, 7 days remain → 87 %
    const r = computeUrgency({
      rule,
      scheduleModifiedAt: T0,
      oneshotDeadline: T0 + 8 * DAY,
      lastExecutionAt: null,
      nowSec: T0 + 1 * DAY,
    });
    expect(r.urgency).toBe("HIDDEN");
  });

  it("NON_URGENT in the second-to-last quarter", () => {
    // 50 % remaining of 8-day period.
    const r = computeUrgency({
      rule,
      scheduleModifiedAt: T0,
      oneshotDeadline: T0 + 8 * DAY,
      lastExecutionAt: null,
      nowSec: T0 + 4 * DAY,
    });
    expect(r.urgency).toBe("NON_URGENT");
  });

  it("URGENT in the last quarter approaching the deadline", () => {
    // ~12 % remaining.
    const r = computeUrgency({
      rule,
      scheduleModifiedAt: T0,
      oneshotDeadline: T0 + 8 * DAY,
      lastExecutionAt: null,
      nowSec: T0 + 7 * DAY,
    });
    expect(r.urgency).toBe("URGENT");
    expect(r.isMissed).toBe(false);
  });

  it("URGENT + missed once the deadline has passed and nothing was executed", () => {
    const r = computeUrgency({
      rule,
      scheduleModifiedAt: T0,
      oneshotDeadline: T0 + 1 * DAY,
      lastExecutionAt: null,
      nowSec: T0 + 2 * DAY,
    });
    expect(r.urgency).toBe("URGENT");
    expect(r.isMissed).toBe(true);
  });

  it("HIDDEN once executed regardless of clock", () => {
    const r = computeUrgency({
      rule,
      scheduleModifiedAt: T0,
      oneshotDeadline: T0 + 8 * DAY,
      lastExecutionAt: T0 + 7 * DAY,
      nowSec: T0 + 9 * DAY,
    });
    expect(r.urgency).toBe("HIDDEN");
    expect(r.isMissed).toBe(false);
  });

  it("HIDDEN when deadline is null (no due date)", () => {
    const r = computeUrgency({
      rule,
      scheduleModifiedAt: T0,
      oneshotDeadline: null,
      lastExecutionAt: null,
      nowSec: T0,
    });
    expect(r.urgency).toBe("HIDDEN");
  });
});

describe("computePrevDeadline", () => {
  it("DAILY returns latest passed slot today", () => {
    const rule = { version: 1 as const, kind: "DAILY" as const, times: ["08:00", "14:00"] };
    expect(computePrevDeadline(rule, T0, T0 + 15 * HOUR)).toBe(T0 + 14 * HOUR);
  });

  it("DAILY returns yesterday's last slot when no slot today has passed", () => {
    const rule = { version: 1 as const, kind: "DAILY" as const, times: ["14:00"] };
    expect(computePrevDeadline(rule, T0, T0 + 9 * HOUR)).toBe(T0 - DAY + 14 * HOUR);
  });

  it("PERIODIC returns null when first deadline still in the future", () => {
    const rule = { version: 1 as const, kind: "PERIODIC" as const, intervalDays: 3 };
    expect(computePrevDeadline(rule, T0, T0 + 1 * DAY)).toBeNull();
  });

  it("PERIODIC returns the last anchored deadline", () => {
    const rule = { version: 1 as const, kind: "PERIODIC" as const, intervalDays: 3 };
    expect(computePrevDeadline(rule, T0, T0 + 7 * DAY)).toBe(T0 + 6 * DAY);
  });
});
