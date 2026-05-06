/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect } from "vitest";
import { computeNextFireAt } from "../src/services/firing.ts";

const HOUR = 3600;
const DAY = 86400;
// 2026-05-06 00:00:00 UTC
const T0 = 1778025600;

describe("computeNextFireAt", () => {
  it("DAILY returns the next unpassed slot today", () => {
    const next = computeNextFireAt(
      { version: 1, kind: "DAILY", times: ["08:00", "14:00", "22:00"] },
      T0 + 9 * HOUR, // 09:00 UTC — 14:00 is the next slot
    );
    expect(next).toBe(T0 + 14 * HOUR);
  });

  it("DAILY rolls over to tomorrow when all today's slots have passed", () => {
    const next = computeNextFireAt(
      { version: 1, kind: "DAILY", times: ["08:00", "14:00"] },
      T0 + 23 * HOUR,
    );
    expect(next).toBe(T0 + DAY + 8 * HOUR);
  });

  it("DAILY is stable to slot ordering", () => {
    const a = computeNextFireAt(
      { version: 1, kind: "DAILY", times: ["22:00", "08:00", "14:00"] },
      T0 + 9 * HOUR,
    );
    const b = computeNextFireAt(
      { version: 1, kind: "DAILY", times: ["08:00", "14:00", "22:00"] },
      T0 + 9 * HOUR,
    );
    expect(a).toBe(b);
  });

  it("PERIODIC fires +intervalDays from now (not immediately)", () => {
    expect(
      computeNextFireAt(
        { version: 1, kind: "PERIODIC", intervalDays: 3 },
        T0,
      ),
    ).toBe(T0 + 3 * DAY);
  });

  it("ONESHOT returns the deadline if it's in the future", () => {
    const due = T0 + 5 * DAY;
    expect(
      computeNextFireAt({ version: 1, kind: "ONESHOT" }, T0, due),
    ).toBe(due);
  });

  it("ONESHOT returns null once the deadline has passed", () => {
    expect(
      computeNextFireAt({ version: 1, kind: "ONESHOT" }, T0 + 10 * DAY, T0 + 5 * DAY),
    ).toBeNull();
  });

  it("ONESHOT with no deadline returns null", () => {
    expect(
      computeNextFireAt({ version: 1, kind: "ONESHOT" }, T0, null),
    ).toBeNull();
  });
});
