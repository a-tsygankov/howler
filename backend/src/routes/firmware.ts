import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { clock } from "../clock.ts";
import type { Bindings } from "../env.ts";
import { markDeviceAlive, requireAdmin, requireAuth, type AuthVars } from "../middleware/auth.ts";
import { compareVersions } from "../services/version.ts";

// Phase 6 OTA — read + admin paths.
//
//   GET  /check?fwVersion=X       device + user — update advisory
//   POST /                         admin only   — register a build
//   PATCH /:version                admin only   — promote / yank /
//                                                 update rollout
//   GET  /                         admin only   — list all releases
//                                                 for the ops UI
//
// Slice F1 (this PR) lands the admin write path. Pre-signed-URL
// minting against R2 still lives in F3 — see docs/ota.md.

// Version literal accepted on the wire. Two-or-three numeric
// components, optionally with an alphanumeric pre-release tail
// ("1.4.2", "1.4.2-rc1"). Rejects SQL-injection-ish input + any
// shape compareVersions() can't reason about.
const VersionRegex = /^\d+\.\d+(?:\.\d+)?(?:-[A-Za-z0-9.]+)?$/;

const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

// Rollout rules — keep loose so the ops UI can ship new shapes
// (per-home pinning, time-windowed canaries) without a schema
// change. The check endpoint already fail-closes on unrecognised
// shapes, so an unknown rule body never accidentally ships to
// everyone.
const RolloutRules = z
  .object({
    deviceIds: z.array(z.string()).optional(),
    canaryPercent: z.number().int().min(0).max(100).optional(),
  })
  .nullable()
  .optional();

const CreateReleaseSchema = z.object({
  version: z.string().regex(VersionRegex),
  sha256: Sha256Hex,
  r2Key: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive(),
  rolloutRules: RolloutRules,
});

const UpdateReleaseSchema = z
  .object({
    active: z.boolean().optional(),
    rolloutRules: RolloutRules,
  })
  .refine(
    (v) => v.active !== undefined || v.rolloutRules !== undefined,
    { message: "must set at least one of `active` or `rolloutRules`" },
  );

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
  })

  // ── Admin write path (slice F1) ─────────────────────────────
  // Every handler below re-arms requireAdmin() so a webapp ops
  // UI built on the same Worker (future) and a hostile actor
  // are gated identically. There's no first-class admin role
  // yet — `ADMIN_HOMES` env var carries the allow-list. See
  // docs/ota.md F1 for the rationale.

  // POST /api/firmware { version, sha256, r2Key, sizeBytes, rolloutRules? }
  // Registers a new release as `active = 0`. CI uploads the bytes
  // to R2 first, THEN posts the manifest here — so a half-uploaded
  // build can't be promoted by accident. Promotion is a separate
  // PATCH call.
  .post("/", requireAdmin(), zValidator("json", CreateReleaseSchema), async (c) => {
    const body = c.req.valid("json");
    const nowSec = clock().nowSec();

    // Idempotency: re-POSTing the same version is a 409. Version
    // is the table's primary key — INSERT would fail anyway, but
    // a clean error is friendlier to a CI retry loop.
    const existing = await c.env.DB
      .prepare("SELECT version FROM firmware_releases WHERE version = ?")
      .bind(body.version)
      .first();
    if (existing) {
      return c.json({ error: "version-exists" }, 409);
    }

    await c.env.DB
      .prepare(
        `INSERT INTO firmware_releases
           (version, sha256, r2_key, size_bytes, rollout_rules, active,
            created_at, promoted_at, yanked_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, NULL, NULL)`,
      )
      .bind(
        body.version,
        body.sha256,
        body.r2Key,
        body.sizeBytes,
        body.rolloutRules ? JSON.stringify(body.rolloutRules) : null,
        nowSec,
      )
      .run();

    return c.json(
      {
        version: body.version,
        sha256: body.sha256,
        r2Key: body.r2Key,
        sizeBytes: body.sizeBytes,
        rolloutRules: body.rolloutRules ?? null,
        active: false,
        createdAt: nowSec,
        promotedAt: null,
        yankedAt: null,
      },
      201,
    );
  })

  // PATCH /api/firmware/:version { active?, rolloutRules? }
  //   - active: true → flip 0→1 (sets promoted_at = now if first
  //     promotion; leaves it alone on subsequent re-promotes)
  //   - active: false → flip 1→0 (sets yanked_at = now). No-op when
  //     the row was already inactive (no spurious yanked_at writes).
  //   - rolloutRules: null clears, object replaces. Updates take
  //     effect immediately on the next /check call.
  .patch("/:version", requireAdmin(), zValidator("json", UpdateReleaseSchema), async (c) => {
    const version = c.req.param("version");
    if (!VersionRegex.test(version)) {
      return c.json({ error: "version-invalid" }, 400);
    }
    const patch = c.req.valid("json");
    const nowSec = clock().nowSec();

    const row = await c.env.DB
      .prepare(
        "SELECT active, promoted_at FROM firmware_releases WHERE version = ?",
      )
      .bind(version)
      .first<{ active: number; promoted_at: number | null }>();
    if (!row) return c.json({ error: "not-found" }, 404);

    const sets: string[] = [];
    const binds: unknown[] = [];

    if (patch.active !== undefined) {
      const wasActive = row.active === 1;
      const now = patch.active;
      if (wasActive !== now) {
        sets.push("active = ?");
        binds.push(now ? 1 : 0);
        if (now) {
          // Stamp promoted_at on first promotion; preserve the
          // original timestamp on re-promotes (audit trail).
          if (row.promoted_at === null) {
            sets.push("promoted_at = ?");
            binds.push(nowSec);
          }
          // Clear yanked_at when re-promoting an old release —
          // the column tracks the LAST yank, not all of them.
          sets.push("yanked_at = NULL");
        } else {
          sets.push("yanked_at = ?");
          binds.push(nowSec);
        }
      }
    }

    if (patch.rolloutRules !== undefined) {
      sets.push("rollout_rules = ?");
      binds.push(
        patch.rolloutRules === null ? null : JSON.stringify(patch.rolloutRules),
      );
    }

    if (sets.length === 0) return c.body(null, 204);

    binds.push(version);
    await c.env.DB
      .prepare(
        `UPDATE firmware_releases SET ${sets.join(", ")} WHERE version = ?`,
      )
      .bind(...binds)
      .run();

    return c.body(null, 204);
  })

  // GET /api/firmware — admin-only listing for the ops UI. Sorted
  // by created_at desc so the most-recent build is at the top.
  .get("/", requireAdmin(), async (c) => {
    const { results } = await c.env.DB
      .prepare(
        `SELECT version, sha256, r2_key, size_bytes, rollout_rules,
                active, created_at, promoted_at, yanked_at
         FROM firmware_releases
         ORDER BY created_at DESC`,
      )
      .all<{
        version: string;
        sha256: string;
        r2_key: string;
        size_bytes: number;
        rollout_rules: string | null;
        active: number;
        created_at: number;
        promoted_at: number | null;
        yanked_at: number | null;
      }>();
    return c.json({
      releases: results.map((r) => ({
        version: r.version,
        sha256: r.sha256,
        r2Key: r.r2_key,
        sizeBytes: r.size_bytes,
        rolloutRules: r.rollout_rules ? JSON.parse(r.rollout_rules) : null,
        active: r.active === 1,
        createdAt: r.created_at,
        promotedAt: r.promoted_at,
        yankedAt: r.yanked_at,
      })),
    });
  });
