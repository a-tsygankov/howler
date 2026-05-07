/// <reference types="@cloudflare/vitest-pool-workers" />
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";
// Inline the SQL at build time (workerd has no fs).
import init0000 from "../migrations/0000_init.sql?raw";
import init0001 from "../migrations/0001_auth.sql?raw";
import init0002 from "../migrations/0002_home.sql?raw";
import init0003 from "../migrations/0003_schedule_templates.sql?raw";
import init0004 from "../migrations/0004_avatars.sql?raw";
import init0005 from "../migrations/0005_push_subscriptions.sql?raw";
import init0006 from "../migrations/0006_label_icons.sql?raw";

const applyMigrations = async () => {
  for (const sql of [init0000, init0001, init0002, init0003, init0004, init0005, init0006]) {
    // Strip line comments first — they may contain `;` which would
    // otherwise break the naive split below.
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
  // Clear app tables between tests. Order matters for FK references.
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

const json = async (res: Response): Promise<Record<string, unknown>> =>
  (await res.json()) as Record<string, unknown>;

beforeAll(applyMigrations);
beforeEach(reset);

describe("auth flow", () => {
  it("quick-setup creates a transparent home + first user with a UserToken", async () => {
    const res = await SELF.fetch("https://t/api/auth/quick-setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body["token"]).toMatch(/\./);
    expect(body["homeId"]).toMatch(/^[0-9a-f]{32}$/);
    expect(body["userId"]).toMatch(/^[0-9a-f]{32}$/);
    expect(body["deviceClaimed"]).toBe(false);
  });

  it("setup creates a home named after the login + first user; login → /me round-trips", async () => {
    const setup = await SELF.fetch("https://t/api/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "alice", pin: "1234" }),
    });
    expect(setup.status).toBe(201);

    const login = await SELF.fetch("https://t/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "alice", pin: "1234" }),
    });
    expect(login.status).toBe(200);
    const loginBody = await json(login);
    // Single-user home — login returns a UserToken directly.
    const token = loginBody["token"] as string;
    expect(token).toMatch(/\./);

    const me = await SELF.fetch("https://t/api/auth/me", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.status).toBe(200);
    const meBody = await json(me);
    expect(meBody["homeDisplayName"]).toBe("alice");
    expect(meBody["userDisplayName"]).toBe("User 1");
    expect(meBody["hasPin"]).toBe(true);
  });

  it("login with wrong PIN is 401", async () => {
    await SELF.fetch("https://t/api/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "bob", pin: "1234" }),
    });
    const res = await SELF.fetch("https://t/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "bob", pin: "9999" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("pair + login-by-QR flow", () => {
  it("end-to-end: start → quick-setup with code → check confirmed → login-token-create → login-qr → replay rejected", async () => {
    const deviceId = "0".repeat(31) + "1";

    // 1. Device starts pairing.
    const start = await SELF.fetch("https://t/api/pair/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId, hwModel: "DIAL" }),
    });
    expect(start.status).toBe(200);
    const { pairCode } = await json(start);
    expect(typeof pairCode).toBe("string");

    // 2. Phone runs quick-setup with the code (atomic claim).
    const qs = await SELF.fetch("https://t/api/auth/quick-setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairCode }),
    });
    expect(qs.status).toBe(201);
    const qsBody = await json(qs);
    expect(qsBody["deviceClaimed"]).toBe(true);

    // 3. Device polls /pair/check; gets DeviceToken.
    const chk = await SELF.fetch("https://t/api/pair/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
    const chkBody = await json(chk);
    expect(chkBody["status"]).toBe("confirmed");
    const deviceToken = chkBody["deviceToken"] as string;
    expect(deviceToken).toMatch(/\./);

    // 4. Device mints a one-shot login QR.
    const ltc = await SELF.fetch("https://t/api/auth/login-token-create", {
      method: "POST",
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    expect(ltc.status).toBe(200);
    const { token: qrToken } = await json(ltc);

    // 5. Phone exchanges it. Single-user home → direct UserToken.
    const exchange = await SELF.fetch("https://t/api/auth/login-qr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId, token: qrToken }),
    });
    expect(exchange.status).toBe(200);
    const exBody = await json(exchange);
    expect(exBody["userId"]).toBe(qsBody["userId"]);
    expect(exBody["homeId"]).toBe(qsBody["homeId"]);

    // 6. Replay is rejected.
    const replay = await SELF.fetch("https://t/api/auth/login-qr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId, token: qrToken }),
    });
    expect(replay.status).toBe(410);
  });

  it("login-qr with mismatched deviceId is 403", async () => {
    const dev1 = "1".repeat(32);
    const dev2 = "2".repeat(32);
    const start = await SELF.fetch("https://t/api/pair/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: dev1 }),
    });
    const { pairCode } = await json(start);
    const qs = await SELF.fetch("https://t/api/auth/quick-setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairCode }),
    });
    const chk = await SELF.fetch("https://t/api/pair/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: dev1 }),
    });
    const { deviceToken } = await json(chk);
    const ltc = await SELF.fetch("https://t/api/auth/login-token-create", {
      method: "POST",
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    const { token: qrToken } = await json(ltc);

    const wrong = await SELF.fetch("https://t/api/auth/login-qr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: dev2, token: qrToken }),
    });
    expect(wrong.status).toBe(403);
    void qs;
  });
});

describe("tasks + occurrences", () => {
  const auth = async (): Promise<{
    token: string;
    homeId: string;
    userId: string;
  }> => {
    const res = await SELF.fetch("https://t/api/auth/quick-setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const body = await json(res);
    return {
      token: body["token"] as string,
      homeId: body["homeId"] as string,
      userId: body["userId"] as string,
    };
  };

  it("tasks endpoint requires a token", async () => {
    const res = await SELF.fetch("https://t/api/tasks");
    expect(res.status).toBe(401);
  });

  it("create + list a DAILY task", async () => {
    const { token } = await auth();
    const create = await SELF.fetch("https://t/api/tasks", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "morning meds",
        kind: "DAILY",
        times: ["08:00", "20:00"],
      }),
    });
    expect(create.status).toBe(201);

    const list = await SELF.fetch("https://t/api/tasks", {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await json(list);
    const tasks = body["tasks"] as Array<{ title: string; kind: string }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("morning meds");
    expect(tasks[0]?.kind).toBe("DAILY");
  });

  it("PATCH updates title + priority and rejects callers from other homes", async () => {
    const a = await auth();
    const b = await auth();
    const create = await SELF.fetch("https://t/api/tasks", {
      method: "POST",
      headers: {
        authorization: `Bearer ${a.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "old title", kind: "ONESHOT", priority: 1 }),
    });
    const t = (await json(create)) as { id: string };

    const ok = await SELF.fetch(`https://t/api/tasks/${t.id}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${a.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "new title", priority: 3 }),
    });
    expect(ok.status).toBe(200);
    const okBody = await json(ok);
    expect(okBody["title"]).toBe("new title");
    expect(okBody["priority"]).toBe(3);

    const forbidden = await SELF.fetch(`https://t/api/tasks/${t.id}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${b.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "stolen" }),
    });
    expect(forbidden.status).toBe(403);
  });

  it("home A can't see home B's tasks", async () => {
    const a = await auth();
    const b = await auth();
    await SELF.fetch("https://t/api/tasks", {
      method: "POST",
      headers: {
        authorization: `Bearer ${a.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "a-only", kind: "ONESHOT" }),
    });
    const listB = await SELF.fetch("https://t/api/tasks", {
      headers: { authorization: `Bearer ${b.token}` },
    });
    const body = await json(listB);
    expect((body["tasks"] as unknown[])).toHaveLength(0);
  });

  it("ack idempotency: re-acking returns the same state, never reverts to PENDING", async () => {
    const { token, userId } = await auth();
    // Create a task with a Schedule, then manually insert a PENDING
    // Occurrence (skipping the cron path so the test is deterministic).
    const create = await SELF.fetch("https://t/api/tasks", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "ack me", kind: "ONESHOT" }),
    });
    const task = (await json(create)) as { id: string };
    const occId = "a".repeat(32);
    const now = Date.now();
    await env.DB
      .prepare(
        `INSERT INTO occurrences (id, task_id, due_at, status,
           created_at, updated_at, is_deleted)
         VALUES (?, ?, ?, 'PENDING', ?, ?, 0)`,
      )
      .bind(occId, task.id, Math.floor(now / 1000), now, now)
      .run();

    // Phase 2: ack accepts a JSON body for resultValue/notes.
    const ackHeaders = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    } as const;
    const ack1 = await SELF.fetch(`https://t/api/occurrences/${occId}/ack`, {
      method: "POST",
      headers: ackHeaders,
      body: JSON.stringify({}),
    });
    expect(ack1.status).toBe(200);
    const ack1Body = (await json(ack1)) as { status: string; executionId: string | null };
    expect(ack1Body.status).toBe("ACKED");
    expect(ack1Body.executionId).toMatch(/^[0-9a-f]{32}$/);

    const ack2 = await SELF.fetch(`https://t/api/occurrences/${occId}/ack`, {
      method: "POST",
      headers: ackHeaders,
      body: JSON.stringify({}),
    });
    expect(ack2.status).toBe(200);
    expect((await json(ack2))["status"]).toBe("ACKED");

    // task_executions is append-only — even after re-ack, exactly
    // one row.
    const { results } = await env.DB
      .prepare("SELECT id FROM task_executions WHERE task_id = ?")
      .bind(task.id)
      .all<{ id: string }>();
    expect(results).toHaveLength(1);

    void userId;
  });

  it("ack with resultValue stores the snapshot in task_executions", async () => {
    const { token, homeId } = await auth();
    // Look up a system task_result type (Grams) to attach.
    const { results: types } = await env.DB
      .prepare(
        "SELECT id, unit_name FROM task_results WHERE home_id = ? AND display_name = 'Grams'",
      )
      .bind(homeId)
      .all<{ id: string; unit_name: string }>();
    const grams = types[0]!;
    const create = await SELF.fetch("https://t/api/tasks", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Feed cat",
        kind: "ONESHOT",
        resultTypeId: grams.id,
      }),
    });
    expect(create.status).toBe(201);
    const task = (await json(create)) as { id: string };
    const occId = "c".repeat(32);
    const now = Date.now();
    await env.DB
      .prepare(
        `INSERT INTO occurrences (id, task_id, due_at, status,
           created_at, updated_at, is_deleted)
         VALUES (?, ?, ?, 'PENDING', ?, ?, 0)`,
      )
      .bind(occId, task.id, Math.floor(now / 1000), now, now)
      .run();

    const ack = await SELF.fetch(`https://t/api/occurrences/${occId}/ack`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ resultValue: 80, notes: "morning meal" }),
    });
    expect(ack.status).toBe(200);

    const row = await env.DB
      .prepare(
        "SELECT result_value, result_unit, notes FROM task_executions WHERE task_id = ?",
      )
      .bind(task.id)
      .first<{ result_value: number; result_unit: string; notes: string }>();
    expect(row?.result_value).toBe(80);
    expect(row?.result_unit).toBe("gr");
    expect(row?.notes).toBe("morning meal");
  });
});
