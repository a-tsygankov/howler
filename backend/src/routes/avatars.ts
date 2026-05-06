import { clock } from "../clock.ts";
import { Hono } from "hono";
import type { Bindings } from "../env.ts";
import { newUuid } from "../domain/ids.ts";
import { requireAuth, requireUser, type AuthVars } from "../middleware/auth.ts";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

const extFor = (mime: string): string =>
  mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";

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
  .get("/:id", async (c) => {
    const id = c.req.param("id");
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

  // POST multipart/form-data — single field "file".
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
    const id = newUuid();
    const r2Key = `avatars/${id}.${extFor(file.type)}`;
    await c.env.AVATARS.put(r2Key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });
    const nowSec = clock().nowSec();
    await c.env.DB.prepare(
      `INSERT INTO avatars (id, home_id, r2_key, content_type, size_bytes, created_at, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    )
      .bind(id, u.homeId, r2Key, file.type, file.size, nowSec)
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
