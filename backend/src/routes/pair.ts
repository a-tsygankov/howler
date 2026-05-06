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
import { rateLimit } from "../middleware/rate-limit.ts";

const PAIR_TTL_SEC = 180;
const PAIR_CODE_LEN = 6;

const requireSecret = (env: Bindings): string => {
  if (!env.AUTH_SECRET) throw new Error("AUTH_SECRET not configured");
  return env.AUTH_SECRET;
};

const newPairCode = (): string => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return ((buf[0] ?? 0) % 1_000_000).toString().padStart(PAIR_CODE_LEN, "0");
};

export const pairRouter = new Hono<{ Bindings: Bindings; Variables: AuthVars }>()
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
            cancelled_at, confirmed_at, home_id, device_token)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
         ON CONFLICT(device_id) DO UPDATE SET
           pair_code = excluded.pair_code,
           serial = excluded.serial,
           hw_model = excluded.hw_model,
           requested_at = excluded.requested_at,
           expires_at = excluded.expires_at,
           cancelled_at = NULL, confirmed_at = NULL,
           home_id = NULL, device_token = NULL`,
      )
        .bind(deviceId, code, serial ?? null, hwModel ?? null, now, expiresAt)
        .run();
    }

    await recordAuthLog(c.env.DB, null, null, "pair-start", deviceId, "ok", null, start);
    return c.json({ pairCode: code, expiresAt });
  })

  .post("/check", zValidator("json", PairCheckSchema), async (c) => {
    const { deviceId } = c.req.valid("json");
    const row = await c.env.DB.prepare(
      `SELECT expires_at, cancelled_at, confirmed_at, home_id, device_token
       FROM pending_pairings WHERE device_id = ?`,
    )
      .bind(deviceId)
      .first<{
        expires_at: number;
        cancelled_at: number | null;
        confirmed_at: number | null;
        home_id: string | null;
        device_token: string | null;
      }>();
    if (!row) return c.json({ status: "unknown" });
    if (row.cancelled_at) return c.json({ status: "cancelled" });
    if (row.confirmed_at && row.home_id && row.device_token) {
      return c.json({
        status: "confirmed",
        homeId: row.home_id,
        deviceToken: row.device_token,
      });
    }
    const now = Math.floor(Date.now() / 1000);
    if (row.expires_at <= now) return c.json({ status: "expired" });
    return c.json({ status: "pending", expiresAt: row.expires_at });
  })

  .post(
    "/confirm",
    rateLimit("pair-confirm"),
    requireAuth(),
    requireUser(),
    zValidator("json", PairConfirmSchema),
    async (c) => {
      const start = Date.now();
      const u = c.get("user");
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
        await recordAuthLog(c.env.DB, u.homeId, u.userId, "pair-confirm", pairCode, "error", "unknown code", start);
        return c.json({ error: "unknown pair code" }, 404);
      }
      if (row.cancelled_at) return c.json({ error: "pairing cancelled" }, 410);
      if (row.confirmed_at) return c.json({ error: "already confirmed" }, 409);
      const now = Math.floor(Date.now() / 1000);
      if (row.expires_at <= now) return c.json({ error: "pair code expired" }, 410);

      const deviceToken = await issueDeviceToken(
        u.homeId,
        row.device_id,
        requireSecret(c.env),
      );
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO devices (id, home_id, serial, hw_model, created_at, updated_at, is_deleted)
           VALUES (?, ?, ?, '', ?, ?, 0)
           ON CONFLICT(id) DO UPDATE SET home_id = excluded.home_id,
             updated_at = excluded.updated_at, is_deleted = 0`,
        ).bind(row.device_id, u.homeId, row.device_id.slice(0, 16), now, now),
        c.env.DB.prepare(
          `UPDATE pending_pairings SET confirmed_at = ?, home_id = ?, device_token = ?
           WHERE device_id = ?`,
        ).bind(now, u.homeId, deviceToken, row.device_id),
      ]);
      await recordAuthLog(c.env.DB, u.homeId, u.userId, "pair-confirm", pairCode, "ok", null, start);
      return c.json({ ok: true, deviceId: row.device_id });
    },
  );
