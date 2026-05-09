import { clock } from "../clock.ts";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../env.ts";
import { markDeviceAlive, requireAuth, requireDevice, requireUser, type AuthVars } from "../middleware/auth.ts";
import { compareVersions } from "../services/version.ts";

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

// Heartbeat payload — accepts what the firmware already sends today
// (`fwVersion`); battery + uptime are reserved for a future PR.
const HeartbeatSchema = z.object({
  fwVersion: z.string().min(1).max(40),
});

export const devicesRouter = new Hono<{
  Bindings: Bindings;
  Variables: AuthVars;
}>()
  // Loose auth at the router level so the device can heartbeat
  // with its DeviceToken. Listing + revocation re-arm
  // requireUser() per-route — the device shouldn't see other
  // devices in the home or revoke them.
  .use("*", requireAuth(), markDeviceAlive())

  .get("/", requireUser(), async (c) => {
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

  // POST /api/devices/heartbeat — device-only.
  //
  // Until this PR, the firmware silently 404'd this endpoint —
  // markDeviceAlive() on /api/dashboard was already keeping
  // last_seen_at fresh, but the dial's `postHeartbeat` call had
  // nowhere to land its current fwVersion. With OTA approaching
  // (Phase 6), we need fwVersion in the devices row so the
  // server can decide whether a release applies, and an
  // explicit endpoint that returns an OTA-update advisory in
  // the same round-trip.
  //
  // Response shape:
  //   { ok: true, updateAvailable: false }
  //   { ok: true, updateAvailable: true, version, sha256, sizeBytes }
  //
  // The actual download URL is minted on /api/firmware/check
  // (so the heartbeat path can stay cheap when nothing's new).
  .post("/heartbeat", requireDevice(), zValidator("json", HeartbeatSchema), async (c) => {
    const d = c.get("device");
    const { fwVersion } = c.req.valid("json");
    const nowSec = clock().nowSec();

    await c.env.DB.prepare(
      "UPDATE devices SET fw_version = ?, last_seen_at = ?, updated_at = ? WHERE id = ?",
    )
      .bind(fwVersion, nowSec, nowSec, d.deviceId)
      .run();

    // Latest active release advisory. SQL `ORDER BY version` is
    // lexicographic ("1.10.0" < "1.2.0"), so we pull the small
    // active set and let compareVersions() pick the real max in
    // app code. Active releases are O(10) at most — the cost is
    // negligible.
    const { results: actives } = await c.env.DB
      .prepare(
        `SELECT version, sha256, size_bytes
         FROM firmware_releases
         WHERE active = 1`,
      )
      .all<{ version: string; sha256: string; size_bytes: number }>();
    let highest: { version: string; sha256: string; size_bytes: number } | null = null;
    for (const r of actives) {
      if (!highest || compareVersions(r.version, highest.version) > 0) {
        highest = r;
      }
    }
    if (!highest || compareVersions(highest.version, fwVersion) <= 0) {
      return c.json({ ok: true, updateAvailable: false });
    }
    return c.json({
      ok: true,
      updateAvailable: true,
      version: highest.version,
      sha256: highest.sha256,
      sizeBytes: highest.size_bytes,
    });
  })

  // Revoking a device sets is_deleted = 1. The /api/auth/login-token-create
  // gate already refuses to mint phone-login QRs from a soft-deleted
  // pairings row, so revocation is immediate even though the long-
  // lived DeviceToken HMAC stays valid until exp.
  .delete("/:id", requireUser(), async (c) => {
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
