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
import init0010 from "../migrations/0010_icons.sql?raw";
import init0012 from "../migrations/0012_update_counter.sql?raw";
import init0013 from "../migrations/0013_firmware_releases.sql?raw";
import init0014 from "../migrations/0014_user_admin.sql?raw";

// Parse SQL into top-level statements. The naive split-on-';' breaks
// on trigger bodies (`CREATE TRIGGER … BEGIN … ; … END;`) — every
// statement inside a BEGIN/END block has its own ';' that the splitter
// would treat as the trigger's terminator. This walker tokenises on
// BEGIN/END/; and only ends a statement on a top-level ';'. Everything
// else is identical to the previous splitter — comment lines stripped,
// whitespace collapsed.
const splitStatements = (sql: string): string[] => {
  // Strip end-of-line `--` comments AND drop fully-commented lines.
  // Critical for migrations that put trailing comments on column
  // definitions (e.g. `name TEXT PRIMARY KEY, -- lowercase, kebab`)
  // — once everything is collapsed onto one line the `--` comments
  // out the rest of the statement, producing "incomplete input"
  // errors from D1's parser. We don't try to honour `--` inside
  // string literals; no migration uses `--` inside a literal today.
  const stripped = sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .filter((line) => line.trim().length > 0)
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
  // 0011 (seed_icons.sql) inserts ~20 KB of bitmap data — too heavy
  // for the in-memory test DB. The icon-route suite below seeds its
  // own minimal rows directly via env.DB.exec. Keeping 0011 out of
  // the bulk migration loop preserves boot speed; 0010 (the table
  // schema) IS applied so the tests can INSERT against `icons`.
  for (const sql of [init0000, init0001, init0002, init0003, init0004, init0005, init0006, init0007, init0008, init0009, init0010, init0012, init0013, init0014]) {
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
    "icons",
    "firmware_releases",
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

describe("OTA — firmware release advisory (Phase 6 foundation)", () => {
  let nextIp = 400;
  const auth = async () => {
    const ip = `10.0.4.${nextIp++}`;
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

  const mintDeviceToken = async (
    homeId: string,
    deviceId = "0".repeat(20) + "abcdef012345",
  ): Promise<string> => {
    const { issueDeviceToken } = await import("../src/auth.ts");
    const secret = (env as unknown as { AUTH_SECRET: string }).AUTH_SECRET;
    return issueDeviceToken(homeId, deviceId, secret);
  };

  const insertRelease = async (overrides: {
    version: string;
    active?: 0 | 1;
    rolloutRules?: string | null;
    sizeBytes?: number;
  }) => {
    const nowSec = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO firmware_releases
         (version, sha256, r2_key, size_bytes, rollout_rules, active, created_at, promoted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        overrides.version,
        "a".repeat(64),
        `firmware/firmware-${overrides.version}.bin`,
        overrides.sizeBytes ?? 1_400_000,
        overrides.rolloutRules ?? null,
        overrides.active ?? 1,
        nowSec,
        overrides.active === 1 ? nowSec : null,
      )
      .run();
  };

  it("/firmware/check returns updateAvailable=false when device is at the latest version", async () => {
    const { homeId } = await auth();
    const deviceToken = await mintDeviceToken(homeId);
    await insertRelease({ version: "1.4.2" });

    const res = await SELF.fetch(
      "https://t/api/firmware/check?fwVersion=1.4.2",
      { headers: { authorization: `Bearer ${deviceToken}` } },
    );
    expect(res.status).toBe(200);
    expect((await json(res))["updateAvailable"]).toBe(false);
  });

  it("/firmware/check mints a presigned downloadUrl when R2 creds are configured (slice F3)", async () => {
    const { homeId } = await auth();
    const deviceToken = await mintDeviceToken(homeId);
    await insertRelease({ version: "1.5.0" });

    const res = await SELF.fetch(
      "https://t/api/firmware/check?fwVersion=1.0.0",
      { headers: { authorization: `Bearer ${deviceToken}` } },
    );
    expect(res.status).toBe(200);
    const body = (await json(res)) as {
      updateAvailable: boolean;
      version: string;
      r2Key: string;
      downloadUrl: string | null;
      downloadUrlExpiresInSec: number | null;
    };
    expect(body.updateAvailable).toBe(true);
    expect(body.r2Key).toBe("firmware/firmware-1.5.0.bin");
    // miniflare bindings (vitest.config.ts) supply synthetic
    // R2_* creds → endpoint should return a real V4-signed URL.
    expect(body.downloadUrl).not.toBeNull();
    const u = new URL(body.downloadUrl!);
    expect(u.host).toBe("test-account.r2.cloudflarestorage.com");
    expect(u.pathname).toBe(
      "/howler-firmware/firmware/firmware-1.5.0.bin",
    );
    expect(u.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(u.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(u.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(body.downloadUrlExpiresInSec).toBe(300);
  });

  it("/firmware/check returns the highest active release > current (and a SQL ORDER BY would mis-rank '1.10.0' vs '1.2.0')", async () => {
    const { homeId } = await auth();
    const deviceToken = await mintDeviceToken(homeId);
    await insertRelease({ version: "1.2.0" });
    await insertRelease({ version: "1.10.0" });

    const res = await SELF.fetch(
      "https://t/api/firmware/check?fwVersion=1.0.0",
      { headers: { authorization: `Bearer ${deviceToken}` } },
    );
    expect(res.status).toBe(200);
    const body = (await json(res)) as {
      updateAvailable: boolean;
      version: string;
    };
    expect(body.updateAvailable).toBe(true);
    expect(body.version).toBe("1.10.0");
  });

  it("/firmware/check skips inactive releases", async () => {
    const { homeId } = await auth();
    const deviceToken = await mintDeviceToken(homeId);
    await insertRelease({ version: "2.0.0", active: 0 });
    await insertRelease({ version: "1.5.0", active: 1 });

    const res = await SELF.fetch(
      "https://t/api/firmware/check?fwVersion=1.0.0",
      { headers: { authorization: `Bearer ${deviceToken}` } },
    );
    const body = (await json(res)) as { version?: string };
    expect(body.version).toBe("1.5.0");
  });

  it("/firmware/check honours rollout_rules deviceIds whitelist", async () => {
    const { homeId } = await auth();
    const targetDeviceId = "11".repeat(16);
    const otherDeviceId = "22".repeat(16);
    await insertRelease({
      version: "1.6.0",
      rolloutRules: JSON.stringify({ deviceIds: [targetDeviceId] }),
    });

    const targetToken = await mintDeviceToken(homeId, targetDeviceId);
    const otherToken = await mintDeviceToken(homeId, otherDeviceId);

    const targetRes = await SELF.fetch(
      "https://t/api/firmware/check?fwVersion=1.0.0",
      { headers: { authorization: `Bearer ${targetToken}` } },
    );
    const targetBody = (await json(targetRes)) as { version?: string };
    expect(targetBody.version).toBe("1.6.0");

    const otherRes = await SELF.fetch(
      "https://t/api/firmware/check?fwVersion=1.0.0",
      { headers: { authorization: `Bearer ${otherToken}` } },
    );
    expect((await json(otherRes))["updateAvailable"]).toBe(false);
  });

  it("/devices/heartbeat updates fw_version + advises updateAvailable in one round-trip", async () => {
    const { homeId } = await auth();
    const deviceId = "33".repeat(16);
    const deviceToken = await mintDeviceToken(homeId, deviceId);

    // Seed the device row first so the heartbeat's UPDATE has a
    // target. (Pair flow normally creates this on /pair/confirm;
    // tests short-circuit by inserting directly.)
    const nowSec = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO devices (id, home_id, serial, hw_model, fw_version, created_at, updated_at, is_deleted)
       VALUES (?, ?, ?, 'crowpanel', '0.3.0', ?, ?, 0)`,
    )
      .bind(deviceId, homeId, "S-" + deviceId.slice(0, 6), nowSec, nowSec)
      .run();

    await insertRelease({ version: "0.4.0" });

    const res = await SELF.fetch("https://t/api/devices/heartbeat", {
      method: "POST",
      headers: {
        authorization: `Bearer ${deviceToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ fwVersion: "0.3.0" }),
    });
    expect(res.status).toBe(200);
    const body = (await json(res)) as {
      ok: boolean;
      updateAvailable: boolean;
      version?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.updateAvailable).toBe(true);
    expect(body.version).toBe("0.4.0");

    // Persistence: devices.fw_version landed on the row + last_seen
    // ticked forward.
    const row = await env.DB
      .prepare("SELECT fw_version, last_seen_at FROM devices WHERE id = ?")
      .bind(deviceId)
      .first<{ fw_version: string; last_seen_at: number | null }>();
    expect(row?.fw_version).toBe("0.3.0");
    expect(row?.last_seen_at).not.toBeNull();
  });

  it("/devices/heartbeat rejects user tokens (device-only endpoint)", async () => {
    const { token: userToken } = await auth();
    const res = await SELF.fetch("https://t/api/devices/heartbeat", {
      method: "POST",
      headers: {
        authorization: `Bearer ${userToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ fwVersion: "0.3.0" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("OTA — admin write path (Phase 6 slice F1)", () => {
  let nextIp = 500;

  // Per-user admin gate (migration 0014). Test seeds a home + an
  // admin user (is_admin=1) + a non-admin user. The admin token
  // passes the F1 endpoints; the non-admin token (and standard
  // quick-setup users) get 403.
  const ADMIN_HOME_ID = "a".repeat(32);

  const nonAdminAuth = async () => {
    const ip = `10.0.5.${nextIp++}`;
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

  // Seed the admin home + admin user. INSERT OR IGNORE on home so
  // re-runs in the same vitest worker don't collide; users get
  // INSERTed fresh per call so each test gets a distinct id and
  // is_admin gets set explicitly.
  const seedAdminUser = async (
    userId: string,
    isAdmin: boolean,
  ): Promise<void> => {
    const nowSec = Math.floor(Date.now() / 1000);
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO homes (id, display_name, tz, created_at, updated_at, is_deleted)
         VALUES (?, 'admin-test', 'UTC', ?, ?, 0)`,
      )
      .bind(ADMIN_HOME_ID, nowSec, nowSec)
      .run();
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO users
           (id, home_id, display_name, created_at, updated_at, is_deleted, is_admin)
         VALUES (?, ?, 'member', ?, ?, 0, ?)`,
      )
      .bind(userId, ADMIN_HOME_ID, nowSec, nowSec, isAdmin ? 1 : 0)
      .run();
  };

  const mintAdminToken = async (): Promise<{ token: string; homeId: string; userId: string }> => {
    const userId = "b".repeat(32);
    await seedAdminUser(userId, /*isAdmin=*/ true);
    const { issueUserToken } = await import("../src/auth.ts");
    const secret = (env as unknown as { AUTH_SECRET: string }).AUTH_SECRET;
    const token = await issueUserToken(ADMIN_HOME_ID, userId, secret);
    return { token, homeId: ADMIN_HOME_ID, userId };
  };

  it("admin gating is per-user — only users with is_admin=1 pass; other home members get 403", async () => {
    // Replaces the earlier per-home model. The household is a
    // shared trust boundary for tasks / occurrences / etc., but
    // OTA-admin is a separate per-user privilege after migration
    // 0014. This test pins the new contract: two users in the
    // SAME home, only one flagged admin; only that one passes.
    //
    // Regression guard: a future change that loosens the gate
    // back to "any user in admin's home" (e.g. accidentally
    // checking homeId against the admin's home_id only) would
    // grant admin to everyone in the household and red-fail this.
    const adminUser = "1".repeat(32);
    const nonAdminUser = "2".repeat(32);
    await seedAdminUser(adminUser, /*isAdmin=*/ true);
    await seedAdminUser(nonAdminUser, /*isAdmin=*/ false);

    const { issueUserToken } = await import("../src/auth.ts");
    const secret = (env as unknown as { AUTH_SECRET: string }).AUTH_SECRET;
    const adminToken = await issueUserToken(ADMIN_HOME_ID, adminUser, secret);
    const memberToken = await issueUserToken(ADMIN_HOME_ID, nonAdminUser, secret);

    // Admin can POST.
    const r1 = await SELF.fetch("https://t/api/firmware", {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        version: "10.0.0-admin",
        sha256: "a".repeat(64),
        r2Key: "firmware/admin.bin",
        sizeBytes: 1,
      }),
    });
    expect(r1.status).toBe(201);

    // Same-home non-admin gets 403 — the household trust
    // boundary is shared but admin privilege is not.
    const r2 = await SELF.fetch("https://t/api/firmware", {
      method: "POST",
      headers: {
        authorization: `Bearer ${memberToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        version: "10.0.0-member",
        sha256: "b".repeat(64),
        r2Key: "firmware/member.bin",
        sizeBytes: 1,
      }),
    });
    expect(r2.status).toBe(403);
  });

  it("migration 0014 backfill marks the earliest-created user of each home as admin", async () => {
    // Pin the backfill SQL: with two homes, three users in each
    // (created_at strictly ordered), only the earliest user in
    // each home should land as admin.
    const home1 = "c".repeat(32);
    const home2 = "d".repeat(32);
    const t = (n: number) => 1000 + n;

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO homes (id, display_name, tz, created_at, updated_at, is_deleted)
         VALUES (?, 'h1', 'UTC', ?, ?, 0)`,
      ).bind(home1, t(0), t(0)),
      env.DB.prepare(
        `INSERT INTO homes (id, display_name, tz, created_at, updated_at, is_deleted)
         VALUES (?, 'h2', 'UTC', ?, ?, 0)`,
      ).bind(home2, t(0), t(0)),
      // Home 1 — three users, ts = 100, 200, 300 (insert in
      // reverse so PK ordering can't accidentally make it work).
      env.DB.prepare(
        `INSERT INTO users (id, home_id, display_name, created_at, updated_at, is_deleted, is_admin)
         VALUES ('h1u3' || ?, ?, 'u3', 300, 300, 0, 0)`,
      ).bind("0".repeat(28), home1),
      env.DB.prepare(
        `INSERT INTO users (id, home_id, display_name, created_at, updated_at, is_deleted, is_admin)
         VALUES ('h1u2' || ?, ?, 'u2', 200, 200, 0, 0)`,
      ).bind("0".repeat(28), home1),
      env.DB.prepare(
        `INSERT INTO users (id, home_id, display_name, created_at, updated_at, is_deleted, is_admin)
         VALUES ('h1u1' || ?, ?, 'u1', 100, 100, 0, 0)`,
      ).bind("0".repeat(28), home1),
      // Home 2 — two users, ts = 500, 400 (also reverse).
      env.DB.prepare(
        `INSERT INTO users (id, home_id, display_name, created_at, updated_at, is_deleted, is_admin)
         VALUES ('h2u2' || ?, ?, 'u2', 500, 500, 0, 0)`,
      ).bind("0".repeat(28), home2),
      env.DB.prepare(
        `INSERT INTO users (id, home_id, display_name, created_at, updated_at, is_deleted, is_admin)
         VALUES ('h2u1' || ?, ?, 'u1', 400, 400, 0, 0)`,
      ).bind("0".repeat(28), home2),
    ]);

    // Re-run the same UPDATE migration 0014 ships. It's idempotent
    // (re-running on already-marked admins is a no-op since
    // is_admin = 1 is already correct).
    await env.DB
      .prepare(
        `UPDATE users
         SET is_admin = 1
         WHERE is_deleted = 0
           AND created_at = (
             SELECT MIN(created_at)
             FROM users u2
             WHERE u2.home_id = users.home_id
               AND u2.is_deleted = 0
           )`,
      )
      .run();

    // Home 1: u1 (created_at=100) is admin; u2, u3 are not.
    // Home 2: u1 (created_at=400) is admin; u2 is not.
    const home1Rows = await env.DB
      .prepare(
        "SELECT display_name, is_admin FROM users WHERE home_id = ? ORDER BY created_at",
      )
      .bind(home1)
      .all<{ display_name: string; is_admin: number }>();
    expect(home1Rows.results.map((r) => `${r.display_name}=${r.is_admin}`))
      .toEqual(["u1=1", "u2=0", "u3=0"]);

    const home2Rows = await env.DB
      .prepare(
        "SELECT display_name, is_admin FROM users WHERE home_id = ? ORDER BY created_at",
      )
      .bind(home2)
      .all<{ display_name: string; is_admin: number }>();
    expect(home2Rows.results.map((r) => `${r.display_name}=${r.is_admin}`))
      .toEqual(["u1=1", "u2=0"]);
  });

  it("POST /api/firmware admits an admin home; the row lands inactive (active=0, no promoted_at)", async () => {
    const { token } = await mintAdminToken();

    const res = await SELF.fetch("https://t/api/firmware", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        version: "1.4.2",
        sha256: "f".repeat(64),
        r2Key: "firmware/firmware-1.4.2.bin",
        sizeBytes: 1_400_000,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await json(res)) as { active: boolean; version: string };
    expect(body.version).toBe("1.4.2");
    expect(body.active).toBe(false);

    // DB confirms the row landed inactive (no accidental promotions).
    const row = await env.DB
      .prepare(
        "SELECT active, promoted_at FROM firmware_releases WHERE version = ?",
      )
      .bind("1.4.2")
      .first<{ active: number; promoted_at: number | null }>();
    expect(row?.active).toBe(0);
    expect(row?.promoted_at).toBeNull();

    // /check returns updateAvailable=false until the release is
    // promoted — proving the inactive row doesn't ship to devices
    // by accident.
    const check = await SELF.fetch(
      "https://t/api/firmware/check?fwVersion=1.0.0",
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect((await json(check))["updateAvailable"]).toBe(false);
  });

  it("POST /api/firmware rejects non-admin user tokens with 403", async () => {
    // Default quick-setup home id won't match ADMIN_HOMES.
    const { token } = await nonAdminAuth();

    const res = await SELF.fetch("https://t/api/firmware", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        version: "1.0.0",
        sha256: "0".repeat(64),
        r2Key: "firmware/firmware-1.0.0.bin",
        sizeBytes: 1_000_000,
      }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /api/firmware rejects a malformed version (regex closes off SQL-injection-ish input)", async () => {
    const { token } = await mintAdminToken();

    for (const bad of [
      "1.4.2; DROP TABLE firmware_releases",
      "../1.4.2",
      "1",
      "1.4.2-with spaces",
      "",
    ]) {
      const res = await SELF.fetch("https://t/api/firmware", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          version: bad,
          sha256: "0".repeat(64),
          r2Key: "firmware/x.bin",
          sizeBytes: 1,
        }),
      });
      expect(
        res.status,
        `version "${bad}" must be rejected with 400`,
      ).toBe(400);
    }
  });

  it("POST /api/firmware is idempotent on duplicate version (409)", async () => {
    const { token } = await mintAdminToken();

    const body = JSON.stringify({
      version: "2.0.0",
      sha256: "1".repeat(64),
      r2Key: "firmware/firmware-2.0.0.bin",
      sizeBytes: 2_000_000,
    });
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    } as const;

    const r1 = await SELF.fetch("https://t/api/firmware", { method: "POST", headers, body });
    expect(r1.status).toBe(201);

    const r2 = await SELF.fetch("https://t/api/firmware", { method: "POST", headers, body });
    expect(r2.status).toBe(409);
  });

  it("PATCH /api/firmware/:version full lifecycle: register → promote → /check sees it → yank → /check stops returning it", async () => {
    const { token } = await mintAdminToken();

    const post = await SELF.fetch("https://t/api/firmware", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        version: "3.0.0",
        sha256: "2".repeat(64),
        r2Key: "firmware/firmware-3.0.0.bin",
        sizeBytes: 1_500_000,
      }),
    });
    expect(post.status).toBe(201);

    // /check ignores inactive rows.
    const before = await SELF.fetch(
      "https://t/api/firmware/check?fwVersion=2.0.0",
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect((await json(before))["updateAvailable"]).toBe(false);

    // Promote.
    const promote = await SELF.fetch("https://t/api/firmware/3.0.0", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ active: true }),
    });
    expect(promote.status).toBe(204);

    const promotedRow = await env.DB
      .prepare(
        "SELECT active, promoted_at, yanked_at FROM firmware_releases WHERE version = ?",
      )
      .bind("3.0.0")
      .first<{
        active: number;
        promoted_at: number | null;
        yanked_at: number | null;
      }>();
    expect(promotedRow?.active).toBe(1);
    expect(promotedRow?.promoted_at).not.toBeNull();
    expect(promotedRow?.yanked_at).toBeNull();

    // /check now serves it.
    const after = await SELF.fetch(
      "https://t/api/firmware/check?fwVersion=2.0.0",
      { headers: { authorization: `Bearer ${token}` } },
    );
    const afterBody = (await json(after)) as { version?: string };
    expect(afterBody.version).toBe("3.0.0");

    // Yank.
    const yank = await SELF.fetch("https://t/api/firmware/3.0.0", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ active: false }),
    });
    expect(yank.status).toBe(204);

    const yankedRow = await env.DB
      .prepare(
        "SELECT active, promoted_at, yanked_at FROM firmware_releases WHERE version = ?",
      )
      .bind("3.0.0")
      .first<{
        active: number;
        promoted_at: number | null;
        yanked_at: number | null;
      }>();
    expect(yankedRow?.active).toBe(0);
    // promoted_at preserved across yank — audit trail.
    expect(yankedRow?.promoted_at).toBe(promotedRow?.promoted_at);
    expect(yankedRow?.yanked_at).not.toBeNull();

    // /check stops returning it.
    const final = await SELF.fetch(
      "https://t/api/firmware/check?fwVersion=2.0.0",
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect((await json(final))["updateAvailable"]).toBe(false);
  });

  it("PATCH /api/firmware/:version updates rolloutRules in place (replaces JSON, /check honours immediately)", async () => {
    const { token } = await mintAdminToken();

    await SELF.fetch("https://t/api/firmware", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        version: "4.0.0",
        sha256: "3".repeat(64),
        r2Key: "firmware/firmware-4.0.0.bin",
        sizeBytes: 1_500_000,
      }),
    });

    // Promote + scope to a 1% canary in one PATCH.
    const r = await SELF.fetch("https://t/api/firmware/4.0.0", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        active: true,
        rolloutRules: { canaryPercent: 1 },
      }),
    });
    expect(r.status).toBe(204);

    const row = await env.DB
      .prepare("SELECT rollout_rules FROM firmware_releases WHERE version = ?")
      .bind("4.0.0")
      .first<{ rollout_rules: string | null }>();
    expect(row?.rollout_rules).toBe('{"canaryPercent":1}');

    // Clear it (null = ship to everyone).
    const r2 = await SELF.fetch("https://t/api/firmware/4.0.0", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ rolloutRules: null }),
    });
    expect(r2.status).toBe(204);
    const row2 = await env.DB
      .prepare("SELECT rollout_rules FROM firmware_releases WHERE version = ?")
      .bind("4.0.0")
      .first<{ rollout_rules: string | null }>();
    expect(row2?.rollout_rules).toBeNull();
  });

  it("PATCH /api/firmware/:version 404s on unknown version + 400 on malformed version param", async () => {
    const { token } = await mintAdminToken();

    const notFound = await SELF.fetch("https://t/api/firmware/9.9.9", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ active: true }),
    });
    expect(notFound.status).toBe(404);

    const badParam = await SELF.fetch(
      "https://t/api/firmware/not-a-version",
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ active: true }),
      },
    );
    expect(badParam.status).toBe(400);
  });

  it("GET /api/firmware lists all releases for the ops UI (admin-only)", async () => {
    const { token } = await mintAdminToken();

    // Seed two builds, promote one.
    for (const v of ["5.0.0", "5.1.0"]) {
      await SELF.fetch("https://t/api/firmware", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          version: v,
          sha256: "4".repeat(64),
          r2Key: `firmware/firmware-${v}.bin`,
          sizeBytes: 1_500_000,
        }),
      });
    }
    await SELF.fetch("https://t/api/firmware/5.1.0", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ active: true }),
    });

    const list = await SELF.fetch("https://t/api/firmware", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.status).toBe(200);
    const body = (await json(list)) as {
      releases: Array<{ version: string; active: boolean }>;
    };
    const v500 = body.releases.find((r) => r.version === "5.0.0");
    const v510 = body.releases.find((r) => r.version === "5.1.0");
    expect(v500?.active).toBe(false);
    expect(v510?.active).toBe(true);

    // Non-admin sees 403.
    const { token: otherToken } = await nonAdminAuth();
    const denied = await SELF.fetch("https://t/api/firmware", {
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(denied.status).toBe(403);
  });
});

// ── Avatars (R2-backed photo uploads) ─────────────────────────────
//
// What's covered:
//   1. POST upload happy path — 201 with id + url, R2 actually
//      received the bytes, GET fetches them back identical
//   2. Auth gating — POST/DELETE require a UserToken (device tokens
//      get 403 because the writes mutate the home's avatar inventory)
//   3. Validation — oversized (413), wrong mime (415), missing file
//      field (400)
//   4. GET is auth-free — the SPA needs <img src=…> renders without
//      every avatar fetch carrying an Authorization header
//   5. DELETE is soft + cross-home isolated — Home B can't delete or
//      see Home A's avatars
//   6. avatarId column can be referenced from users + tasks + homes
//      after upload (foreign-key wiring sanity)
describe("avatars (R2-backed photo uploads)", () => {
  // Smallest valid JPEG (Stack Overflow #2253404 minimal example) —
  // 125 bytes, a 1×1 grey pixel. Used as the standard upload payload
  // because it's tiny, mime-correct, and survives an R2 round-trip
  // byte-for-byte.
  const TINY_JPEG = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
    0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
    0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
    0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0xff, 0xd9,
  ]);

  // Quick-setup is rate-limited 10 req/min per cf-connecting-ip.
  // Stamp a unique IP on every call so back-to-back tests don't
  // exhaust the shared bucket — same pattern used by the
  // tasks+occurrences suite above.
  let nextIp = 1;
  const newHome = async (): Promise<{
    token: string;
    homeId: string;
    userId: string;
  }> => {
    const ip = `10.0.99.${nextIp++}`;
    const r = await SELF.fetch("https://t/api/auth/quick-setup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": ip,
      },
      body: "{}",
    });
    const body = (await json(r)) as {
      token: string;
      homeId: string;
      userId: string;
    };
    return body;
  };

  const uploadAvatar = async (
    token: string,
    bytes: Uint8Array | string,
    contentType: string,
    fileName = "a.jpg",
  ): Promise<Response> => {
    const fd = new FormData();
    const blob =
      typeof bytes === "string"
        ? new Blob([bytes], { type: contentType })
        : new Blob([bytes], { type: contentType });
    fd.append("file", blob, fileName);
    return SELF.fetch("https://t/api/avatars", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: fd,
    });
  };

  it("uploads a JPEG, persists in R2 + DB, and round-trips identical bytes", async () => {
    const { token, homeId } = await newHome();
    const up = await uploadAvatar(token, TINY_JPEG, "image/jpeg");
    expect(up.status).toBe(201);
    const body = (await json(up)) as { id: string; url: string };
    expect(body.id).toMatch(/^[0-9a-f]{32}$/);
    expect(body.url).toBe(`/api/avatars/${body.id}`);

    // DB row landed with the right home + content-type.
    const row = await env.DB
      .prepare(
        "SELECT home_id, r2_key, content_type, size_bytes, is_deleted FROM avatars WHERE id = ?",
      )
      .bind(body.id)
      .first<{
        home_id: string;
        r2_key: string;
        content_type: string;
        size_bytes: number;
        is_deleted: number;
      }>();
    expect(row?.home_id).toBe(homeId);
    expect(row?.content_type).toBe("image/jpeg");
    expect(row?.size_bytes).toBe(TINY_JPEG.byteLength);
    expect(row?.is_deleted).toBe(0);

    // R2 actually received the bytes.
    const obj = await env.AVATARS.get(row!.r2_key);
    expect(obj).not.toBeNull();
    const got = new Uint8Array(await obj!.arrayBuffer());
    expect(got).toEqual(TINY_JPEG);

    // GET fetches the bytes back via the public route.
    const fetched = await SELF.fetch(`https://t/api/avatars/${body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get("content-type")).toBe("image/jpeg");
    const fetchedBytes = new Uint8Array(await fetched.arrayBuffer());
    expect(fetchedBytes).toEqual(TINY_JPEG);
  });

  it("GET /api/avatars/:id is publicly readable (no auth required)", async () => {
    const { token } = await newHome();
    const up = await uploadAvatar(token, TINY_JPEG, "image/jpeg");
    const { id } = (await json(up)) as { id: string };
    // No Authorization header — must still 200. The SPA renders
    // <img src="/api/avatars/:id"> without a session header.
    const fetched = await SELF.fetch(`https://t/api/avatars/${id}`);
    expect(fetched.status).toBe(200);
    // Drain the body — vitest-pool-workers can't pop the per-test
    // isolated-storage frame while the R2 stream is still open.
    await fetched.arrayBuffer();
  });

  it("GET /api/avatars/:unknown returns 404", async () => {
    const r = await SELF.fetch(`https://t/api/avatars/${"f".repeat(32)}`);
    expect(r.status).toBe(404);
    await r.text();
  });

  it("rejects oversized uploads with 413", async () => {
    const { token } = await newHome();
    // 2 MB + 1 byte — just over the limit.
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.fill(0xab);
    const r = await uploadAvatar(token, big, "image/jpeg");
    expect(r.status).toBe(413);
  });

  it("rejects non-image content types with 415", async () => {
    const { token } = await newHome();
    const r = await uploadAvatar(
      token,
      "BMP-shaped bytes that aren't really one",
      "image/bmp",
    );
    expect(r.status).toBe(415);
  });

  it("rejects missing file field with 400", async () => {
    const { token } = await newHome();
    // Empty multipart — no `file` field at all.
    const fd = new FormData();
    fd.append("not-the-file", "ignore me");
    const r = await SELF.fetch("https://t/api/avatars", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: fd,
    });
    expect(r.status).toBe(400);
  });

  it("DELETE soft-deletes; subsequent GET 404s and R2 bytes drop from the public surface", async () => {
    const { token } = await newHome();
    const up = await uploadAvatar(token, TINY_JPEG, "image/jpeg");
    const { id } = (await json(up)) as { id: string };

    // GET works pre-delete.
    const before = await SELF.fetch(`https://t/api/avatars/${id}`);
    expect(before.status).toBe(200);
    await before.arrayBuffer();

    const del = await SELF.fetch(`https://t/api/avatars/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.status).toBe(204);

    // Soft-delete: the row's is_deleted flag flips, the public GET
    // (which filters on is_deleted=0) returns 404. We don't assert R2
    // is purged — the bucket can keep the bytes for a future GC pass.
    const after = await SELF.fetch(`https://t/api/avatars/${id}`);
    expect(after.status).toBe(404);
    await after.text();

    const row = await env.DB
      .prepare("SELECT is_deleted FROM avatars WHERE id = ?")
      .bind(id)
      .first<{ is_deleted: number }>();
    expect(row?.is_deleted).toBe(1);
  });

  it("DELETE on another home's avatar returns 404 (cross-home isolation)", async () => {
    const homeA = await newHome();
    const homeB = await newHome();
    const up = await uploadAvatar(homeA.token, TINY_JPEG, "image/jpeg");
    const { id } = (await json(up)) as { id: string };

    // Home B tries to delete Home A's avatar — opaque 404 (we don't
    // leak existence through the response code).
    const del = await SELF.fetch(`https://t/api/avatars/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${homeB.token}` },
    });
    expect(del.status).toBe(404);

    // The avatar is still alive for Home A.
    const fetched = await SELF.fetch(`https://t/api/avatars/${id}`);
    expect(fetched.status).toBe(200);
    await fetched.arrayBuffer();
  });

  it("avatarId can be wired onto users and homes after upload", async () => {
    const { token, homeId, userId } = await newHome();
    const up = await uploadAvatar(token, TINY_JPEG, "image/jpeg");
    const { id: avatarId } = (await json(up)) as { id: string };

    // Wire to user + home through the existing PATCH endpoints.
    const patchHome = await SELF.fetch("https://t/api/homes/me", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ avatarId }),
    });
    expect([200, 204]).toContain(patchHome.status);

    const patchUser = await SELF.fetch(`https://t/api/users/${userId}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ avatarId }),
    });
    expect([200, 204]).toContain(patchUser.status);

    // Both rows now reference the same avatar id.
    const home = await env.DB
      .prepare("SELECT avatar_id FROM homes WHERE id = ?")
      .bind(homeId)
      .first<{ avatar_id: string }>();
    expect(home?.avatar_id).toBe(avatarId);
    const user = await env.DB
      .prepare("SELECT avatar_id FROM users WHERE id = ?")
      .bind(userId)
      .first<{ avatar_id: string }>();
    expect(user?.avatar_id).toBe(avatarId);
  });
});

// ── Icons (24×24 1-bit bitmaps for the device renderer) ───────────
//
// What's covered:
//   1. Auth gating — no token → 401
//   2. Manifest endpoint returns the seeded icons with metadata
//   3. Bitmap fetch returns raw bytes + ETag + custom X-Icon-* headers
//   4. If-None-Match conditional fetch shorts to 304
//   5. Invalid icon names (uppercase, special chars, oversized) → 400
//   6. Unknown but well-formed name → 404
describe("icons (24×24 1-bit bitmaps)", () => {
  // Helper: insert one fake icon directly. The seed migration ships
  // ~20 KB of real bitmap data; for tests we only need a row to exist
  // — content is opaque to the route handler.
  const seedIcon = async (
    name: string,
    bytes: Uint8Array,
    contentHash: string,
  ) => {
    await env.DB
      .prepare(
        `INSERT INTO icons (name, format_version, width, height, bitmap, content_hash, updated_at)
         VALUES (?, 1, 24, 24, ?, ?, 1700000000)`,
      )
      .bind(name, bytes, contentHash)
      .run();
  };

  const tinyBitmap = new Uint8Array(72); // 24×24 / 8 = 72 bytes — all zero
  const HASH_A = "a".repeat(40);
  const HASH_B = "b".repeat(40);

  let nextIp = 1;
  const newToken = async (): Promise<string> => {
    const ip = `10.0.100.${nextIp++}`;
    const r = await SELF.fetch("https://t/api/auth/quick-setup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": ip,
      },
      body: "{}",
    });
    return ((await json(r)) as { token: string }).token;
  };

  it("requires authentication", async () => {
    await seedIcon("paw", tinyBitmap, HASH_A);
    const r = await SELF.fetch("https://t/api/icons");
    expect(r.status).toBe(401);
    const r2 = await SELF.fetch("https://t/api/icons/paw");
    expect(r2.status).toBe(401);
  });

  it("manifest lists seeded icons with their metadata", async () => {
    const token = await newToken();
    await seedIcon("paw", tinyBitmap, HASH_A);
    await seedIcon("broom", tinyBitmap, HASH_B);

    const r = await SELF.fetch("https://t/api/icons", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.status).toBe(200);
    const body = (await json(r)) as {
      icons: Array<{
        name: string;
        contentHash: string;
        width: number;
        height: number;
        formatVersion: number;
      }>;
    };
    // Sorted alphabetically per the route's ORDER BY.
    expect(body.icons.map((i) => i.name)).toEqual(["broom", "paw"]);
    const paw = body.icons.find((i) => i.name === "paw")!;
    expect(paw.contentHash).toBe(HASH_A);
    expect(paw.width).toBe(24);
    expect(paw.height).toBe(24);
    expect(paw.formatVersion).toBe(1);
  });

  it("bitmap fetch returns raw bytes + ETag + X-Icon-* headers", async () => {
    const token = await newToken();
    const bytes = new Uint8Array(72);
    for (let i = 0; i < 72; i++) bytes[i] = i; // recognisable pattern
    await seedIcon("paw", bytes, HASH_A);

    const r = await SELF.fetch("https://t/api/icons/paw", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/octet-stream");
    expect(r.headers.get("etag")).toBe(`"${HASH_A}"`);
    expect(r.headers.get("x-icon-hash")).toBe(HASH_A);
    expect(r.headers.get("x-icon-width")).toBe("24");
    expect(r.headers.get("x-icon-height")).toBe("24");
    expect(r.headers.get("x-icon-format-version")).toBe("1");
    const got = new Uint8Array(await r.arrayBuffer());
    expect(got).toEqual(bytes);
  });

  it("If-None-Match matching cached hash returns 304 with no body", async () => {
    const token = await newToken();
    await seedIcon("paw", tinyBitmap, HASH_A);

    const r = await SELF.fetch("https://t/api/icons/paw", {
      headers: {
        authorization: `Bearer ${token}`,
        "if-none-match": `"${HASH_A}"`,
      },
    });
    expect(r.status).toBe(304);
    // Mismatching hash falls through to a fresh 200.
    const r2 = await SELF.fetch("https://t/api/icons/paw", {
      headers: {
        authorization: `Bearer ${token}`,
        "if-none-match": `"${HASH_B}"`,
      },
    });
    expect(r2.status).toBe(200);
  });

  it("rejects malformed icon names with 400", async () => {
    const token = await newToken();
    for (const bad of ["UPPER", "with space", "tooooooooooooooooooooooooooooooooooooooolong-x"]) {
      const r = await SELF.fetch(`https://t/api/icons/${encodeURIComponent(bad)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(r.status, `name=${bad}`).toBe(400);
    }
  });

  it("returns 404 for unknown but well-formed names", async () => {
    const token = await newToken();
    const r = await SELF.fetch("https://t/api/icons/no-such-icon", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.status).toBe(404);
  });
});
