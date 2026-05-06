/// <reference types="@cloudflare/vitest-pool-workers" />
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";
// Inline the SQL at build time (workerd has no fs).
import init0000 from "../migrations/0000_init.sql?raw";
import init0001 from "../migrations/0001_auth.sql?raw";

const applyMigrations = async () => {
  for (const sql of [init0000, init0001]) {
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
  // Clear app tables between tests so cases don't bleed into each
  // other. d1_migrations stays untouched.
  for (const t of [
    "occurrences",
    "schedules",
    "device_outbox",
    "devices",
    "login_qr_tokens",
    "pending_pairings",
    "auth_logs",
    "tasks",
    "users",
  ]) {
    await env.DB.exec(`DELETE FROM ${t}`);
  }
};

const json = async (res: Response): Promise<Record<string, unknown>> =>
  (await res.json()) as Record<string, unknown>;

beforeAll(applyMigrations);
beforeEach(reset);

describe("auth flow", () => {
  it("quick-setup mints a UserToken for a transparent user", async () => {
    const res = await SELF.fetch("https://t/api/auth/quick-setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body["token"]).toMatch(/\./);
    expect(body["userId"]).toMatch(/^[0-9a-f]{32}$/);
    expect(body["deviceClaimed"]).toBe(false);
  });

  it("setup → login → /me round-trips", async () => {
    const setup = await SELF.fetch("https://t/api/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "alice", pin: "1234" }),
    });
    expect(setup.status).toBe(201);

    const login = await SELF.fetch("https://t/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "alice", pin: "1234" }),
    });
    expect(login.status).toBe(200);
    const { token } = await json(login);

    const me = await SELF.fetch("https://t/api/auth/me", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.status).toBe(200);
    const meBody = await json(me);
    expect(meBody["username"]).toBe("alice");
    expect(meBody["hasPin"]).toBe(true);
  });

  it("login with wrong PIN is 401", async () => {
    await SELF.fetch("https://t/api/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "bob", pin: "1234" }),
    });
    const res = await SELF.fetch("https://t/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "bob", pin: "9999" }),
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

    // 5. Phone exchanges it for a fresh UserToken.
    const exchange = await SELF.fetch("https://t/api/auth/login-qr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId, token: qrToken }),
    });
    expect(exchange.status).toBe(200);
    expect((await json(exchange))["userId"]).toBe(qsBody["userId"]);

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
  const auth = async (): Promise<{ token: string; userId: string }> => {
    const res = await SELF.fetch("https://t/api/auth/quick-setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const body = await json(res);
    return { token: body["token"] as string, userId: body["userId"] as string };
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

  it("PATCH updates title + priority and rejects non-owner", async () => {
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

    // user B can't edit user A's task — gets 403 (wrong-user) once
    // we look it up. (404 first if id is unknown.)
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

  it("user A can't see user B's tasks", async () => {
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

    const ack1 = await SELF.fetch(`https://t/api/occurrences/${occId}/ack`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ack1.status).toBe(200);
    const ack1Body = (await json(ack1)) as { status: string };
    expect(ack1Body.status).toBe("ACKED");

    const ack2 = await SELF.fetch(`https://t/api/occurrences/${occId}/ack`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ack2.status).toBe(200);
    expect((await json(ack2))["status"]).toBe("ACKED");

    void userId;
  });
});
