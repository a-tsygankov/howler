import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../env.ts";
import { issueDeviceToken } from "../auth.ts";
import { recordAuthLog } from "../audit.ts";
import {
  PairCheckSchema,
  PairConfirmSchema,
  PairStartSchema,
} from "../shared/schemas.ts";
import { requireAuth, requireUser, type AuthVars } from "../middleware/auth.ts";

const PAIR_TTL_SEC = 180; // 3-minute handshake window
const PAIR_CODE_LEN = 6; // numeric, easy to type or QR-scan

const requireSecret = (env: Bindings): string => {
  if (!env.AUTH_SECRET) throw new Error("AUTH_SECRET not configured");
  return env.AUTH_SECRET;
};

const newPairCode = (): string => {
  // Numeric 6-digit code. Crypto-RNG, then modulo into the 6-digit
  // space. 1M codes is small but the active window is 3 min and
  // collisions are caught by SELECT-before-INSERT below; on the rare
  // hit we retry once with a fresh code.
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return ((buf[0] ?? 0) % 1_000_000).toString().padStart(PAIR_CODE_LEN, "0");
};

export const pairRouter = new Hono<{ Bindings: Bindings; Variables: AuthVars }>()
  // ── POST /api/pair/start { deviceId, serial?, hwModel? } ─────────
  // Unauthenticated. The unpaired device calls this with its
  // firmware-generated UUID. Returns the human-typeable pairCode the
  // device will display. Idempotent per device: a second /start
  // before the first expires bumps the window and returns the SAME
  // code, so a user who tapped Pair twice doesn't see two different
  // codes flicker on the dial.
  .post("/start", zValidator("json", PairStartSchema), async (c) => {
    const start = Date.now();
    const { deviceId, serial, hwModel } = c.req.valid("json");
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + PAIR_TTL_SEC;

    const existing = await c.env.DB.prepare(
      "SELECT pair_code, expires_at, confirmed_at, cancelled_at FROM pending_pairings WHERE device_id = ?",
    )
      .bind(deviceId)
      .first<{
        pair_code: string;
        expires_at: number;
        confirmed_at: number | null;
        cancelled_at: number | null;
      }>();

    let code: string;
    if (existing && !existing.confirmed_at && !existing.cancelled_at && existing.expires_at > now) {
      code = existing.pair_code;
      await c.env.DB.prepare(
        "UPDATE pending_pairings SET expires_at = ? WHERE device_id = ?",
      )
        .bind(expiresAt, deviceId)
        .run();
    } else {
      code = newPairCode();
      await c.env.DB.prepare(
        `INSERT INTO pending_pairings
           (device_id, pair_code, serial, hw_model, requested_at, expires_at,
            cancelled_at, confirmed_at, user_id, device_token)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
         ON CONFLICT(device_id) DO UPDATE SET
           pair_code = excluded.pair_code,
           serial = excluded.serial,
           hw_model = excluded.hw_model,
           requested_at = excluded.requested_at,
           expires_at = excluded.expires_at,
           cancelled_at = NULL, confirmed_at = NULL,
           user_id = NULL, device_token = NULL`,
      )
        .bind(deviceId, code, serial ?? null, hwModel ?? null, now, expiresAt)
        .run();
    }

    await recordAuthLog(c.env.DB, null, "pair-start", deviceId, "ok", null, start);
    return c.json({ pairCode: code, expiresAt });
  })

  // ── POST /api/pair/check { deviceId } — device polls this ─────────
  // Returns one of: pending / expired / cancelled / confirmed.
  // On `confirmed`, the deviceToken minted at confirm-time is
  // returned exactly once — the device should persist it and stop
  // polling. We DON'T delete the row immediately so a duplicate
  // /check from a flaky network still gets the token (idempotent
  // retrieval); a sweeper job (Phase 1.5) prunes after 24h.
  .post("/check", zValidator("json", PairCheckSchema), async (c) => {
    const { deviceId } = c.req.valid("json");
    const row = await c.env.DB.prepare(
      `SELECT expires_at, cancelled_at, confirmed_at, user_id, device_token
       FROM pending_pairings WHERE device_id = ?`,
    )
      .bind(deviceId)
      .first<{
        expires_at: number;
        cancelled_at: number | null;
        confirmed_at: number | null;
        user_id: string | null;
        device_token: string | null;
      }>();
    if (!row) return c.json({ status: "unknown" });
    if (row.cancelled_at) return c.json({ status: "cancelled" });
    if (row.confirmed_at && row.user_id && row.device_token) {
      return c.json({
        status: "confirmed",
        userId: row.user_id,
        deviceToken: row.device_token,
      });
    }
    const now = Math.floor(Date.now() / 1000);
    if (row.expires_at <= now) return c.json({ status: "expired" });
    return c.json({ status: "pending", expiresAt: row.expires_at });
  })

  // ── POST /api/pair/confirm { pairCode } — UserToken required ──────
  // The phone-side step. Looks up the pending row by code, claims
  // the device for this user, mints a DeviceToken, writes it back so
  // the device's next /check returns it.
  .post(
    "/confirm",
    requireAuth(),
    requireUser(),
    zValidator("json", PairConfirmSchema),
    async (c) => {
      const start = Date.now();
      const info = c.get("auth");
      const { pairCode } = c.req.valid("json");
      const row = await c.env.DB.prepare(
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
      if (!row) {
        await recordAuthLog(c.env.DB, info.userId, "pair-confirm", pairCode, "error", "unknown code", start);
        return c.json({ error: "unknown pair code" }, 404);
      }
      if (row.cancelled_at) {
        await recordAuthLog(c.env.DB, info.userId, "pair-confirm", pairCode, "error", "cancelled", start);
        return c.json({ error: "pairing cancelled" }, 410);
      }
      if (row.confirmed_at) {
        await recordAuthLog(c.env.DB, info.userId, "pair-confirm", pairCode, "error", "already confirmed", start);
        return c.json({ error: "already confirmed" }, 409);
      }
      const now = Math.floor(Date.now() / 1000);
      if (row.expires_at <= now) {
        await recordAuthLog(c.env.DB, info.userId, "pair-confirm", pairCode, "error", "expired", start);
        return c.json({ error: "pair code expired" }, 410);
      }
      const deviceToken = await issueDeviceToken(
        info.userId,
        row.device_id,
        requireSecret(c.env),
      );
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO devices (id, user_id, serial, hw_model, created_at, updated_at, is_deleted)
           VALUES (?, ?, ?, '', ?, ?, 0)
           ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id,
             updated_at = excluded.updated_at, is_deleted = 0`,
        ).bind(row.device_id, info.userId, row.device_id.slice(0, 16), now, now),
        c.env.DB.prepare(
          `UPDATE pending_pairings SET confirmed_at = ?, user_id = ?, device_token = ?
           WHERE device_id = ?`,
        ).bind(now, info.userId, deviceToken, row.device_id),
      ]);
      await recordAuthLog(c.env.DB, info.userId, "pair-confirm", pairCode, "ok", null, start);
      return c.json({ ok: true, deviceId: row.device_id });
    },
  );
