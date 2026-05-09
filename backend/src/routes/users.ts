import { clock } from "../clock.ts";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings } from "../env.ts";
import { newUuid } from "../domain/ids.ts";
import { markDeviceAlive, requireAuth, requireUser, type AuthVars } from "../middleware/auth.ts";

const CreateUser = z.object({
  displayName: z.string().min(1).max(40),
  login: z.string().min(3).max(40).regex(/^[a-z0-9_-]+$/i).nullish(),
});

const Hex32 = z.string().regex(/^[0-9a-f]{32}$/);
const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const UpdateUser = z.object({
  displayName: z.string().min(1).max(40).optional(),
  avatarId: Hex32.nullable().optional(),
  // Accent / row-background colour. `null` clears it (UI falls
  // back to the seed-derived default); omitted leaves it alone.
  bgColor: HexColor.nullable().optional(),
});

interface UserRow {
  id: string;
  home_id: string;
  display_name: string;
  login: string | null;
  avatar_id: string | null;
  bg_color: string | null;
  created_at: number;
  updated_at: number;
}

const toDto = (r: UserRow) => ({
  id: r.id,
  homeId: r.home_id,
  displayName: r.display_name,
  login: r.login,
  avatarId: r.avatar_id,
  bgColor: r.bg_color,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const usersRouter = new Hono<{
  Bindings: Bindings;
  Variables: AuthVars;
}>()
  // Loose auth at the router level so device tokens can hit GET —
  // the post-done UserPicker on the dial needs the home roster to
  // attribute completions. Same pattern dashboard.ts uses; mutating
  // verbs below re-arm requireUser() per route so the device can
  // never create / rename / delete users.
  .use("*", requireAuth(), markDeviceAlive())

  .get("/", async (c) => {
    const homeId = c.get("auth").homeId;
    const { results } = await c.env.DB
      .prepare(
        `SELECT id, home_id, display_name, login, avatar_id, bg_color,
           created_at, updated_at
         FROM users WHERE home_id = ? AND is_deleted = 0
         ORDER BY created_at ASC`,
      )
      .bind(homeId)
      .all<UserRow>();
    return c.json({ users: results.map(toDto) });
  })

  .post("/", requireUser(), zValidator("json", CreateUser), async (c) => {
    const u = c.get("user");
    const { displayName, login } = c.req.valid("json");

    if (login) {
      const taken = await c.env.DB
        .prepare("SELECT id FROM users WHERE login = ? AND is_deleted = 0")
        .bind(login)
        .first<{ id: string }>();
      if (taken) return c.json({ error: "login already taken" }, 409);
    }

    const id = newUuid();
    const nowSec = clock().nowSec();
    await c.env.DB.prepare(
      `INSERT INTO users (id, home_id, display_name, login, created_at, updated_at, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    )
      .bind(id, u.homeId, displayName, login ?? null, nowSec, nowSec)
      .run();
    return c.json(
      {
        id,
        homeId: u.homeId,
        displayName,
        login: login ?? null,
        avatarId: null,
        bgColor: null,
        createdAt: nowSec,
        updatedAt: nowSec,
      },
      201,
    );
  })

  .patch("/:id", requireUser(), zValidator("json", UpdateUser), async (c) => {
    const u = c.get("user");
    const id = c.req.param("id");
    const patch = c.req.valid("json");
    const row = await c.env.DB
      .prepare("SELECT home_id FROM users WHERE id = ? AND is_deleted = 0")
      .bind(id)
      .first<{ home_id: string }>();
    if (!row || row.home_id !== u.homeId) {
      return c.json({ error: "not-found" }, 404);
    }
    const sets: string[] = [];
    const binds: unknown[] = [];
    if (patch.displayName !== undefined) {
      sets.push("display_name = ?");
      binds.push(patch.displayName);
    }
    if (patch.avatarId !== undefined) {
      sets.push("avatar_id = ?");
      binds.push(patch.avatarId);
    }
    if (patch.bgColor !== undefined) {
      sets.push("bg_color = ?");
      binds.push(patch.bgColor);
    }
    if (sets.length === 0) return c.body(null, 204);
    sets.push("updated_at = ?");
    binds.push(clock().nowSec());
    binds.push(id);
    await c.env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...binds)
      .run();
    return c.body(null, 204);
  })

  // DELETE soft-deletes the user. Cleanup cascade per plan §6.3 #3:
  //   - remove from task_assignments (drop the join rows)
  //   - tasks where the only remaining assignee was this user AND
  //     is_private = 1 → tombstone (otherwise leave alone)
  //   - the deleted user can no longer log in / appear in pickers
  // We refuse to delete the last user in a home — at least one must
  // survive so the home is reachable from /api/auth/login.
  .delete("/:id", requireUser(), async (c) => {
    const u = c.get("user");
    const id = c.req.param("id");
    if (id === u.userId) return c.json({ error: "cannot delete yourself" }, 400);

    const target = await c.env.DB
      .prepare("SELECT home_id FROM users WHERE id = ? AND is_deleted = 0")
      .bind(id)
      .first<{ home_id: string }>();
    if (!target || target.home_id !== u.homeId) {
      return c.json({ error: "not-found" }, 404);
    }

    const remaining = await c.env.DB
      .prepare(
        "SELECT COUNT(*) AS n FROM users WHERE home_id = ? AND is_deleted = 0 AND id != ?",
      )
      .bind(u.homeId, id)
      .first<{ n: number }>();
    if ((remaining?.n ?? 0) === 0) {
      return c.json({ error: "cannot delete the last user in a home" }, 400);
    }

    const nowMs = clock().nowMs();
    const nowSec = Math.floor(nowMs / 1000);

    // Find tasks that lose their only assignee in this delete AND are
    // private → those get tombstoned in the same batch.
    const { results: orphaned } = await c.env.DB
      .prepare(
        `SELECT t.id FROM tasks t
         WHERE t.home_id = ? AND t.is_deleted = 0 AND t.is_private = 1
           AND EXISTS (
             SELECT 1 FROM task_assignments a
             WHERE a.task_id = t.id AND a.user_id = ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM task_assignments a
             WHERE a.task_id = t.id AND a.user_id != ?
           )`,
      )
      .bind(u.homeId, id, id)
      .all<{ id: string }>();

    const ops: D1PreparedStatement[] = [
      c.env.DB.prepare(
        "UPDATE users SET is_deleted = 1, updated_at = ? WHERE id = ?",
      ).bind(nowSec, id),
      c.env.DB.prepare("DELETE FROM task_assignments WHERE user_id = ?").bind(id),
    ];
    for (const t of orphaned) {
      ops.push(
        c.env.DB.prepare(
          "UPDATE tasks SET is_deleted = 1, updated_at = ? WHERE id = ?",
        ).bind(nowMs, t.id),
      );
    }
    await c.env.DB.batch(ops);
    return c.json({ ok: true, orphanedTasksTombstoned: orphaned.length });
  });
