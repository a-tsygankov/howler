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
import init0007 from "../migrations/0007_task_avatar_backfill.sql?raw";
import init0008 from "../migrations/0008_rule_modified_at.sql?raw";
import init0009 from "../migrations/0009_user_bg_color.sql?raw";
import init0012 from "../migrations/0012_update_counter.sql?raw";

// Parse SQL into top-level statements. The naive split-on-';' breaks
// on trigger bodies (`CREATE TRIGGER … BEGIN … ; … END;`) — every
// statement inside a BEGIN/END block has its own ';' that the splitter
// would treat as the trigger's terminator. This walker tokenises on
// BEGIN/END/; and only ends a statement on a top-level ';'. Everything
// else is identical to the previous splitter — comment lines stripped,
// whitespace collapsed.
const splitStatements = (sql: string): string[] => {
  const stripped = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  const tokens = stripped.split(/(\bBEGIN\b|\bEND\b|;)/gi);
  for (const tok of tokens) {
    if (!tok) continue;
    const upper = tok.toUpperCase();
    if (upper === "BEGIN") {
      depth++;
      cur += tok;
    } else if (upper === "END") {
      if (depth > 0) depth--;
      cur += tok;
    } else if (tok === ";") {
      cur += tok;
      if (depth === 0) {
        const trimmed = cur.trim();
        if (trimmed) out.push(trimmed);
        cur = "";
      }
    } else {
      cur += tok;
    }
  }
  const tail = cur.trim();
  if (tail) out.push(tail);
  return out;
};

const applyMigrations = async () => {
  // 0010 + 0011 are icon-storage migrations — they don't affect any
  // home-scoped table the tests touch, and 0011 inserts ~20 KB of
  // bitmap data we don't need in the in-memory DB. Leaving them out
  // keeps test boot fast; if a future test exercises the icon
  // pipeline they should be added here.
  for (const sql of [init0000, init0001, init0002, init0003, init0004, init0005, init0006, init0007, init0008, init0009, init0012]) {
    for (const s of splitStatements(sql)) {
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
  // Per-call cf-connecting-ip stamps so each auth() lands in its
  // own rate-limit bucket (RATE_LIMITER binding is wired in tests
  // and the 10/60 bucket is shared across the whole vitest worker).
  // Same trick as the "home update counter" describe below — a real
  // fleet has distinct outbound IPs naturally.
  let nextIp = 100;
  const auth = async (): Promise<{
    token: string;
    homeId: string;
    userId: string;
  }> => {
    const ip = `10.0.1.${nextIp++}`;
    const res = await SELF.fetch("https://t/api/auth/quick-setup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": ip,
      },
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

  // Reported on-device: tapping a task with the seeded "Rating"
  // result lands on the picker's empty-state ("no result type
  // (tap to skip)") instead of the star widget. The early-return
  // in screen_pickers.cpp::buildResultPicker fires when the
  // device's `findResultType(task.resultTypeId)` returns null —
  // either the task points at a type the device hasn't synced
  // (server-side data inconsistency) or the IDs returned by
  // /api/dashboard differ from /api/task-results for the same
  // row. This sweeps both: a task created with each seeded type
  // must round-trip the same UUID through the dashboard *and*
  // task-results endpoints, so the device's lookup can succeed.
  for (const type of [
    "Count",
    "Grams",
    "Minutes",
    "Rating",
    "Percent",
  ]) {
    it(`task created with ${type} result type round-trips a matching id through both /api/dashboard and /api/task-results`, async () => {
      const { token, homeId } = await auth();

      // Seeded task_results row for this display name. Each home
      // gets all 5 at quick-setup; the DB lookup confirms the
      // seeder ran and returns the canonical UUID.
      const seeded = await env.DB
        .prepare(
          "SELECT id FROM task_results WHERE home_id = ? AND display_name = ? AND is_deleted = 0",
        )
        .bind(homeId, type)
        .first<{ id: string }>();
      expect(
        seeded,
        `seeder must produce a "${type}" task_result for every new home`,
      ).not.toBeNull();
      const seededId = seeded!.id;

      // Create a task that points at this result type.
      const create = await SELF.fetch("https://t/api/tasks", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: `t-${type}`,
          kind: "ONESHOT",
          resultTypeId: seededId,
        }),
      });
      expect(create.status).toBe(201);

      // ── /api/task-results round-trip ─────────────────────────
      // The device reads this via fetchResultTypes() into
      // resultTypes_; the picker's findResultType() then matches
      // task.resultTypeId against entry.id.
      const trRes = await SELF.fetch("https://t/api/task-results", {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(trRes.status).toBe(200);
      const trBody = (await json(trRes)) as {
        taskResults: Array<{ id: string; displayName: string }>;
      };
      const matchingResultType = trBody.taskResults.find(
        (r) => r.id === seededId,
      );
      expect(
        matchingResultType,
        `/api/task-results must include the seeded "${type}" entry the task references`,
      ).toBeDefined();
      expect(matchingResultType?.displayName).toBe(type);

      // ── /api/dashboard round-trip ────────────────────────────
      // The device reads this via fetchDashboard() into
      // DashboardItem.resultTypeId; tapping seeds
      // pendingDone.resultTypeId. The id MUST be byte-identical
      // to the one task-results returned, otherwise the on-
      // device findResultType() walk produces nullptr and the
      // picker shows the empty-state placeholder.
      const dashRes = await SELF.fetch(
        "https://t/api/dashboard?include=hidden",
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(dashRes.status).toBe(200);
      const dashBody = (await json(dashRes)) as {
        tasks: Array<{ task: { id: string; resultTypeId: string | null } }>;
      };
      const dashboardRow = dashBody.tasks.find(
        (t) => t.task.resultTypeId === seededId,
      );
      expect(
        dashboardRow,
        `/api/dashboard task.resultTypeId must equal the id /api/task-results returned for "${type}"`,
      ).toBeDefined();
    });
  }
});

describe("device-token authorization (firmware-side mark-done)", () => {
  // Same per-call cf-connecting-ip pattern as the other suites —
  // these tests mint multiple homes / tokens and would otherwise
  // race the shared rate-limit bucket.
  let nextIp = 200;
  const auth = async () => {
    const ip = `10.0.2.${nextIp++}`;
    const res = await SELF.fetch("https://t/api/auth/quick-setup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": ip,
      },
      body: "{}",
    });
    const body = await json(res);
    return {
      token: body["token"] as string,
      homeId: body["homeId"] as string,
      userId: body["userId"] as string,
    };
  };

  // The dial pairs into a home and gets a DeviceToken. Subsequent
  // sync rounds + mark-done calls authenticate with that token,
  // not a UserToken. Several endpoints used to gate everything
  // behind requireUser() — the device's GETs returned 403 silently
  // and resultTypes_ / users_ stayed empty, breaking the post-done
  // pickers. These tests pin the device-token contract so a future
  // refactor can't quietly re-block the dial.
  const mintDeviceToken = async (homeId: string): Promise<string> => {
    const { issueDeviceToken } = await import("../src/auth.ts");
    const secret = (env as unknown as { AUTH_SECRET: string }).AUTH_SECRET;
    return issueDeviceToken(
      homeId,
      "0".repeat(20) + "abcdef012345",
      secret,
    );
  };

  it("device token can GET /api/task-results (was 403 — root cause of 'no result type')", async () => {
    const { homeId } = await auth();
    const deviceToken = await mintDeviceToken(homeId);

    const r = await SELF.fetch("https://t/api/task-results", {
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    expect(r.status).toBe(200);
    const body = (await json(r)) as {
      taskResults: Array<{ id: string; displayName: string }>;
    };
    // Seeded list — every new home gets all 5.
    const names = body.taskResults.map((t) => t.displayName).sort();
    expect(names).toEqual(["Count", "Grams", "Minutes", "Percent", "Rating"]);
  });

  it("device token can GET /api/users (UserPicker on the dial needs the home roster)", async () => {
    const { homeId } = await auth();
    const deviceToken = await mintDeviceToken(homeId);

    const r = await SELF.fetch("https://t/api/users", {
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    expect(r.status).toBe(200);
    const body = (await json(r)) as { users: Array<{ id: string }> };
    expect(body.users.length).toBeGreaterThan(0);
  });

  it("device token can POST /api/tasks/:id/complete (direct-completion path when no occurrence exists)", async () => {
    const { token: userToken, homeId } = await auth();
    const userHeaders = {
      authorization: `Bearer ${userToken}`,
      "content-type": "application/json",
    } as const;

    // Create a task as the user (creation stays user-only).
    const create = await SELF.fetch("https://t/api/tasks", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "device-completes-this", kind: "ONESHOT" }),
    });
    expect(create.status).toBe(201);
    const task = (await json(create)) as { id: string };

    // Now complete it via the device token. The device sends a
    // stable execution id (UUID) so the call is idempotent.
    const deviceToken = await mintDeviceToken(homeId);
    const executionId = "f".repeat(32);
    const complete = await SELF.fetch(
      `https://t/api/tasks/${task.id}/complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${deviceToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: executionId }),
      },
    );
    expect(complete.status).toBe(200);

    // Row landed in task_executions; userId NULL (device skipped
    // the UserPicker), device_id populated from the token.
    const row = await env.DB
      .prepare(
        "SELECT user_id, device_id FROM task_executions WHERE id = ?",
      )
      .bind(executionId)
      .first<{ user_id: string | null; device_id: string | null }>();
    expect(row?.user_id).toBeNull();
    expect(row?.device_id).not.toBeNull();
  });

  it("device-token mutations on user-only routes still 403 (POST /api/task-results, /api/users, etc.)", async () => {
    const { homeId } = await auth();
    const deviceToken = await mintDeviceToken(homeId);

    // Negative checks: the device must NOT be able to create /
    // delete result types or users. The per-route requireUser()
    // we re-armed on each mutation handler enforces this.
    const postResult = await SELF.fetch("https://t/api/task-results", {
      method: "POST",
      headers: {
        authorization: `Bearer ${deviceToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "X", unitName: "x", step: 1 }),
    });
    expect(postResult.status).toBe(403);

    const postUser = await SELF.fetch("https://t/api/users", {
      method: "POST",
      headers: {
        authorization: `Bearer ${deviceToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Mallory" }),
    });
    expect(postUser.status).toBe(403);

    const postTask = await SELF.fetch("https://t/api/tasks", {
      method: "POST",
      headers: {
        authorization: `Bearer ${deviceToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "rogue", kind: "ONESHOT" }),
    });
    expect(postTask.status).toBe(403);
  });
});

describe("task completion propagates to all clients", () => {
  // End-to-end pin: when the dial completes a task (via either the
  // occurrence-ack or the direct-complete path), the resulting
  // status change must (a) land in DB, (b) bump the home's
  // update_counter so the dial's next peek picks up the change,
  // (c) drop out of /api/occurrences/pending, (d) reflect on
  // /api/dashboard's lastExecutionAt + recompute urgency, and
  // (e) be visible to the webapp (user-token clients) without
  // any extra coordination.

  let nextIp = 300;
  const auth = async () => {
    const ip = `10.0.3.${nextIp++}`;
    const res = await SELF.fetch("https://t/api/auth/quick-setup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": ip,
      },
      body: "{}",
    });
    const body = await json(res);
    return {
      token: body["token"] as string,
      homeId: body["homeId"] as string,
      userId: body["userId"] as string,
    };
  };

  const mintDeviceToken = async (homeId: string): Promise<string> => {
    const { issueDeviceToken } = await import("../src/auth.ts");
    const secret = (env as unknown as { AUTH_SECRET: string }).AUTH_SECRET;
    return issueDeviceToken(
      homeId,
      "0".repeat(20) + "abcdef012345",
      secret,
    );
  };

  const peekCounter = async (token: string): Promise<number> => {
    const res = await SELF.fetch("https://t/api/homes/peek", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await json(res)) as { counter: number };
    return body.counter;
  };

  it("occurrence ack via device token: status flips, /pending drops, peek advances, dashboard sees lastExecutionAt, webapp sees the same", async () => {
    const { token: userToken, homeId } = await auth();
    const userHeaders = {
      authorization: `Bearer ${userToken}`,
      "content-type": "application/json",
    } as const;
    const deviceToken = await mintDeviceToken(homeId);

    // Create a task + insert a PENDING occurrence (skipping the
    // cron path so the test is deterministic).
    const create = await SELF.fetch("https://t/api/tasks", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "drink water", kind: "ONESHOT" }),
    });
    expect(create.status).toBe(201);
    const task = (await json(create)) as { id: string };

    const occId = "1".repeat(32);
    const nowMs = Date.now();
    await env.DB
      .prepare(
        `INSERT INTO occurrences (id, task_id, due_at, status,
           created_at, updated_at, is_deleted)
         VALUES (?, ?, ?, 'PENDING', ?, ?, 0)`,
      )
      .bind(occId, task.id, Math.floor(nowMs / 1000), nowMs, nowMs)
      .run();

    // ── Snapshot state before the ack ────────────────────────
    const counterBefore = await peekCounter(deviceToken);

    // Device's view of the pending list MUST include the occurrence
    // (sanity — if it doesn't, the rest of the test is meaningless).
    const pendingBefore = await SELF.fetch(
      "https://t/api/occurrences/pending",
      { headers: { authorization: `Bearer ${deviceToken}` } },
    );
    expect(pendingBefore.status).toBe(200);
    const pendingBeforeBody = (await json(pendingBefore)) as {
      occurrences: Array<{ id: string }>;
    };
    expect(
      pendingBeforeBody.occurrences.some((o) => o.id === occId),
      "occurrence must show up in /pending before the ack",
    ).toBe(true);

    // ── Device acks the occurrence ───────────────────────────
    const ack = await SELF.fetch(
      `https://t/api/occurrences/${occId}/ack`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${deviceToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ notes: "test-ack" }),
      },
    );
    expect(ack.status).toBe(200);
    expect((await json(ack))["status"]).toBe("ACKED");

    // ── (a) DB state ─────────────────────────────────────────
    const occRow = await env.DB
      .prepare("SELECT status, acked_at, acked_by_device_id FROM occurrences WHERE id = ?")
      .bind(occId)
      .first<{
        status: string;
        acked_at: number | null;
        acked_by_device_id: string | null;
      }>();
    expect(occRow?.status).toBe("ACKED");
    expect(occRow?.acked_at).not.toBeNull();
    expect(occRow?.acked_by_device_id).not.toBeNull();

    const execRows = await env.DB
      .prepare("SELECT id, ts, device_id FROM task_executions WHERE task_id = ?")
      .bind(task.id)
      .all<{ id: string; ts: number; device_id: string | null }>();
    expect(execRows.results).toHaveLength(1);
    expect(execRows.results[0]?.device_id).not.toBeNull();
    const execTs = execRows.results[0]!.ts;

    // ── (b) Peek counter advanced (slice-A triggers fired) ───
    const counterAfter = await peekCounter(deviceToken);
    expect(
      counterAfter,
      "ack must bump update_counter so the dial's next peek picks up the change",
    ).toBeGreaterThan(counterBefore);

    // ── (c) /pending no longer returns the occurrence ────────
    // Pinned for BOTH the device's view AND the webapp's
    // (user-token) view — a regression in either direction
    // means a client gets a stale "still pending" badge for an
    // already-completed occurrence.
    for (const [label, tok] of [
      ["device", deviceToken],
      ["user", userToken],
    ] as const) {
      const after = await SELF.fetch(
        "https://t/api/occurrences/pending",
        { headers: { authorization: `Bearer ${tok}` } },
      );
      expect(after.status).toBe(200);
      const afterBody = (await json(after)) as {
        occurrences: Array<{ id: string }>;
      };
      expect(
        afterBody.occurrences.some((o) => o.id === occId),
        `${label}-token /pending must NOT contain the acked occurrence`,
      ).toBe(false);
    }

    // ── (d) Dashboard reflects the new lastExecutionAt ───────
    // Slice B adds lastExecutionAt to /api/dashboard; the
    // device drives local urgency from it. After a fresh ack
    // it must equal the new task_executions.ts.
    for (const [label, tok] of [
      ["device", deviceToken],
      ["user", userToken],
    ] as const) {
      const dash = await SELF.fetch(
        "https://t/api/dashboard?include=hidden",
        { headers: { authorization: `Bearer ${tok}` } },
      );
      expect(dash.status).toBe(200);
      const dashBody = (await json(dash)) as {
        tasks: Array<{
          task: { id: string };
          lastExecutionAt: number | null;
        }>;
      };
      const row = dashBody.tasks.find((t) => t.task.id === task.id);
      expect(
        row,
        `${label}-token dashboard must still surface the task after ack (it's still active)`,
      ).toBeDefined();
      expect(
        row?.lastExecutionAt,
        `${label}-token dashboard must echo the new task_executions.ts`,
      ).toBe(execTs);
    }
  });

  it("direct task completion via device token: task_executions row, peek advances, /tasks/:id/executions reflects on user-token GET", async () => {
    const { token: userToken, homeId } = await auth();
    const userHeaders = {
      authorization: `Bearer ${userToken}`,
      "content-type": "application/json",
    } as const;
    const deviceToken = await mintDeviceToken(homeId);

    // Create a task without manually inserting an occurrence —
    // device hits /tasks/:id/complete directly.
    const create = await SELF.fetch("https://t/api/tasks", {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ title: "stretch", kind: "ONESHOT" }),
    });
    expect(create.status).toBe(201);
    const task = (await json(create)) as { id: string };

    const counterBefore = await peekCounter(deviceToken);

    const executionId = "e".repeat(32);
    const complete = await SELF.fetch(
      `https://t/api/tasks/${task.id}/complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${deviceToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: executionId }),
      },
    );
    expect(complete.status).toBe(200);

    // Counter advanced (task_executions INSERT fires the slice-A
    // trigger, same as occurrence ack).
    const counterAfter = await peekCounter(deviceToken);
    expect(counterAfter).toBeGreaterThan(counterBefore);

    // Webapp sees the execution via the per-task history endpoint
    // — same view the SPA's TaskDetail screen renders.
    const history = await SELF.fetch(
      `https://t/api/tasks/${task.id}/executions`,
      { headers: { authorization: `Bearer ${userToken}` } },
    );
    expect(history.status).toBe(200);
    const historyBody = (await json(history)) as {
      executions: Array<{ id: string; deviceId: string | null }>;
    };
    expect(historyBody.executions).toHaveLength(1);
    expect(historyBody.executions[0]?.id).toBe(executionId);
    // Device-id stamped on the execution row so the webapp can
    // surface "completed by the dial" attribution.
    expect(historyBody.executions[0]?.deviceId).not.toBeNull();
  });
});

describe("home update counter (peek-then-merge sync)", () => {
  // The rate-limit middleware keys quick-setup by cf-connecting-ip
  // and the bucket is shared across the whole vitest worker, so by
  // the time these tests run the earlier suites have eaten through
  // the 10/60 budget. Stamping a unique IP per call gives each test
  // its own bucket — same trick a real fleet would have naturally
  // since each device's outbound IP is distinct.
  let nextIp = 1;
  const auth = async () => {
    const ip = `10.0.0.${nextIp++}`;
    const res = await SELF.fetch("https://t/api/auth/quick-setup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": ip,
      },
      body: "{}",
    });
    const body = await json(res);
    return {
      token: body["token"] as string,
      homeId: body["homeId"] as string,
    };
  };

  const peek = async (token: string) =>
    json(
      await SELF.fetch("https://t/api/homes/peek", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );

  it("peek returns the current counter; increments on every home-scoped write", async () => {
    const a = await auth();

    // Backfill ran in the migration → first peek lands on a positive
    // counter. quick-setup also runs an INSERT homes + per-home
    // seed inserts (4 labels + 5 task_results + 1 user), so the
    // initial value is well above 1; we just assert it's positive
    // and stable across two reads.
    const initial = (await peek(a.token))["counter"] as number;
    expect(initial).toBeGreaterThan(0);
    expect((await peek(a.token))["counter"]).toBe(initial);

    // Each mutation bumps the counter by at least 1. Strict equality
    // on a delta of 1 is fragile against schema growth (e.g. tasks
    // INSERT also INSERTs a schedule row in the same batch); we
    // require monotonic-strict-increase instead.
    const create = await SELF.fetch("https://t/api/tasks", {
      method: "POST",
      headers: {
        authorization: `Bearer ${a.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "p1", kind: "ONESHOT" }),
    });
    expect(create.status).toBe(201);
    const afterCreate = (await peek(a.token))["counter"] as number;
    expect(afterCreate).toBeGreaterThan(initial);

    const t = (await json(create)) as { id: string };
    const patch = await SELF.fetch(`https://t/api/tasks/${t.id}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${a.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "p1-renamed" }),
    });
    expect(patch.status).toBe(200);
    const afterPatch = (await peek(a.token))["counter"] as number;
    expect(afterPatch).toBeGreaterThan(afterCreate);

    const del = await SELF.fetch(`https://t/api/tasks/${t.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${a.token}` },
    });
    // tasks DELETE soft-deletes and returns 204 (no body).
    expect(del.status).toBe(204);
    const afterDelete = (await peek(a.token))["counter"] as number;
    expect(afterDelete).toBeGreaterThan(afterPatch);
  });

  it("counters are isolated per home", async () => {
    const a = await auth();
    const b = await auth();

    const beforeA = (await peek(a.token))["counter"] as number;
    const beforeB = (await peek(b.token))["counter"] as number;

    // Mutating in home A must not advance home B's counter.
    await SELF.fetch("https://t/api/tasks", {
      method: "POST",
      headers: {
        authorization: `Bearer ${a.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "a-only", kind: "ONESHOT" }),
    });

    const afterA = (await peek(a.token))["counter"] as number;
    const afterB = (await peek(b.token))["counter"] as number;
    expect(afterA).toBeGreaterThan(beforeA);
    expect(afterB).toBe(beforeB);
  });

  it("peek requires auth", async () => {
    const res = await SELF.fetch("https://t/api/homes/peek");
    expect(res.status).toBe(401);
  });
});
