import { Hono } from "hono";
import type { Bindings } from "../env.ts";
import { markDeviceAlive, requireAuth, type AuthVars } from "../middleware/auth.ts";
import { compareVersions } from "../services/version.ts";

// Phase 6 OTA — read path. The dial calls GET /api/firmware/check
// from the heartbeat path with `?fwVersion=<current>`. Worker
// looks up the highest active release whose version is newer +
// whose rollout rules match this device, and returns a manifest
// the firmware can act on.
//
// This PR lays the read path. Pre-signed-URL minting against R2
// + the admin POST /api/firmware path that uploads + promotes a
// release land in the next OTA PR — see docs/ota.md for the
// remaining-work checklist.

interface FirmwareReleaseRow {
  version: string;
  sha256: string;
  r2_key: string;
  size_bytes: number;
  rollout_rules: string | null;
  active: number;
}

// Apply rollout_rules JSON to a deviceId. Empty / null = ship to
// everyone (the default for now). Future-proof against per-device
// pinning + canary deployment via discriminated shapes:
//   { "deviceIds": [...] }   — ship only to listed devices
//   { "canaryPercent": 5 }   — ship to a hash-determined slice
// Unrecognised shapes default to "no" so a malformed rollout can't
// accidentally ship a build to everyone.
const ruleAllowsDevice = (
  rulesJson: string | null,
  deviceId: string,
): boolean => {
  if (!rulesJson) return true;
  try {
    const parsed = JSON.parse(rulesJson) as {
      deviceIds?: string[];
      canaryPercent?: number;
    };
    if (Array.isArray(parsed.deviceIds)) {
      return parsed.deviceIds.includes(deviceId);
    }
    if (typeof parsed.canaryPercent === "number") {
      // Stable per-device slice: take the first byte of the
      // deviceId (hex) modulo 100 against the canary percent.
      // Same device always lands in the same slice across calls,
      // so canary membership is consistent for a rollout.
      const slot = Number.parseInt(deviceId.slice(0, 2), 16) % 100;
      return slot < parsed.canaryPercent;
    }
    // Unknown rule shape — fail-closed.
    return false;
  } catch {
    return false;
  }
};

export const firmwareRouter = new Hono<{
  Bindings: Bindings;
  Variables: AuthVars;
}>()
  // Loose auth — both user (for webapp ops UI eventually) and
  // device tokens hit this. Same shape /api/dashboard already
  // uses; markDeviceAlive bumps last_seen_at on every device call.
  .use("*", requireAuth(), markDeviceAlive())

  // GET /api/firmware/check?fwVersion=1.4.1 →
  //   { updateAvailable: false }                                 — already current
  //   { updateAvailable: true, version, sha256, sizeBytes, ... } — newer build eligible
  //
  // For now only device tokens get a downloadUrl (user-token
  // callers are read-only inspectors). Pre-signed URL minting
  // is wired in the next OTA PR; this endpoint currently returns
  // the r2_key as-is so the wire shape is stable.
  .get("/check", async (c) => {
    const auth = c.get("auth");
    const fwVersion = c.req.query("fwVersion") ?? "0.0.0";

    const { results } = await c.env.DB
      .prepare(
        `SELECT version, sha256, r2_key, size_bytes, rollout_rules, active
         FROM firmware_releases
         WHERE active = 1
         ORDER BY created_at DESC`,
      )
      .all<FirmwareReleaseRow>();

    // Walk active releases newest-first; pick the first that
    // (a) is strictly newer than the device's reported version
    // and (b) passes the rollout rules. Linear scan is fine —
    // active releases are O(10) at the very most.
    for (const r of results) {
      if (compareVersions(r.version, fwVersion) <= 0) continue;
      if (auth.type === "device") {
        if (!ruleAllowsDevice(r.rollout_rules, auth.deviceId)) continue;
      }
      return c.json({
        updateAvailable: true,
        version: r.version,
        sha256: r.sha256,
        sizeBytes: r.size_bytes,
        // Pre-signed-URL minting lands in the next OTA PR. Until
        // then we surface the r2_key — devices in production
        // can't act on it (the bucket isn't public), so this is
        // safe to return; staging / tests can use it directly.
        r2Key: r.r2_key,
      });
    }
    return c.json({ updateAvailable: false });
  });
