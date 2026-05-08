// Icon serving endpoint for the device.
//
// The webapp's Icon.tsx is the single source of truth for our icon
// shapes; the seed script (backend/scripts/seed-icons.mjs) rasterises
// those SVG paths into 24×24 1-bit bitmaps and inserts them into the
// `icons` table. Devices fetch by name on first encounter, cache the
// bitmap (and content_hash) in firmware, and refetch when the hash
// changes.
//
// This endpoint:
//   GET  /api/icons/:name           → binary bitmap (raw bytes), or
//                                     304 when the device's cached
//                                     hash matches the latest.
//   GET  /api/icons                 → JSON manifest: array of
//                                     {name, contentHash, updatedAt}.
//                                     Lets the device prune stale
//                                     cache entries on a periodic
//                                     sync cycle.
//
// Auth: device-or-user. We pin to requireAuth (not requireUser) so a
// paired device's token authorises icon fetches without going through
// a user session.

import { Hono } from "hono";
import type { Bindings } from "../env.ts";
import { requireAuth, type AuthVars } from "../middleware/auth.ts";

interface IconRow {
  name: string;
  format_version: number;
  width: number;
  height: number;
  bitmap: ArrayBuffer;     // D1 returns BLOBs as ArrayBuffer
  content_hash: string;
  updated_at: number;
}

export const iconsRouter = new Hono<{
  Bindings: Bindings;
  Variables: AuthVars;
}>();

iconsRouter.use("*", requireAuth());

// ── Manifest: list available icons, their hash + last-updated. ──
//
// The device polls this on its periodic-sync cadence (e.g. once per
// hour) so it can see which of its cached icons are stale and refetch
// just those. Cheap query — a single column scan on `icons`.
iconsRouter.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT name, content_hash, updated_at, width, height, format_version
     FROM icons
     ORDER BY name ASC`,
  ).all<{
    name: string;
    content_hash: string;
    updated_at: number;
    width: number;
    height: number;
    format_version: number;
  }>();
  return c.json({
    icons: (rows.results ?? []).map((r) => ({
      name: r.name,
      contentHash: r.content_hash,
      updatedAt: r.updated_at,
      width: r.width,
      height: r.height,
      formatVersion: r.format_version,
    })),
  });
});

// ── Binary bitmap fetch. ────────────────────────────────────────
//
// Returns the raw bitmap bytes with `application/octet-stream`. The
// device sends `If-None-Match: <hex hash>`; we 304 when it matches.
// Custom `X-Icon-Hash` / `X-Icon-Width` / `X-Icon-Height` /
// `X-Icon-Format-Version` headers carry the metadata so the device
// can validate the format without parsing a JSON wrapper.
//
// Cache-Control allows browsers / proxies to cache for an hour;
// the device drives its own cache on top using the manifest above.
iconsRouter.get("/:name", async (c) => {
  const name = c.req.param("name");
  if (!/^[a-z0-9_-]{1,40}$/.test(name)) {
    return c.json({ error: "invalid-icon-name" }, 400);
  }
  const row = await c.env.DB.prepare(
    `SELECT name, format_version, width, height, bitmap, content_hash, updated_at
     FROM icons
     WHERE name = ?`,
  )
    .bind(name)
    .first<IconRow>();
  if (!row) return c.json({ error: "icon-not-found" }, 404);

  const ifNoneMatch = c.req.header("If-None-Match");
  if (ifNoneMatch && ifNoneMatch.replace(/"/g, "") === row.content_hash) {
    return new Response(null, { status: 304 });
  }

  const bytes = new Uint8Array(row.bitmap);
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "ETag": `"${row.content_hash}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Icon-Hash": row.content_hash,
      "X-Icon-Width": String(row.width),
      "X-Icon-Height": String(row.height),
      "X-Icon-Format-Version": String(row.format_version),
      "X-Icon-Updated-At": String(row.updated_at),
    },
  });
});
