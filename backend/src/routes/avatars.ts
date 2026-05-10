import { clock } from "../clock.ts";
import { Hono } from "hono";
import type { Bindings } from "../env.ts";
import { newUuid } from "../domain/ids.ts";
import { requireAuth, requireUser, type AuthVars } from "../middleware/auth.ts";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

// Phase 7: per-photo 1-bit variant for the device renderer. The
// browser dither pass produces exactly 72 bytes (24 × 24 / 8); we
// validate the length on the wire so a malformed upload doesn't
// poison the row. Format version bumps would force an explicit
// migration — devices reject mismatching versions in the renderer.
const BITMAP_1BIT_BYTES = 72;
const BITMAP_1BIT_FORMAT_VERSION = 1;

const extFor = (mime: string): string =>
  mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";

// Hex-SHA-1 over an ArrayBuffer. Web Crypto in Workers gives us
// SubtleCrypto.digest; the result is an ArrayBuffer we hex-encode
// for the ETag header. Same shape the icons table uses.
const sha1Hex = async (bytes: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

interface AvatarRow {
  id: string;
  home_id: string;
  r2_key: string;
  content_type: string;
  size_bytes: number;
  created_at: number;
}

export const avatarsRouter = new Hono<{
  Bindings: Bindings;
  Variables: AuthVars;
}>()
  // Public-ish GET — anyone with the id can fetch the bytes. Avatar
  // ids are 32-hex unguessable, so this is "obscurity-but-not-secret"
  // and it's intentional: the SPA must show avatars in <img src=…>
  // without an Authorization header round-trip on every render.
  //
  // ?format=1bit — Phase 7. Returns the dithered 24×24 1-bit bitmap
  // the device's IconCache renders. Same layout as the icons table
  // (see migration 0010); the device routes UUID-shaped IconCache
  // keys here instead of /api/icons/:name.
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const format = c.req.query("format");

    if (format === "1bit") {
      const row = await c.env.DB
        .prepare(
          `SELECT bitmap_1bit, bitmap_1bit_hash, bitmap_1bit_format_version
           FROM avatars WHERE id = ? AND is_deleted = 0`,
        )
        .bind(id)
        .first<{
          bitmap_1bit: ArrayBuffer | null;
          bitmap_1bit_hash: string | null;
          bitmap_1bit_format_version: number | null;
        }>();
      if (!row || !row.bitmap_1bit) return c.json({ error: "not-found" }, 404);

      const ifNoneMatch = c.req.header("If-None-Match");
      if (
        ifNoneMatch &&
        row.bitmap_1bit_hash &&
        ifNoneMatch.replace(/"/g, "") === row.bitmap_1bit_hash
      ) {
        return new Response(null, { status: 304 });
      }

      const bytes = new Uint8Array(row.bitmap_1bit);
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(bytes.byteLength),
          // Mirrors the icons route's headers so device-side
          // parsing logic (X-Icon-* sniffing) works unchanged.
          ...(row.bitmap_1bit_hash && {
            "etag": `"${row.bitmap_1bit_hash}"`,
            "x-icon-hash": row.bitmap_1bit_hash,
          }),
          "x-icon-width": "24",
          "x-icon-height": "24",
          "x-icon-format-version": String(
            row.bitmap_1bit_format_version ?? BITMAP_1BIT_FORMAT_VERSION,
          ),
          "cache-control": "private, max-age=3600",
        },
      });
    }

    const row = await c.env.DB
      .prepare("SELECT r2_key, content_type FROM avatars WHERE id = ? AND is_deleted = 0")
      .bind(id)
      .first<{ r2_key: string; content_type: string }>();
    if (!row) return c.json({ error: "not-found" }, 404);
    const obj = await c.env.AVATARS.get(row.r2_key);
    if (!obj) return c.json({ error: "blob-missing" }, 410);
    return new Response(obj.body, {
      headers: {
        "content-type": row.content_type,
        "cache-control": "public, max-age=86400, immutable",
      },
    });
  })

  .use("*", requireAuth(), requireUser())

  // POST multipart/form-data
  //   file        (required) JPEG / PNG / WebP, ≤2 MB
  //   bitmap1bit  (optional) Phase 7 device variant — 72 raw bytes
  //                          (24×24 / 8). Browser-side dither pass
  //                          produces it alongside the WebP encode.
  .post("/", async (c) => {
    const u = c.get("user");
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "file field required" }, 400);
    }
    if (!ALLOWED.has(file.type)) {
      return c.json({ error: "only jpeg/png/webp" }, 415);
    }
    if (file.size > MAX_BYTES) {
      return c.json({ error: `max ${MAX_BYTES} bytes` }, 413);
    }

    // Optional 1-bit variant. Strict size check — exactly 72 bytes
    // or reject. A malformed bitmap row would render as garbage on
    // the device, and silently corrupt the IconCache TTL window.
    let bitmap1bitBytes: ArrayBuffer | null = null;
    let bitmap1bitHash: string | null = null;
    // `FormData.get` returns FormDataEntryValue (File | string) per
    // the spec — Blob inputs to .append() are auto-promoted to File
    // with a synthetic name. The Blob path the SPA uses lands here.
    const rawBitmap = form?.get("bitmap1bit");
    if (rawBitmap instanceof File) {
      const buf = await rawBitmap.arrayBuffer();
      if (buf.byteLength !== BITMAP_1BIT_BYTES) {
        return c.json(
          { error: `bitmap1bit must be exactly ${BITMAP_1BIT_BYTES} bytes` },
          400,
        );
      }
      bitmap1bitBytes = buf;
      bitmap1bitHash = await sha1Hex(buf);
    }

    const id = newUuid();
    const r2Key = `avatars/${id}.${extFor(file.type)}`;
    await c.env.AVATARS.put(r2Key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });
    const nowSec = clock().nowSec();
    await c.env.DB.prepare(
      `INSERT INTO avatars
         (id, home_id, r2_key, content_type, size_bytes, created_at,
          is_deleted, bitmap_1bit, bitmap_1bit_hash, bitmap_1bit_format_version)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    )
      .bind(
        id,
        u.homeId,
        r2Key,
        file.type,
        file.size,
        nowSec,
        bitmap1bitBytes,
        bitmap1bitHash,
        bitmap1bitBytes ? BITMAP_1BIT_FORMAT_VERSION : null,
      )
      .run();
    return c.json({ id, url: `/api/avatars/${id}` }, 201);
  })

  .delete("/:id", async (c) => {
    const u = c.get("user");
    const id = c.req.param("id");
    const row = await c.env.DB
      .prepare("SELECT home_id FROM avatars WHERE id = ? AND is_deleted = 0")
      .bind(id)
      .first<AvatarRow>();
    if (!row || row.home_id !== u.homeId) {
      return c.json({ error: "not-found" }, 404);
    }
    await c.env.DB.prepare(
      "UPDATE avatars SET is_deleted = 1 WHERE id = ?",
    )
      .bind(id)
      .run();
    return c.body(null, 204);
  });
