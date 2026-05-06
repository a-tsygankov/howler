// Injectable wall-clock — production reads from SystemClock; tests
// swap in TestClock to fast-forward without sleeping. Plan §3 calls
// out IClock as one of the seams that domain code depends on.
//
// Usage in production code:
//   import { clock } from "./clock.ts";
//   const nowMs  = clock().nowMs();
//   const nowSec = clock().nowSec();
//
// Usage in tests:
//   import { setClock, TestClock } from "../src/clock.ts";
//   const t = new TestClock(1_700_000_000_000);
//   setClock(t);
//   t.advanceDays(7);

export interface Clock {
  nowMs(): number;
  nowSec(): number;
}

export class SystemClock implements Clock {
  nowMs(): number {
    return Date.now();
  }
  nowSec(): number {
    return Math.floor(Date.now() / 1000);
  }
}

export class TestClock implements Clock {
  private ms: number;
  constructor(initialMs: number = 0) {
    this.ms = initialMs;
  }
  nowMs(): number {
    return this.ms;
  }
  nowSec(): number {
    return Math.floor(this.ms / 1000);
  }
  /** Move forward (or back, with negative input) by an absolute number of ms. */
  advanceMs(deltaMs: number): void {
    this.ms += deltaMs;
  }
  advanceSec(deltaSec: number): void {
    this.ms += deltaSec * 1000;
  }
  advanceDays(days: number): void {
    this.ms += days * 24 * 60 * 60 * 1000;
  }
  /** Set the current time to an absolute ms epoch. */
  set(ms: number): void {
    this.ms = ms;
  }
}

// Module-level singleton — Workers run each request in isolation
// inside the same module instance, so this is safe for production
// (only SystemClock is ever set there). Each vitest-pool-workers
// runtime is its own module instance, so test mutations don't leak.
let _current: Clock = new SystemClock();

export const clock = (): Clock => _current;

/** TEST-ONLY. Replace the active clock. */
export const setClock = (c: Clock): void => {
  _current = c;
};

/** TEST-ONLY. Restore the SystemClock. */
export const resetClock = (): void => {
  _current = new SystemClock();
};
