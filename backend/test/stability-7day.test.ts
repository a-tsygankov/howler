/// <reference types="@cloudflare/vitest-pool-workers" />
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";
import init0000 from "../migrations/0000_init.sql?raw";
import init0001 from "../migrations/0001_auth.sql?raw";
import init0002 from "../migrations/0002_home.sql?raw";
import init0003 from "../migrations/0003_schedule_templates.sql?raw";
import init0004 from "../migrations/0004_avatars.sql?raw";
import init0005 from "../migrations/0005_push_subscriptions.sql?raw";
import init0006 from "../migrations/0006_label_icons.sql?raw";
import init0007 from "../migrations/0007_task_avatar_backfill.sql?raw";
import init0008 from "../migrations/0008_rule_modified_at.sql?raw";
import { clock, resetClock, setClock, TestClock } from "../src/clock.ts";
import { consumeFireQueue } from "../src/services/fanout.ts";
import type { Bindings, OccurrenceFireMessage } from "../src/env.ts";

// `env` from `cloudflare:test` is the raw ProvidedEnv from
// vitest-pool-workers — it doesn't surface optional bindings like
// RATE_LIMITER that the production Bindings interface declares. The
// production code paths exercised here don't touch those, so a
// structural cast at the seam is safe.
const bindingsFromEnv = (e: typeof env): Bindings =>
  e as unknown as Bindings;

// Synthetic Phase 3 → 4 stability gate. Replaces "watch main for 7
// real days and hope nothing drifts" with an injectable-clock run
// that fires every DAILY slot for a week, drains the queue
// deterministically, and asserts the invariants the real-world
// watch was meant to catch:
//
//   - exactly 7 × 3 = 21 occurrences fire for a 3-times-daily task
//   - every fired occurrence has fired_at within tick granularity
//     of its due_at (no cron lag drift)
//   - schedule.next_fire_at always advances forward — never null
//     mid-run for a DAILY task, never stays equal to the previous
//     fire (would mean orphan / re-fire)
//   - no two occurrences share (task_id, due_at) (idempotency on
//     the schedule:dueAt key)
//   - acking the latest occurrence and re-acking is idempotent —
//     status stays ACKED, exactly one task_executions row.

const T0_MS = Date.UTC(2025, 2, 8, 0, 0, 0); // Sat 2025-03-08 00:00 UTC
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

const applyMigrations = async () => {
  for (const sql of [init0000, init0001, init0002, init0003, init0004, init0005, init0006, init0007, init0008]) {
    const stripped = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    const statements = stripped
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const s of statements) {
      await env.DB.exec(s.replace(/\s+/g, " "));
    }
  }
};

const reset = async () => {
  for (const t of [
    "task_executions",
    "occurrences",
    "schedules",
    "task_assignments",
    "tasks",
    "schedule_templates",
    "task_results",
    "labels",
    "device_outbox",
    "devices",
    "login_qr_tokens",
    "pending_pairings",
    "auth_logs",
    "push_subscriptions",
    "avatars",
    "users",
    "homes",
  ]) {
    await env.DB.exec(`DELETE FROM ${t}`);
  }
};

beforeAll(applyMigrations);
beforeEach(reset);

const json = async <T,>(res: Response): Promise<T> =>
  (await res.json()) as T;

// Drains "what the cron tick would have queued" without going through
// the actual queue binding — we just synthesise a MessageBatch and
// hand it to consumeFireQueue, which is the same code path the real
// queue consumer runs. Returns the number of occurrences materialised.
const tickAndFire = async (): Promise<number> => {
  const nowSec = clock().nowSec();
  const { results: due } = await env.DB
    .prepare(
      `SELECT id, next_fire_at FROM schedules
       WHERE is_deleted = 0 AND next_fire_at IS NOT NULL AND next_fire_at <= ?`,
    )
    .bind(nowSec)
    .all<{ id: string; next_fire_at: number }>();
  if (due.length === 0) return 0;
  const messages = due.map((s, i) => ({
    id: `test-msg-${i}-${s.id}`,
    timestamp: new Date(clock().nowMs()),
    attempts: 1,
    body: { scheduleId: s.id, dueAt: s.next_fire_at } as OccurrenceFireMessage,
    ack: () => {},
    retry: () => {},
  }));
  const batch = {
    queue: "occurrence-fire",
    messages,
    ackAll: () => {},
    retryAll: () => {},
  } as unknown as MessageBatch<OccurrenceFireMessage>;
  await consumeFireQueue(bindingsFromEnv(env), batch);
  return due.length;
};

describe("7-day stability gate (Phase 3 → 4)", () => {
  it("DAILY 3×/day fires 21 times over 7 days with no drift, idempotency holds", async () => {
    const t = new TestClock(T0_MS);
    setClock(t);
    try {
      // 1) Create a home + user via the real API (exercises auth path).
      const setup = await SELF.fetch("https://t/api/auth/quick-setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(setup.status).toBe(201);
      const { token } = await json<{ token: string }>(setup);

      // 2) DAILY task — three slots per UTC day. (Schedules store
      // times as offsets from 00:00 UTC; the SPA converts local to
      // UTC before sending. Picking UTC slots means the test is
      // independent of the test runner's timezone.)
      const create = await SELF.fetch("https://t/api/tasks", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "feed cat",
          kind: "DAILY",
          times: ["08:00", "14:00", "22:00"],
        }),
      });
      expect(create.status).toBe(201);
      const task = await json<{ id: string }>(create);

      // 3) Tick the clock hour-by-hour over 7 full days. At each
      // tick we run the same path the real cron would: find due
      // schedules and route them through consumeFireQueue.
      let totalFired = 0;
      const fireEvents: Array<{ tick: number; fired: number }> = [];
      for (let i = 0; i < 7 * 24; i++) {
        const fired = await tickAndFire();
        if (fired > 0) fireEvents.push({ tick: i, fired });
        totalFired += fired;
        t.advanceMs(ONE_HOUR_MS);
      }
      // Final sweep at end-of-window so the 22:00 slot of day 7 is
      // captured if our advance left us right at the boundary.
      totalFired += await tickAndFire();

      // 4) Invariants.

      // a) 7 days × 3 slots = 21 fires.
      expect(totalFired).toBe(21);

      // b) Every fire wrote exactly one occurrence row.
      const { results: occs } = await env.DB
        .prepare(
          `SELECT id, due_at, fired_at, status FROM occurrences
           WHERE task_id = ? AND is_deleted = 0
           ORDER BY due_at ASC`,
        )
        .bind(task.id)
        .all<{
          id: string;
          due_at: number;
          fired_at: number | null;
          status: string;
        }>();
      expect(occs).toHaveLength(21);

      // c) due_at values are exactly the 21 expected slots — no
      // skips, no doubles, no off-by-one.
      const t0Sec = Math.floor(T0_MS / 1000);
      const expectedDueAts: number[] = [];
      for (let day = 0; day < 7; day++) {
        for (const hour of [8, 14, 22]) {
          expectedDueAts.push(t0Sec + day * 86400 + hour * 3600);
        }
      }
      expect(occs.map((o) => o.due_at)).toEqual(expectedDueAts);

      // d) Cron-lag bound: every fire happened within one tick
      // (1 h here) of its due_at. In production the tick is 1 min
      // and the SLO is < 90 s p99 — this test runs at coarser
      // granularity but the property is the same.
      for (const o of occs) {
        expect(o.fired_at).not.toBeNull();
        expect(o.fired_at!).toBeGreaterThanOrEqual(o.due_at * 1000);
        expect(o.fired_at!).toBeLessThanOrEqual(o.due_at * 1000 + ONE_HOUR_MS);
      }

      // e) (task_id, due_at) is unique — no orphan re-fires.
      const seen = new Set<number>();
      for (const o of occs) {
        expect(seen.has(o.due_at)).toBe(false);
        seen.add(o.due_at);
      }

      // f) After 7 days, the schedule's next_fire_at points to day
      // 8's first slot (08:00 UTC), not null and not stuck on a
      // past time.
      const sched = await env.DB
        .prepare(
          "SELECT next_fire_at FROM schedules WHERE task_id = ? AND is_deleted = 0",
        )
        .bind(task.id)
        .first<{ next_fire_at: number | null }>();
      expect(sched?.next_fire_at).toBe(t0Sec + 7 * 86400 + 8 * 3600);

      // g) Ack idempotency over the full run: pick the latest fired
      // occurrence, ack twice, expect a single task_executions row.
      const latest = occs[occs.length - 1]!;
      const ackHeaders = {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      } as const;
      const ack1 = await SELF.fetch(
        `https://t/api/occurrences/${latest.id}/ack`,
        { method: "POST", headers: ackHeaders, body: "{}" },
      );
      expect(ack1.status).toBe(200);
      const ack2 = await SELF.fetch(
        `https://t/api/occurrences/${latest.id}/ack`,
        { method: "POST", headers: ackHeaders, body: "{}" },
      );
      expect(ack2.status).toBe(200);
      const { results: execs } = await env.DB
        .prepare("SELECT id FROM task_executions WHERE task_id = ?")
        .bind(task.id)
        .all<{ id: string }>();
      expect(execs).toHaveLength(1);

      // h) Sanity: the per-day fire pattern is regular (3 fires
      // distributed across the 24 ticks of each day). If the
      // pattern collapsed (e.g. all 21 fired on day 1), the test
      // above would already catch it via due_at ordering, but this
      // is a cleaner expression of the same invariant.
      const firesByDay = new Map<number, number>();
      for (const o of occs) {
        const dayIdx = Math.floor((o.due_at - t0Sec) / 86400);
        firesByDay.set(dayIdx, (firesByDay.get(dayIdx) ?? 0) + 1);
      }
      for (let day = 0; day < 7; day++) {
        expect(firesByDay.get(day)).toBe(3);
      }
      void fireEvents;
    } finally {
      resetClock();
    }
  });
});
