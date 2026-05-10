import { clock } from "../clock.ts";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings } from "../env.ts";
import { newUuid } from "../domain/ids.ts";
import { requireAuth, requireUser, type AuthVars } from "../middleware/auth.ts";

// avatarId is the unified format used by homes / users / tasks /
// labels: either "icon:<name>" (preset glyph from
// webapp/src/components/Icon.tsx) or a 32-hex UUID pointing at an
// uploaded photo in the avatars table. The legacy `icon` field is
// kept on the wire for backwards-compat — old clients (firmware
// pre-PR#42, ops scripts) can still write a bare icon name and the
// server normalises it to "icon:<name>" before storing in avatar_id.
const LabelInput = z.object({
  displayName: z.string().min(1).max(40),
  color: z.string().max(20).nullish(),
  // Either explicit avatarId (new path) OR legacy icon name. When
  // both are present, avatarId wins (consumer was clearly upgraded).
  avatarId: z.string().max(40).nullish(),
  icon: z.string().max(40).nullish(),
  sortOrder: z.number().int().optional(),
});

interface LabelRow {
  id: string;
  home_id: string;
  display_name: string;
  color: string | null;
  icon: string | null;
  avatar_id: string | null;
  system: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

// Read path: prefer avatar_id; fall back to "icon:<icon>" so labels
// that haven't been touched since migration 0015 still surface a
// usable avatarId for the renderer. Surface BOTH on the wire so old
// clients keep working.
const resolveAvatarId = (r: { avatar_id: string | null; icon: string | null }): string | null => {
  if (r.avatar_id) return r.avatar_id;
  if (r.icon) return `icon:${r.icon}`;
  return null;
};

const toDto = (r: LabelRow) => ({
  id: r.id,
  homeId: r.home_id,
  displayName: r.display_name,
  color: r.color,
  // `icon` on the wire = legacy bare-name form. Old webapp builds
  // read this; new builds prefer avatarId.
  icon: r.icon,
  avatarId: resolveAvatarId(r),
  system: r.system === 1,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// Write path: normalise input.avatarId / input.icon onto a single
// avatar_id value. Accepts either format from the client; stores the
// unified form in `avatar_id`. Returns the resolved avatarId for
// inclusion in the response DTO.
//
// Param shape allows `undefined` because zod's `.nullish()` produces
// `string | null | undefined` and tsconfig's exactOptionalPropertyTypes
// distinguishes "field absent" from "field set to undefined" — we
// just want all three (absent / null / present) to be treated as
// "no value" by the helper.
const normaliseAvatar = (input: {
  avatarId?: string | null | undefined;
  icon?: string | null | undefined;
}): string | null => {
  if (input.avatarId) return input.avatarId;
  if (input.icon) return `icon:${input.icon}`;
  if (input.avatarId === null || input.icon === null) return null;
  return null;
};

export const labelsRouter = new Hono<{
  Bindings: Bindings;
  Variables: AuthVars;
}>()
  .use("*", requireAuth(), requireUser())

  .get("/", async (c) => {
    const info = c.get("user");
    const { results } = await c.env.DB
      .prepare(
        `SELECT id, home_id, display_name, color, icon, avatar_id, system,
                sort_order, created_at, updated_at
         FROM labels
         WHERE home_id = ? AND is_deleted = 0
         ORDER BY sort_order ASC, display_name ASC`,
      )
      .bind(info.homeId)
      .all<LabelRow>();
    return c.json({ labels: results.map(toDto) });
  })

  .post("/", zValidator("json", LabelInput), async (c) => {
    const info = c.get("user");
    const id = newUuid();
    const nowSec = clock().nowSec();
    const body = c.req.valid("json");
    const avatarId = normaliseAvatar(body);
    await c.env.DB.prepare(
      `INSERT INTO labels (id, home_id, display_name, color, icon, avatar_id,
                           system, sort_order, created_at, updated_at, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0)`,
    )
      .bind(
        id,
        info.homeId,
        body.displayName,
        body.color ?? null,
        // Keep `icon` populated for preset avatars so old clients
        // reading the legacy field still see the name. UUID avatars
        // leave it null.
        avatarId && avatarId.startsWith("icon:") ? avatarId.slice(5) : null,
        avatarId,
        body.sortOrder ?? 100,
        nowSec,
        nowSec,
      )
      .run();
    return c.json(
      {
        id,
        homeId: info.homeId,
        displayName: body.displayName,
        color: body.color ?? null,
        icon: avatarId && avatarId.startsWith("icon:") ? avatarId.slice(5) : null,
        avatarId,
        system: false,
        sortOrder: body.sortOrder ?? 100,
        createdAt: nowSec,
        updatedAt: nowSec,
      },
      201,
    );
  })

  .patch("/:id", zValidator("json", LabelInput.partial()), async (c) => {
    const info = c.get("user");
    const id = c.req.param("id");
    const patch = c.req.valid("json");
    const nowSec = clock().nowSec();
    const row = await c.env.DB
      .prepare("SELECT home_id FROM labels WHERE id = ? AND is_deleted = 0")
      .bind(id)
      .first<{ home_id: string }>();
    if (!row || row.home_id !== info.homeId) {
      return c.json({ error: "not-found" }, 404);
    }
    // Avatar update is opt-in — only touch the column when the
    // request explicitly mentioned avatarId or icon. COALESCE-shaped
    // SQL would otherwise blow away an existing value when the
    // patch only changes displayName.
    const sets: string[] = [];
    const binds: unknown[] = [];
    if (patch.displayName !== undefined) {
      sets.push("display_name = ?");
      binds.push(patch.displayName);
    }
    if (patch.color !== undefined) {
      sets.push("color = ?");
      binds.push(patch.color ?? null);
    }
    if (patch.avatarId !== undefined || patch.icon !== undefined) {
      const avatarId = normaliseAvatar(patch);
      sets.push("avatar_id = ?");
      binds.push(avatarId);
      sets.push("icon = ?");
      binds.push(
        avatarId && avatarId.startsWith("icon:") ? avatarId.slice(5) : null,
      );
    }
    if (patch.sortOrder !== undefined) {
      sets.push("sort_order = ?");
      binds.push(patch.sortOrder);
    }
    if (sets.length === 0) return c.body(null, 204);
    sets.push("updated_at = ?");
    binds.push(nowSec);
    binds.push(id);
    await c.env.DB
      .prepare(`UPDATE labels SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...binds)
      .run();
    return c.body(null, 204);
  })

  .delete("/:id", async (c) => {
    const info = c.get("user");
    const id = c.req.param("id");
    const row = await c.env.DB
      .prepare("SELECT home_id, system FROM labels WHERE id = ? AND is_deleted = 0")
      .bind(id)
      .first<{ home_id: string; system: number }>();
    if (!row || row.home_id !== info.homeId) {
      return c.json({ error: "not-found" }, 404);
    }
    if (row.system === 1) {
      return c.json({ error: "cannot delete a system label" }, 409);
    }
    const nowSec = clock().nowSec();
    await c.env.DB.prepare(
      "UPDATE labels SET is_deleted = 1, updated_at = ? WHERE id = ?",
    )
      .bind(nowSec, id)
      .run();
    return c.body(null, 204);
  });
