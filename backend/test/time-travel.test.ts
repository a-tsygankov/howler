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
import { resetClock, setClock, TestClock } from "../src/clock.ts";

// Demonstrates the injectable-clock pattern (plan §3 / `src/clock.ts`).
// Each test installs a TestClock, advances it deterministically, and
// asserts the production code observes the new "now" — no real-time
// sleep, no flake. Pattern reusable for any time-driven invariant
// (token TTL, pair-code expiry, schedule next-fire, etc.).

const T0_MS = 1_700_000_000_000; // arbitrary anchor (2023-11-14 UTC)
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const applyMigrations = async () => {
  for (const sql of [init0000, init0001, init0002, init0003, init0004, init0005, init0006]) {
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
afterEach(() => {
  resetClock();
});

const json = async (res: Response): Promise<Record<string, unknown>> =>
  (await res.json()) as Record<string, unknown>;

describe("UserToken expiry — fast-forward 30 days", () => {
  it("UserToken survives 7 days but expires after 30", async () => {
    // Mint a UserToken at T0.
    const setup = await SELF.fetch("https://t/api/auth/quick-setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(setup.status).toBe(201);
    const { token } = (await json(setup)) as { token: string };

    // T0 + 7d: token still works.
    testClock.advanceDays(7);
    const me1 = await SELF.fetch("https://t/api/auth/me", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me1.status).toBe(200);

    // T0 + 31d: past the 30-day TTL → token rejected.
    testClock.advanceDays(24);
    const me2 = await SELF.fetch("https://t/api/auth/me", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me2.status).toBe(401);
  });
});

describe("Pair code expiry — fast-forward past 3-min window", () => {
  it("/pair/check goes pending → expired without any sleep", async () => {
    const deviceId = "a".repeat(32);
    const start = await SELF.fetch("https://t/api/pair/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId, hwModel: "DIAL" }),
    });
    expect(start.status).toBe(200);

    // Immediately: still pending.
    const chk1 = await SELF.fetch("https://t/api/pair/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
    expect((await json(chk1))["status"]).toBe("pending");

    // T0 + 4 minutes: past the 180-second TTL.
    testClock.advanceMs(4 * 60 * 1000);
    const chk2 = await SELF.fetch("https://t/api/pair/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
    expect((await json(chk2))["status"]).toBe("expired");
  });
});

describe("login-qr token expiry — 60 second TTL", () => {
  it("token honoured within 60 s, rejected at 61 s", async () => {
    const deviceId = "b".repeat(32);
    // Pair a device (gives us a DeviceToken).
    const start = await SELF.fetch("https://t/api/pair/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
    const { pairCode } = (await json(start)) as { pairCode: string };
    await SELF.fetch("https://t/api/auth/quick-setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairCode }),
    });
    const chk = await SELF.fetch("https://t/api/pair/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
    const { deviceToken } = (await json(chk)) as { deviceToken: string };

    // Mint a one-shot QR token at T0+30m (well after pair, well within
    // DeviceToken's 365-day life).
    testClock.advanceMs(30 * 60 * 1000);
    const ltc = await SELF.fetch("https://t/api/auth/login-token-create", {
      method: "POST",
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    const { token: qr } = (await json(ltc)) as { token: string };

    // 30 seconds later — still valid, exchange succeeds.
    testClock.advanceMs(30 * 1000);
    const ok = await SELF.fetch("https://t/api/auth/login-qr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId, token: qr }),
    });
    expect(ok.status).toBe(200);

    // Mint another (the previous is now consumed) and let it run out.
    const ltc2 = await SELF.fetch("https://t/api/auth/login-token-create", {
      method: "POST",
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    const { token: qr2 } = (await json(ltc2)) as { token: string };
    testClock.advanceMs(61 * 1000);
    const expired = await SELF.fetch("https://t/api/auth/login-qr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId, token: qr2 }),
    });
    expect(expired.status).toBe(410);
  });
});

describe("clock sentinel — production code is wired", () => {
  // If a future PR re-introduces a raw Date.now() in production code,
  // this test catches it: every timestamp the API writes should match
  // the test clock to the second, never wall-clock time.
  it("a freshly-created task carries the test-clock createdAt", async () => {
    const setup = await SELF.fetch("https://t/api/auth/quick-setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const { token } = (await json(setup)) as { token: string };

    testClock.set(T0_MS + 5 * ONE_DAY_MS);
    const create = await SELF.fetch("https://t/api/tasks", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "test-clock proof", kind: "ONESHOT" }),
    });
    const task = (await json(create)) as { createdAt: number };
    expect(task.createdAt).toBe(T0_MS + 5 * ONE_DAY_MS);
  });
});
