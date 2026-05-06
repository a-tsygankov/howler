import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings } from "../env.ts";
import { newUuid } from "../domain/ids.ts";
import { requireAuth, requireUser, type AuthVars } from "../middleware/auth.ts";

const LabelInput = z.object({
  displayName: z.string().min(1).max(40),
  color: z.string().max(20).nullish(),
  sortOrder: z.number().int().optional(),
});

interface LabelRow {
  id: string;
  home_id: string;
  display_name: string;
  color: string | null;
  system: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

const toDto = (r: LabelRow) => ({
  id: r.id,
  homeId: r.home_id,
  displayName: r.display_name,
  color: r.color,
  system: r.system === 1,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const labelsRouter = new Hono<{
  Bindings: Bindings;
  Variables: AuthVars;
}>()
  .use("*", requireAuth(), requireUser())

  .get("/", async (c) => {
    const info = c.get("user");
    const { results } = await c.env.DB
      .prepare(
        `SELECT id, home_id, display_name, color, system, sort_order,
           created_at, updated_at
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
    const nowSec = Math.floor(Date.now() / 1000);
    const body = c.req.valid("json");
    await c.env.DB.prepare(
      `INSERT INTO labels (id, home_id, display_name, color, system, sort_order, created_at, updated_at, is_deleted)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, 0)`,
    )
      .bind(
        id,
        info.homeId,
        body.displayName,
        body.color ?? null,
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
    const nowSec = Math.floor(Date.now() / 1000);
    const row = await c.env.DB
      .prepare("SELECT home_id FROM labels WHERE id = ? AND is_deleted = 0")
      .bind(id)
      .first<{ home_id: string }>();
    if (!row || row.home_id !== info.homeId) {
      return c.json({ error: "not-found" }, 404);
    }
    await c.env.DB.prepare(
      `UPDATE labels SET
         display_name = COALESCE(?, display_name),
         color = COALESCE(?, color),
         sort_order = COALESCE(?, sort_order),
         updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        patch.displayName ?? null,
        patch.color ?? null,
        patch.sortOrder ?? null,
        nowSec,
        id,
      )
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
    const nowSec = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(
      "UPDATE labels SET is_deleted = 1, updated_at = ? WHERE id = ?",
    )
      .bind(nowSec, id)
      .run();
    return c.body(null, 204);
  });
