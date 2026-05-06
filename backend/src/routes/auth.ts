import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../env.ts";
import {
  buildClearSessionCookie,
  buildSessionCookie,
  hashPin,
  isTransparentUser,
  issueUserToken,
  verifyPin,
} from "../auth.ts";
import { recordAuthLog } from "../audit.ts";
import { newUuid } from "../domain/ids.ts";
import {
  LoginQrSchema,
  LoginSchema,
  QuickSetupSchema,
  SetPinSchema,
  SetupSchema,
} from "../shared/schemas.ts";
import { requireAuth, requireUser, type AuthVars } from "../middleware/auth.ts";

const QR_TOKEN_TTL_SEC = 60;
const QUICK_SETUP_PREFIX = "user-";
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

interface UserRow {
  id: string;
  username: string | null;
  display_name: string | null;
  pin_salt: string | null;
  pin_hash: string | null;
}

export const authRouter = new Hono<{ Bindings: Bindings; Variables: AuthVars }>()
  // ── POST /api/auth/setup { username, pin } ─────────────────────────
  // Create a new PIN-protected user from scratch. Fails if the
  // username is already taken.
  .post("/setup", zValidator("json", SetupSchema), async (c) => {
    const start = Date.now();
    const { username, pin } = c.req.valid("json");
    const taken = await c.env.DB.prepare(
      "SELECT id FROM users WHERE username = ? AND is_deleted = 0",
    )
      .bind(username)
      .first<{ id: string }>();
    if (taken) {
      await recordAuthLog(c.env.DB, null, "setup", username, "error", "username taken", start);
      return c.json({ error: "username already taken" }, 409);
    }
    const { salt, hash } = await hashPin(pin);
    const userId = newUuid();
    const now = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(
      `INSERT INTO users (id, username, pin_salt, pin_hash, created_at, updated_at, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    )
      .bind(userId, username, salt, hash, now, now)
      .run();
    const token = await issueUserToken(userId, requireSecret(c.env));
    await recordAuthLog(c.env.DB, userId, "setup", username, "ok", null, start);
    c.header("Set-Cookie", buildSessionCookie(token));
    return c.json({ token, userId, username }, 201);
  })

  // ── POST /api/auth/login { username, pin } ─────────────────────────
  .post("/login", zValidator("json", LoginSchema), async (c) => {
    const start = Date.now();
    const { username, pin } = c.req.valid("json");
    const row = await c.env.DB.prepare(
      `SELECT id, username, display_name, pin_salt, pin_hash
       FROM users WHERE username = ? AND is_deleted = 0`,
    )
      .bind(username)
      .first<UserRow>();
    if (!row) {
      await recordAuthLog(c.env.DB, null, "login", username, "error", "no such user", start);
      return c.json({ error: "invalid credentials" }, 401);
    }
    if (isTransparentUser({ pinSalt: row.pin_salt, pinHash: row.pin_hash })) {
      await recordAuthLog(c.env.DB, row.id, "login", username, "error", "transparent user (no pin)", start);
      return c.json({ error: "this account has no PIN; use quick-setup or set-pin first" }, 409);
    }
    const ok = await verifyPin(pin, row.pin_salt as string, row.pin_hash as string);
    if (!ok) {
      await recordAuthLog(c.env.DB, row.id, "login", username, "error", "wrong pin", start);
      return c.json({ error: "invalid credentials" }, 401);
    }
    const token = await issueUserToken(row.id, requireSecret(c.env));
    await recordAuthLog(c.env.DB, row.id, "login", username, "ok", null, start);
    c.header("Set-Cookie", buildSessionCookie(token));
    return c.json({ token, userId: row.id, username: row.username });
  })

  // ── POST /api/auth/quick-setup { pairCode?, displayName? } ─────────
  // Create a transparent user (no PIN). If `pairCode` is supplied
  // and matches a fresh pending_pairings row, atomically claim that
  // device for the new user — single-shot pairing path. Without
  // pairCode this just provisions an account.
  .post("/quick-setup", zValidator("json", QuickSetupSchema), async (c) => {
    const start = Date.now();
    const { pairCode, displayName } = c.req.valid("json");
    const userId = newUuid();
    const username = QUICK_SETUP_PREFIX + randomHex(QUICK_SETUP_RAND_HEX / 2);
    const now = Math.floor(Date.now() / 1000);

    // Validate pair-code BEFORE creating the user so a stale code
    // doesn't leave an orphan account behind.
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
        await recordAuthLog(c.env.DB, null, "quick-setup", pairCode, "error", "unknown pair code", start);
        return c.json({ error: "unknown pair code — re-tap Pair on the device" }, 404);
      }
      if (pending.cancelled_at) {
        await recordAuthLog(c.env.DB, null, "quick-setup", pairCode, "error", "cancelled", start);
        return c.json({ error: "pairing cancelled — re-tap Pair on the device" }, 410);
      }
      if (pending.confirmed_at) {
        await recordAuthLog(c.env.DB, null, "quick-setup", pairCode, "error", "already confirmed", start);
        return c.json({ error: "pair code already used" }, 409);
      }
      if (pending.expires_at <= now) {
        await recordAuthLog(c.env.DB, null, "quick-setup", pairCode, "error", "expired", start);
        return c.json({ error: "pair code expired — re-tap Pair on the device" }, 410);
      }
      pendingDeviceId = pending.device_id;
    }

    await c.env.DB.prepare(
      `INSERT INTO users (id, username, display_name, created_at, updated_at, is_deleted)
       VALUES (?, ?, ?, ?, ?, 0)`,
    )
      .bind(userId, username, displayName ?? null, now, now)
      .run();

    let deviceToken: string | null = null;
    if (pendingDeviceId) {
      const { issueDeviceToken } = await import("../auth.ts");
      deviceToken = await issueDeviceToken(userId, pendingDeviceId, requireSecret(c.env));
      // Confirm the pairing inline: claim the device, write the
      // device token into pending_pairings so the device's next
      // /pair/check returns confirmed.
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO devices (id, user_id, serial, hw_model, created_at, updated_at, is_deleted)
           VALUES (?, ?, ?, '', ?, ?, 0)
           ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id,
             updated_at = excluded.updated_at, is_deleted = 0`,
        ).bind(pendingDeviceId, userId, pendingDeviceId.slice(0, 16), now, now),
        c.env.DB.prepare(
          `UPDATE pending_pairings SET confirmed_at = ?, user_id = ?, device_token = ?
           WHERE device_id = ?`,
        ).bind(now, userId, deviceToken, pendingDeviceId),
      ]);
    }

    const userToken = await issueUserToken(userId, requireSecret(c.env));
    await recordAuthLog(
      c.env.DB,
      userId,
      "quick-setup",
      pairCode ?? null,
      "ok",
      null,
      start,
    );
    c.header("Set-Cookie", buildSessionCookie(userToken));
    return c.json(
      { token: userToken, userId, username, deviceClaimed: !!pendingDeviceId },
      201,
    );
  })

  // ── POST /api/auth/me — current user, requires UserToken ───────────
  .post("/me", requireAuth(), requireUser(), async (c) => {
    const info = c.get("auth");
    const row = await c.env.DB.prepare(
      `SELECT id, username, display_name, pin_salt, pin_hash
       FROM users WHERE id = ? AND is_deleted = 0`,
    )
      .bind(info.userId)
      .first<UserRow>();
    if (!row) return c.json({ error: "user not found" }, 404);
    return c.json({
      userId: row.id,
      username: row.username,
      displayName: row.display_name,
      hasPin: !isTransparentUser({ pinSalt: row.pin_salt, pinHash: row.pin_hash }),
    });
  })

  // ── POST /api/auth/logout — clear cookie. No-op for Bearer clients ─
  .post("/logout", async (c) => {
    c.header("Set-Cookie", buildClearSessionCookie());
    return c.json({ ok: true });
  })

  // ── POST /api/auth/set-pin { pin } — promote transparent → PIN ────
  .post("/set-pin", requireAuth(), requireUser(), zValidator("json", SetPinSchema), async (c) => {
    const start = Date.now();
    const info = c.get("auth");
    const { pin } = c.req.valid("json");
    const row = await c.env.DB.prepare(
      "SELECT pin_salt, pin_hash FROM users WHERE id = ?",
    )
      .bind(info.userId)
      .first<{ pin_salt: string | null; pin_hash: string | null }>();
    if (!row) {
      await recordAuthLog(c.env.DB, info.userId, "set-pin", null, "error", "no user", start);
      return c.json({ error: "user not found" }, 404);
    }
    if (!isTransparentUser({ pinSalt: row.pin_salt, pinHash: row.pin_hash })) {
      await recordAuthLog(c.env.DB, info.userId, "set-pin", null, "error", "already has pin", start);
      return c.json(
        { error: "PIN already set; change-pin not implemented yet" },
        409,
      );
    }
    const { salt, hash } = await hashPin(pin);
    const now = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(
      "UPDATE users SET pin_salt = ?, pin_hash = ?, updated_at = ? WHERE id = ?",
    )
      .bind(salt, hash, now, info.userId)
      .run();
    await recordAuthLog(c.env.DB, info.userId, "set-pin", null, "ok", null, start);
    return c.json({ ok: true });
  })

  // ── POST /api/auth/login-token-create — DeviceToken required ──────
  // Mints a 60-second one-shot QR token for the device's already-
  // paired user. Each call mints a fresh token. Replay protection
  // is single-use consumption in /login-qr.
  //
  // Pairing-revocation gate: a DeviceToken outlives a `Forget device`
  // action (no token revocation list), so we re-check there's an
  // active devices row for this (deviceId, userId) before minting.
  .post("/login-token-create", requireAuth(), async (c) => {
    const start = Date.now();
    const info = c.get("auth");
    if (info.type !== "device") {
      return c.json({ error: "device-token-required" }, 403);
    }
    const pair = await c.env.DB.prepare(
      `SELECT id FROM devices
       WHERE id = ? AND user_id = ? AND is_deleted = 0
       LIMIT 1`,
    )
      .bind(info.deviceId, info.userId)
      .first<{ id: string }>();
    if (!pair) {
      await recordAuthLog(
        c.env.DB,
        info.userId,
        "login-token-create",
        info.deviceId,
        "error",
        "pairing revoked",
        start,
      );
      return c.json(
        { error: "device pairing has been revoked; re-pair from the device menu" },
        401,
      );
    }
    const token = randomHex(16);
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + QR_TOKEN_TTL_SEC;
    await c.env.DB.prepare(
      `INSERT INTO login_qr_tokens (token, device_id, user_id, created_at, expires_at, consumed_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
      .bind(token, info.deviceId, info.userId, now, expiresAt)
      .run();
    await recordAuthLog(
      c.env.DB,
      info.userId,
      "login-token-create",
      info.deviceId,
      "ok",
      null,
      start,
    );
    return c.json({ token, expiresAt });
  })

  // ── POST /api/auth/login-qr { deviceId, token } — phone-side ──────
  // No auth — the token IS the credential. Single-use is enforced by
  // a conditional UPDATE so two concurrent calls can't both pass.
  .post("/login-qr", zValidator("json", LoginQrSchema), async (c) => {
    const start = Date.now();
    const { deviceId, token } = c.req.valid("json");
    const row = await c.env.DB.prepare(
      `SELECT user_id, expires_at, consumed_at, device_id
       FROM login_qr_tokens WHERE token = ?`,
    )
      .bind(token)
      .first<{
        user_id: string;
        expires_at: number;
        consumed_at: number | null;
        device_id: string;
      }>();
    if (!row) {
      await recordAuthLog(c.env.DB, null, "login-qr", deviceId, "error", "unknown token", start);
      return c.json({ error: "unknown token" }, 404);
    }
    if (row.device_id !== deviceId) {
      await recordAuthLog(c.env.DB, row.user_id, "login-qr", deviceId, "error", "deviceId mismatch", start);
      return c.json({ error: "deviceId mismatch" }, 403);
    }
    const now = Math.floor(Date.now() / 1000);
    if (row.expires_at <= now) {
      await recordAuthLog(c.env.DB, row.user_id, "login-qr", deviceId, "error", "expired", start);
      return c.json({ error: "token expired (60s TTL)" }, 410);
    }
    if (row.consumed_at !== null) {
      await recordAuthLog(c.env.DB, row.user_id, "login-qr", deviceId, "error", "already consumed", start);
      return c.json({ error: "token already consumed" }, 410);
    }
    const res = await c.env.DB.prepare(
      "UPDATE login_qr_tokens SET consumed_at = ? WHERE token = ? AND consumed_at IS NULL",
    )
      .bind(now, token)
      .run();
    if ((res.meta.changes ?? 0) === 0) {
      await recordAuthLog(c.env.DB, row.user_id, "login-qr", deviceId, "error", "race lost", start);
      return c.json({ error: "token already consumed" }, 410);
    }
    const userToken = await issueUserToken(row.user_id, requireSecret(c.env));
    await recordAuthLog(c.env.DB, row.user_id, "login-qr", deviceId, "ok", null, start);
    c.header("Set-Cookie", buildSessionCookie(userToken));
    return c.json({ token: userToken, userId: row.user_id });
  });
