import { clock } from "../clock.ts";
import { Hono } from "hono";
import type { Bindings } from "../env.ts";
import { requireAuth, requireUser, type AuthVars } from "../middleware/auth.ts";

interface DeviceRow {
  id: string;
  home_id: string;
  serial: string;
  fw_version: string | null;
  hw_model: string;
  tz: string | null;
  last_seen_at: number | null;
  created_at: number;
  updated_at: number;
}

const toDto = (r: DeviceRow) => ({
  id: r.id,
  homeId: r.home_id,
  serial: r.serial,
  fwVersion: r.fw_version,
  hwModel: r.hw_model,
  tz: r.tz,
  lastSeenAt: r.last_seen_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const devicesRouter = new Hono<{
  Bindings: Bindings;
  Variables: AuthVars;
}>()
  .use("*", requireAuth(), requireUser())

  .get("/", async (c) => {
    const u = c.get("user");
    const { results } = await c.env.DB
      .prepare(
        `SELECT id, home_id, serial, fw_version, hw_model, tz, last_seen_at,
           created_at, updated_at
         FROM devices WHERE home_id = ? AND is_deleted = 0
         ORDER BY created_at DESC`,
      )
      .bind(u.homeId)
      .all<DeviceRow>();
    return c.json({ devices: results.map(toDto) });
  })

  // Revoking a device sets is_deleted = 1. The /api/auth/login-token-create
  // gate already refuses to mint phone-login QRs from a soft-deleted
  // pairings row, so revocation is immediate even though the long-
  // lived DeviceToken HMAC stays valid until exp.
  .delete("/:id", async (c) => {
    const u = c.get("user");
    const id = c.req.param("id");
    const row = await c.env.DB
      .prepare("SELECT home_id FROM devices WHERE id = ? AND is_deleted = 0")
      .bind(id)
      .first<{ home_id: string }>();
    if (!row || row.home_id !== u.homeId) {
      return c.json({ error: "not-found" }, 404);
    }
    const nowSec = clock().nowSec();
    await c.env.DB.prepare(
      "UPDATE devices SET is_deleted = 1, updated_at = ? WHERE id = ?",
    )
      .bind(nowSec, id)
      .run();
    return c.body(null, 204);
  });
