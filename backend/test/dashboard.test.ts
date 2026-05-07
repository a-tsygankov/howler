/// <reference types="@cloudflare/vitest-pool-workers" />
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import { resetClock, setClock, TestClock } from "../src/clock.ts";

// End-to-end view of the urgency endpoint: real auth, real D1
// schedules, real lastExecution lookups. The injectable clock lets
// us pin "now" relative to the schedule rules so URGENT /
// NON_URGENT / HIDDEN classification is deterministic.

const T0_MS = Date.UTC(2026, 4, 6, 0, 0, 0); // 2026-05-06 00:00 UTC
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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

let testClock: TestClock;
beforeEach(async () => {
  await reset();
  testClock = new TestClock(T0_MS);
  setClock(testClock);
});
afterEach(() => resetClock());

const json = async <T,>(res: Response): Promise<T> =>
  (await res.json()) as T;

const auth = async (): Promise<{ token: string; homeId: string }> => {
  const r = await SELF.fetch("https://t/api/auth/quick-setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return json<{ token: string; homeId: string }>(r);
};

describe("GET /api/dashboard", () => {
  it("returns urgent tasks first, then non-urgent; hides others", async () => {
    const { token } = await auth();
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    } as const;

    // Task A — ONESHOT 8 h window. We'll advance the clock to 7 h
    // in (12.5 % remains) → URGENT.
    await SELF.fetch("https://t/api/tasks", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "imminent oneshot",
        kind: "ONESHOT",
        deadlineHint: Math.floor((T0_MS + 8 * HOUR_MS) / 1000),
      }),
    });

    // Task B — ONESHOT 30 d window. After advancing 7 h we're still
    // in the first ~1 % → HIDDEN.
    await SELF.fetch("https://t/api/tasks", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "far future oneshot",
        kind: "ONESHOT",
        deadlineHint: Math.floor((T0_MS + 30 * DAY_MS) / 1000),
      }),
    });

    // Move the clock forward into the urgent zone for task A. The
    // recurring tasks below will be created at this new "now" so
    // their modifiedAt sits between the prev/next slots and they
    // don't show up as missed on first paint.
    testClock.advanceMs(6 * HOUR_MS + 30 * 60 * 1000); // T0 + 6.5 h

    // Task C — DAILY 3×/day. Slots at 06:00 / 14:00 / 22:00. At
    // T0+6.5 h: prev = T0+6 h, next = T0+14 h, modifiedAt = T0+6.5 h
    // (just created) > prev → not missed. We then advance another
    // 30 min (T0+7 h) for the assertion: 7 h remain of the 8 h gap
    // → 87 % → HIDDEN.
    await SELF.fetch("https://t/api/tasks", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "daily 3x",
        kind: "DAILY",
        times: ["06:00", "14:00", "22:00"],
      }),
    });

    // Task D — PERIODIC every-3-days. First deadline 3 days out
    // → ~100 % remaining → HIDDEN.
    await SELF.fetch("https://t/api/tasks", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "every 3 days",
        kind: "PERIODIC",
        intervalDays: 3,
      }),
    });

    // Final advance into Task A's urgent zone.
    testClock.advanceMs(30 * 60 * 1000); // total: T0 + 7 h

    const r = await SELF.fetch("https://t/api/dashboard", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.status).toBe(200);
    const body = await json<{
      now: number;
      tasks: Array<{
        task: { title: string };
        urgency: "URGENT" | "NON_URGENT";
        nextDeadline: number | null;
      }>;
    }>(r);

    expect(body.now).toBe(Math.floor((T0_MS + 7 * HOUR_MS) / 1000));
    // Only the imminent oneshot survives the HIDDEN filter.
    expect(body.tasks.map((t) => t.task.title)).toEqual(["imminent oneshot"]);
    expect(body.tasks[0]?.urgency).toBe("URGENT");
  });

  it("flips DAILY to URGENT once the next slot is in the last quarter", async () => {
    const { token } = await auth();
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    } as const;

    // Create a DAILY task with 4 slots → 6 h between them.
    await SELF.fetch("https://t/api/tasks", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "every 6h",
        kind: "DAILY",
        times: ["00:00", "06:00", "12:00", "18:00"],
      }),
    });

    // 03:00 — 3 h before 06:00. fraction = 3/6 = 50 % → NON_URGENT.
    testClock.advanceMs(3 * HOUR_MS);
    {
      const r = await SELF.fetch("https://t/api/dashboard", {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await json<{
        tasks: Array<{ urgency: string }>;
      }>(r);
      expect(body.tasks).toHaveLength(1);
      expect(body.tasks[0]?.urgency).toBe("NON_URGENT");
    }

    // 04:30 — 1.5 h before 06:00. fraction = 1.5/6 = 25 % → URGENT.
    testClock.advanceMs(1.5 * HOUR_MS);
    {
      const r = await SELF.fetch("https://t/api/dashboard", {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await json<{
        tasks: Array<{ urgency: string; isMissed: boolean }>;
      }>(r);
      expect(body.tasks[0]?.urgency).toBe("URGENT");
      expect(body.tasks[0]?.isMissed).toBe(false);
    }
  });

  it("marks a task URGENT-missed when prev deadline lapsed without execution", async () => {
    const { token, homeId } = await auth();
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    } as const;

    // PERIODIC every-1-day, anchored at T0. By T0 + 2 days the
    // deadline at T0+1d has come and gone with no execution → URGENT,
    // missed.
    const create = await SELF.fetch("https://t/api/tasks", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "daily-ish",
        kind: "PERIODIC",
        intervalDays: 1,
      }),
    });
    expect(create.status).toBe(201);
    void homeId;

    testClock.advanceMs(2 * DAY_MS);

    const r = await SELF.fetch("https://t/api/dashboard", {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await json<{
      tasks: Array<{ urgency: string; isMissed: boolean; prevDeadline: number | null }>;
    }>(r);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]?.urgency).toBe("URGENT");
    expect(body.tasks[0]?.isMissed).toBe(true);
    expect(body.tasks[0]?.prevDeadline).toBe(Math.floor((T0_MS + 1 * DAY_MS) / 1000));
  });

  it("execution recorded since prev deadline reverses 'missed'", async () => {
    const { token } = await auth();
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    } as const;

    const create = await SELF.fetch("https://t/api/tasks", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "executed",
        kind: "PERIODIC",
        intervalDays: 1,
      }),
    });
    const task = await json<{ id: string }>(create);

    // Advance past the first deadline + manually log an execution
    // inside the prev-deadline → now window.
    testClock.advanceMs(2 * DAY_MS);
    // Look up the home_id for the FK on task_executions.
    const tRow = await env.DB
      .prepare("SELECT home_id FROM tasks WHERE id = ?")
      .bind(task.id)
      .first<{ home_id: string }>();
    const execTs = Math.floor((T0_MS + 1 * DAY_MS + HOUR_MS) / 1000);
    const execId = "f".repeat(32);
    await env.DB
      .prepare(
        `INSERT INTO task_executions (id, home_id, task_id, ts)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(execId, tRow!.home_id, task.id, execTs)
      .run();

    const r = await SELF.fetch("https://t/api/dashboard", {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await json<{
      tasks: Array<{ urgency: string; isMissed: boolean }>;
    }>(r);
    // Within 1 day of next deadline (T0+2d, fraction 100 %) → HIDDEN
    // since not missed. But we still want isMissed false. The task
    // gets filtered if HIDDEN — verify by checking the empty list.
    expect(body.tasks).toHaveLength(0);
  });

  it("rule_modified_at survives cron's updated_at bumps (urgency stays correct)", async () => {
    // Regression for the prod bug seen in dev-17 debugging: the
    // cron's queue consumer (`fanout.ts`) bumps `schedules.updated_at`
    // every time it advances `next_fire_at`. Before migration 0008
    // urgency.ts anchored on `updated_at` directly, which raced
    // forward past every prev_deadline → nothing was ever "missed"
    // and every task ended up in the HIDDEN tier. After 0008 the
    // dashboard reads `rule_modified_at` instead, which only the
    // user-driven mutation sites bump.
    const { token } = await auth();
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    } as const;

    // PERIODIC every-1-day, created at T0. Before 0008's fix, advancing
    // past T0+1d AND simulating a cron-fanout updated_at bump would
    // hide the task (false negative). The regression check is that
    // the task is still URGENT-missed.
    const create = await SELF.fetch("https://t/api/tasks", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "rhythm-anchor",
        kind: "PERIODIC",
        intervalDays: 1,
      }),
    });
    expect(create.status).toBe(201);

    // Advance 2 days. Now the fired-at-T0+1d slot is in the past.
    testClock.advanceMs(2 * DAY_MS);

    // Simulate the cron's post-fire schedule write: bump updated_at
    // to wall-clock now, leave rule_modified_at alone. This is what
    // fanout.ts does for any actively-firing schedule.
    await env.DB
      .prepare("UPDATE schedules SET updated_at = ? WHERE task_id IN (SELECT id FROM tasks WHERE title = ?)")
      .bind(testClock.nowMs(), "rhythm-anchor")
      .run();

    const r = await SELF.fetch("https://t/api/dashboard", {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await json<{
      tasks: Array<{ urgency: string; isMissed: boolean }>;
    }>(r);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]?.urgency).toBe("URGENT");
    expect(body.tasks[0]?.isMissed).toBe(true);
  });

  it("requires auth", async () => {
    const r = await SELF.fetch("https://t/api/dashboard");
    expect(r.status).toBe(401);
  });

  it("?include=hidden returns HIDDEN-tier tasks (firmware All-tasks screen)", async () => {
    // Default behaviour drops HIDDEN; the device's "All tasks" screen
    // wants every active task. New query param flips the filter off.
    const { token } = await auth();
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    } as const;

    // Two tasks, both freshly created so both will be HIDDEN under
    // the default filter — periodic-2 won't have an urgent slot for
    // 2 days; periodic-7 even longer.
    for (const intervalDays of [2, 7]) {
      const r = await SELF.fetch("https://t/api/tasks", {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: `every-${intervalDays}d`,
          kind: "PERIODIC",
          intervalDays,
        }),
      });
      expect(r.status).toBe(201);
    }

    // Default — both filtered out.
    {
      const r = await SELF.fetch("https://t/api/dashboard", {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await json<{ tasks: unknown[] }>(r);
      expect(body.tasks).toHaveLength(0);
    }
    // ?include=hidden — both surface, with urgency="HIDDEN".
    {
      const r = await SELF.fetch("https://t/api/dashboard?include=hidden", {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await json<{ tasks: Array<{ urgency: string }> }>(r);
      expect(body.tasks).toHaveLength(2);
      for (const t of body.tasks) expect(t.urgency).toBe("HIDDEN");
    }
  });

  it("accepts a device token (firmware-side dashboard render)", async () => {
    // The on-device firmware authenticates with a device token, not
    // a user token. The dashboard endpoint must accept both — gating
    // on requireUser() left the dial showing empty even with valid
    // creds. Mint a token via the same path the pair flow uses, then
    // prove the response carries the home's tasks.
    const { token: userToken, homeId } = await auth();
    const userHeaders = {
      authorization: `Bearer ${userToken}`,
      "content-type": "application/json",
    } as const;

    // Seed one task so the response isn't trivially empty.
    const create = await SELF.fetch("https://t/api/tasks", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        title: "device-side",
        kind: "PERIODIC",
        intervalDays: 1,
      }),
    });
    expect(create.status).toBe(201);
    testClock.advanceMs(2 * DAY_MS);

    // Mint a device token directly. The pair flow normally produces
    // these via /api/pair/confirm; this short-circuits the four-step
    // pair dance for the test.
    const { issueDeviceToken } = await import("../src/auth.ts");
    const secret = (env as unknown as { AUTH_SECRET: string }).AUTH_SECRET;
    const deviceToken = await issueDeviceToken(
      homeId,
      "0".repeat(20) + "abcdef012345",
      secret,
    );

    const r = await SELF.fetch("https://t/api/dashboard", {
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    expect(r.status).toBe(200);
    const body = await json<{ tasks: Array<{ task: { title: string } }> }>(r);
    expect(body.tasks.length).toBeGreaterThan(0);
    expect(body.tasks[0]?.task.title).toBe("device-side");
  });
});
