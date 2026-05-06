import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../env.ts";
import {
  buildClearSessionCookie,
  buildSessionCookie,
  hashPin,
  isTransparentUser,
  issueSelectorToken,
  issueUserToken,
  verifySelectorToken,
  verifyPin,
} from "../auth.ts";
import { recordAuthLog } from "../audit.ts";
import { newUuid } from "../domain/ids.ts";
import {
  LoginQrSchema,
  LoginSchema,
  QuickSetupSchema,
  SelectUserSchema,
  SetPinSchema,
  SetupSchema,
} from "../shared/schemas.ts";
import { requireAuth, requireUser, type AuthVars } from "../middleware/auth.ts";
import { seedHomeDefaults } from "../services/home-seed.ts";

const QR_TOKEN_TTL_SEC = 60;
const QUICK_SETUP_PREFIX = "home-";
const QUICK_SETUP_RAND_HEX = 8;

const randomHex = (bytes: number): string => {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
};

const requireSecret = (env: Bindings): string => {
  if (!env.AUTH_SECRET) throw new Error("AUTH_SECRET not configured");
  return env.AUTH_SECRET;
};

interface HomeRow {
  id: string;
  display_name: string;
  login: string | null;
  pin_salt: string | null;
  pin_hash: string | null;
  tz: string;
}

interface UserRow {
  id: string;
  home_id: string;
  display_name: string;
  login: string | null;
}

interface SelectorResponseUser {
  id: string;
  displayName: string;
}

const selectorResponse = (
  selectorToken: string,
  homeId: string,
  users: UserRow[],
): {
  selectorToken: string;
  homeId: string;
  users: SelectorResponseUser[];
} => ({
  selectorToken,
  homeId,
  users: users.map((u) => ({ id: u.id, displayName: u.display_name })),
});

// Quick path: when a home has exactly one user, the caller never has
// to pick — we mint the UserToken directly.
const directUserResponse = async (
  env: Bindings,
  homeId: string,
  user: UserRow,
): Promise<{ token: string; userId: string; homeId: string }> => {
  const token = await issueUserToken(homeId, user.id, requireSecret(env));
  return { token, userId: user.id, homeId };
};

export const authRouter = new Hono<{ Bindings: Bindings; Variables: AuthVars }>()
  // ── POST /api/auth/setup { login, pin, tz? } ───────────────────────
  // Creates a brand-new HOME + first USER. Defaults:
  //   home.display_name = login
  //   home.login = login        (globally unique)
  //   home.tz = body.tz ?? "UTC"
  //   user.display_name = "User 1"
  //   user.login = NULL  (per-user logins added later)
  // Seeds the four default labels and five default TaskResults.
  .post("/setup", zValidator("json", SetupSchema), async (c) => {
    const start = Date.now();
    const { login, pin, tz } = c.req.valid("json");
    const taken = await c.env.DB.prepare(
      "SELECT id FROM homes WHERE login = ? AND is_deleted = 0",
    )
      .bind(login)
      .first<{ id: string }>();
    if (taken) {
      await recordAuthLog(c.env.DB, null, null, "setup", login, "error", "login taken", start);
      return c.json({ error: "login already taken" }, 409);
    }
    const { salt, hash } = await hashPin(pin);
    const homeId = newUuid();
    const userId = newUuid();
    const nowSec = Math.floor(Date.now() / 1000);
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO homes (id, display_name, login, pin_salt, pin_hash, tz, created_at, updated_at, is_deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      ).bind(homeId, login, login, salt, hash, tz ?? "UTC", nowSec, nowSec),
      c.env.DB.prepare(
        `INSERT INTO users (id, home_id, display_name, created_at, updated_at, is_deleted)
         VALUES (?, ?, 'User 1', ?, ?, 0)`,
      ).bind(userId, homeId, nowSec, nowSec),
    ]);
    await seedHomeDefaults(c.env.DB, homeId, nowSec);

    const token = await issueUserToken(homeId, userId, requireSecret(c.env));
    await recordAuthLog(c.env.DB, homeId, userId, "setup", login, "ok", null, start);
    c.header("Set-Cookie", buildSessionCookie(token));
    return c.json({ token, homeId, userId, homeLogin: login }, 201);
  })

  // ── POST /api/auth/login { login, pin } ────────────────────────────
  // Resolves login → home, verifies the home-level PIN, and EITHER:
  //   - returns a UserToken (if the home has exactly one user), or
  //   - returns { selectorToken, users[] } so the SPA can show a picker.
  .post("/login", zValidator("json", LoginSchema), async (c) => {
    const start = Date.now();
    const { login, pin } = c.req.valid("json");
    const home = await c.env.DB.prepare(
      `SELECT id, display_name, login, pin_salt, pin_hash, tz FROM homes
       WHERE login = ? AND is_deleted = 0`,
    )
      .bind(login)
      .first<HomeRow>();
    if (!home) {
      await recordAuthLog(c.env.DB, null, null, "login", login, "error", "no such home", start);
      return c.json({ error: "invalid credentials" }, 401);
    }
    if (isTransparentUser({ pinSalt: home.pin_salt, pinHash: home.pin_hash })) {
      await recordAuthLog(c.env.DB, home.id, null, "login", login, "error", "transparent home", start);
      return c.json(
        { error: "this home has no PIN; use quick-setup or set-pin first" },
        409,
      );
    }
    const ok = await verifyPin(pin, home.pin_salt as string, home.pin_hash as string);
    if (!ok) {
      await recordAuthLog(c.env.DB, home.id, null, "login", login, "error", "wrong pin", start);
      return c.json({ error: "invalid credentials" }, 401);
    }
    const { results: users } = await c.env.DB.prepare(
      `SELECT id, home_id, display_name, login FROM users
       WHERE home_id = ? AND is_deleted = 0
       ORDER BY created_at ASC`,
    )
      .bind(home.id)
      .all<UserRow>();
    if (users.length === 0) {
      // shouldn't happen — setup creates User 1 — but bail clearly
      await recordAuthLog(c.env.DB, home.id, null, "login", login, "error", "no users", start);
      return c.json({ error: "home has no users" }, 500);
    }
    if (users.length === 1) {
      const user = users[0]!;
      const dto = await directUserResponse(c.env, home.id, user);
      await recordAuthLog(c.env.DB, home.id, user.id, "login", login, "ok", null, start);
      c.header("Set-Cookie", buildSessionCookie(dto.token));
      return c.json(dto);
    }
    const selector = await issueSelectorToken(home.id, requireSecret(c.env));
    await recordAuthLog(c.env.DB, home.id, null, "login", login, "ok", "selector", start);
    return c.json(selectorResponse(selector, home.id, users));
  })

  // ── POST /api/auth/select-user { selectorToken, userId } ──────────
  // Phone exchanges its short-lived selectorToken plus a chosen user
  // for a real UserToken.
  .post("/select-user", zValidator("json", SelectUserSchema), async (c) => {
    const start = Date.now();
    const { selectorToken, userId } = c.req.valid("json");
    const payload = await verifySelectorToken(selectorToken, requireSecret(c.env));
    if (!payload) {
      await recordAuthLog(c.env.DB, null, null, "select-user", null, "error", "bad selector", start);
      return c.json({ error: "invalid or expired selector token" }, 401);
    }
    const user = await c.env.DB.prepare(
      `SELECT id, home_id, display_name, login FROM users
       WHERE id = ? AND home_id = ? AND is_deleted = 0`,
    )
      .bind(userId, payload.homeId)
      .first<UserRow>();
    if (!user) {
      await recordAuthLog(c.env.DB, payload.homeId, null, "select-user", userId, "error", "no such user", start);
      return c.json({ error: "user not in this home" }, 404);
    }
    const token = await issueUserToken(payload.homeId, user.id, requireSecret(c.env));
    await recordAuthLog(c.env.DB, payload.homeId, user.id, "select-user", userId, "ok", null, start);
    c.header("Set-Cookie", buildSessionCookie(token));
    return c.json({ token, homeId: payload.homeId, userId: user.id });
  })

  // ── POST /api/auth/quick-setup { pairCode?, displayName?, tz? } ───
  // Creates a TRANSPARENT home (no PIN) + first user atomically. If
  // pairCode is supplied and matches a fresh pending_pairings row,
  // claim that device for the new home.
  .post("/quick-setup", zValidator("json", QuickSetupSchema), async (c) => {
    const start = Date.now();
    const { pairCode, displayName, tz } = c.req.valid("json");
    const homeId = newUuid();
    const userId = newUuid();
    const homeLogin = QUICK_SETUP_PREFIX + randomHex(QUICK_SETUP_RAND_HEX / 2);
    const nowSec = Math.floor(Date.now() / 1000);

    let pendingDeviceId: string | null = null;
    if (pairCode) {
      const pending = await c.env.DB.prepare(
        `SELECT device_id, expires_at, cancelled_at, confirmed_at
         FROM pending_pairings WHERE pair_code = ?`,
      )
        .bind(pairCode)
        .first<{
          device_id: string;
          expires_at: number;
          cancelled_at: number | null;
          confirmed_at: number | null;
        }>();
      if (!pending) {
        await recordAuthLog(c.env.DB, null, null, "quick-setup", pairCode, "error", "unknown pair code", start);
        return c.json({ error: "unknown pair code — re-tap Pair on the device" }, 404);
      }
      if (pending.cancelled_at) {
        return c.json({ error: "pairing cancelled — re-tap Pair on the device" }, 410);
      }
      if (pending.confirmed_at) {
        return c.json({ error: "pair code already used" }, 409);
      }
      if (pending.expires_at <= nowSec) {
        return c.json({ error: "pair code expired — re-tap Pair on the device" }, 410);
      }
      pendingDeviceId = pending.device_id;
    }

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO homes (id, display_name, login, tz, created_at, updated_at, is_deleted)
         VALUES (?, ?, NULL, ?, ?, ?, 0)`,
      ).bind(homeId, displayName ?? "Home", tz ?? "UTC", nowSec, nowSec),
      c.env.DB.prepare(
        `INSERT INTO users (id, home_id, display_name, created_at, updated_at, is_deleted)
         VALUES (?, ?, 'User 1', ?, ?, 0)`,
      ).bind(userId, homeId, nowSec, nowSec),
    ]);
    await seedHomeDefaults(c.env.DB, homeId, nowSec);

    let deviceClaimed = false;
    if (pendingDeviceId) {
      const { issueDeviceToken } = await import("../auth.ts");
      const deviceToken = await issueDeviceToken(homeId, pendingDeviceId, requireSecret(c.env));
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO devices (id, home_id, serial, hw_model, created_at, updated_at, is_deleted)
           VALUES (?, ?, ?, '', ?, ?, 0)
           ON CONFLICT(id) DO UPDATE SET home_id = excluded.home_id,
             updated_at = excluded.updated_at, is_deleted = 0`,
        ).bind(pendingDeviceId, homeId, pendingDeviceId.slice(0, 16), nowSec, nowSec),
        c.env.DB.prepare(
          `UPDATE pending_pairings SET confirmed_at = ?, home_id = ?, device_token = ?
           WHERE device_id = ?`,
        ).bind(nowSec, homeId, deviceToken, pendingDeviceId),
      ]);
      deviceClaimed = true;
    }

    const token = await issueUserToken(homeId, userId, requireSecret(c.env));
    await recordAuthLog(
      c.env.DB,
      homeId,
      userId,
      "quick-setup",
      pairCode ?? null,
      "ok",
      null,
      start,
    );
    c.header("Set-Cookie", buildSessionCookie(token));
    return c.json(
      { token, homeId, userId, homeLogin, deviceClaimed },
      201,
    );
  })

  // ── POST /api/auth/me ──────────────────────────────────────────────
  .post("/me", requireAuth(), requireUser(), async (c) => {
    const u = c.get("user");
    const home = await c.env.DB.prepare(
      `SELECT id, display_name, login, pin_salt, pin_hash, tz FROM homes
       WHERE id = ? AND is_deleted = 0`,
    )
      .bind(u.homeId)
      .first<HomeRow>();
    const user = await c.env.DB.prepare(
      `SELECT id, home_id, display_name, login FROM users
       WHERE id = ? AND is_deleted = 0`,
    )
      .bind(u.userId)
      .first<UserRow>();
    if (!home || !user) return c.json({ error: "session orphan" }, 404);
    return c.json({
      homeId: home.id,
      homeDisplayName: home.display_name,
      homeLogin: home.login,
      tz: home.tz,
      hasPin: !isTransparentUser({ pinSalt: home.pin_salt, pinHash: home.pin_hash }),
      userId: user.id,
      userDisplayName: user.display_name,
    });
  })

  .post("/logout", async (c) => {
    c.header("Set-Cookie", buildClearSessionCookie());
    return c.json({ ok: true });
  })

  // ── POST /api/auth/set-pin { pin } — promote transparent → PIN ────
  .post("/set-pin", requireAuth(), requireUser(), zValidator("json", SetPinSchema), async (c) => {
    const start = Date.now();
    const u = c.get("user");
    const { pin } = c.req.valid("json");
    const home = await c.env.DB.prepare(
      "SELECT pin_salt, pin_hash, login FROM homes WHERE id = ?",
    )
      .bind(u.homeId)
      .first<{ pin_salt: string | null; pin_hash: string | null; login: string | null }>();
    if (!home) return c.json({ error: "home not found" }, 404);
    if (!isTransparentUser({ pinSalt: home.pin_salt, pinHash: home.pin_hash })) {
      await recordAuthLog(c.env.DB, u.homeId, u.userId, "set-pin", null, "error", "already has pin", start);
      return c.json({ error: "PIN already set; change-pin not implemented" }, 409);
    }
    const { salt, hash } = await hashPin(pin);
    const nowSec = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(
      `UPDATE homes SET pin_salt = ?, pin_hash = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(salt, hash, nowSec, u.homeId)
      .run();
    await recordAuthLog(c.env.DB, u.homeId, u.userId, "set-pin", null, "ok", null, start);
    return c.json({ ok: true });
  })

  // ── POST /api/auth/login-token-create — DeviceToken required ──────
  .post("/login-token-create", requireAuth(), async (c) => {
    const start = Date.now();
    const info = c.get("auth");
    if (info.type !== "device") return c.json({ error: "device-token-required" }, 403);
    const pair = await c.env.DB.prepare(
      `SELECT id FROM devices
       WHERE id = ? AND home_id = ? AND is_deleted = 0
       LIMIT 1`,
    )
      .bind(info.deviceId, info.homeId)
      .first<{ id: string }>();
    if (!pair) {
      await recordAuthLog(c.env.DB, info.homeId, null, "login-token-create", info.deviceId, "error", "pairing revoked", start);
      return c.json({ error: "device pairing has been revoked" }, 401);
    }
    const token = randomHex(16);
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresAt = nowSec + QR_TOKEN_TTL_SEC;
    await c.env.DB.prepare(
      `INSERT INTO login_qr_tokens (token, device_id, home_id, created_at, expires_at, consumed_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
      .bind(token, info.deviceId, info.homeId, nowSec, expiresAt)
      .run();
    await recordAuthLog(c.env.DB, info.homeId, null, "login-token-create", info.deviceId, "ok", null, start);
    return c.json({ token, expiresAt });
  })

  // ── POST /api/auth/login-qr { deviceId, token } ────────────────────
  // Returns either a direct UserToken (single user) or a selector +
  // user list (multi-user). Per plan §6.2.
  .post("/login-qr", zValidator("json", LoginQrSchema), async (c) => {
    const start = Date.now();
    const { deviceId, token } = c.req.valid("json");
    const row = await c.env.DB.prepare(
      `SELECT home_id, expires_at, consumed_at, device_id
       FROM login_qr_tokens WHERE token = ?`,
    )
      .bind(token)
      .first<{
        home_id: string;
        expires_at: number;
        consumed_at: number | null;
        device_id: string;
      }>();
    if (!row) {
      await recordAuthLog(c.env.DB, null, null, "login-qr", deviceId, "error", "unknown token", start);
      return c.json({ error: "unknown token" }, 404);
    }
    if (row.device_id !== deviceId) {
      await recordAuthLog(c.env.DB, row.home_id, null, "login-qr", deviceId, "error", "deviceId mismatch", start);
      return c.json({ error: "deviceId mismatch" }, 403);
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (row.expires_at <= nowSec) {
      return c.json({ error: "token expired (60s TTL)" }, 410);
    }
    if (row.consumed_at !== null) {
      return c.json({ error: "token already consumed" }, 410);
    }
    const res = await c.env.DB.prepare(
      "UPDATE login_qr_tokens SET consumed_at = ? WHERE token = ? AND consumed_at IS NULL",
    )
      .bind(nowSec, token)
      .run();
    if ((res.meta.changes ?? 0) === 0) {
      return c.json({ error: "token already consumed" }, 410);
    }
    const { results: users } = await c.env.DB.prepare(
      `SELECT id, home_id, display_name, login FROM users
       WHERE home_id = ? AND is_deleted = 0
       ORDER BY created_at ASC`,
    )
      .bind(row.home_id)
      .all<UserRow>();
    if (users.length === 1) {
      const user = users[0]!;
      const dto = await directUserResponse(c.env, row.home_id, user);
      await recordAuthLog(c.env.DB, row.home_id, user.id, "login-qr", deviceId, "ok", null, start);
      c.header("Set-Cookie", buildSessionCookie(dto.token));
      return c.json(dto);
    }
    const selector = await issueSelectorToken(row.home_id, requireSecret(c.env));
    await recordAuthLog(c.env.DB, row.home_id, null, "login-qr", deviceId, "ok", "selector", start);
    return c.json(selectorResponse(selector, row.home_id, users));
  });
