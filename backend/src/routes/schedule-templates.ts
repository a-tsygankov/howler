import { clock } from "../clock.ts";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings } from "../env.ts";
import { newUuid } from "../domain/ids.ts";
import { ScheduleRuleSchema } from "../shared/schemas.ts";
import { requireAuth, requireUser, type AuthVars } from "../middleware/auth.ts";

const TemplateInput = z.object({
  displayName: z.string().min(1).max(40),
  description: z.string().max(200).nullish(),
  rule: ScheduleRuleSchema,
  sortOrder: z.number().int().optional(),
});

interface TemplateRow {
  id: string;
  home_id: string;
  display_name: string;
  description: string | null;
  rule_json: string;
  system: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

const toDto = (r: TemplateRow) => ({
  id: r.id,
  homeId: r.home_id,
  displayName: r.display_name,
  description: r.description,
  rule: JSON.parse(r.rule_json),
  system: r.system === 1,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const scheduleTemplatesRouter = new Hono<{
  Bindings: Bindings;
  Variables: AuthVars;
}>()
  .use("*", requireAuth(), requireUser())

  .get("/", async (c) => {
    const u = c.get("user");
    const { results } = await c.env.DB
      .prepare(
        `SELECT * FROM schedule_templates
         WHERE home_id = ? AND is_deleted = 0
         ORDER BY sort_order ASC, display_name ASC`,
      )
      .bind(u.homeId)
      .all<TemplateRow>();
    return c.json({ templates: results.map(toDto) });
  })

  .post("/", zValidator("json", TemplateInput), async (c) => {
    const u = c.get("user");
    const body = c.req.valid("json");
    const id = newUuid();
    const nowSec = clock().nowSec();
    await c.env.DB.prepare(
      `INSERT INTO schedule_templates (id, home_id, display_name, description, rule_json, system, sort_order, created_at, updated_at, is_deleted)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 0)`,
    )
      .bind(
        id,
        u.homeId,
        body.displayName,
        body.description ?? null,
        JSON.stringify(body.rule),
        body.sortOrder ?? 100,
        nowSec,
        nowSec,
      )
      .run();
    return c.json(
      {
        id,
        homeId: u.homeId,
        displayName: body.displayName,
        description: body.description ?? null,
        rule: body.rule,
        system: false,
        sortOrder: body.sortOrder ?? 100,
        createdAt: nowSec,
        updatedAt: nowSec,
      },
      201,
    );
  })

  .patch("/:id", zValidator("json", TemplateInput.partial()), async (c) => {
    const u = c.get("user");
    const id = c.req.param("id");
    const patch = c.req.valid("json");
    const row = await c.env.DB
      .prepare(
        "SELECT home_id, system FROM schedule_templates WHERE id = ? AND is_deleted = 0",
      )
      .bind(id)
      .first<{ home_id: string; system: number }>();
    if (!row || row.home_id !== u.homeId) {
      return c.json({ error: "not-found" }, 404);
    }
    if (row.system === 1) {
      return c.json({ error: "cannot edit a system template" }, 409);
    }
    const nowSec = clock().nowSec();
    await c.env.DB
      .prepare(
        `UPDATE schedule_templates SET
           display_name = COALESCE(?, display_name),
           description  = COALESCE(?, description),
           rule_json    = COALESCE(?, rule_json),
           sort_order   = COALESCE(?, sort_order),
           updated_at   = ?
         WHERE id = ?`,
      )
      .bind(
        patch.displayName ?? null,
        patch.description ?? null,
        patch.rule ? JSON.stringify(patch.rule) : null,
        patch.sortOrder ?? null,
        nowSec,
        id,
      )
      .run();
    return c.body(null, 204);
  })

  .delete("/:id", async (c) => {
    const u = c.get("user");
    const id = c.req.param("id");
    const row = await c.env.DB
      .prepare("SELECT home_id, system FROM schedule_templates WHERE id = ? AND is_deleted = 0")
      .bind(id)
      .first<{ home_id: string; system: number }>();
    if (!row || row.home_id !== u.homeId) {
      return c.json({ error: "not-found" }, 404);
    }
    if (row.system === 1) {
      return c.json({ error: "cannot delete a system template" }, 409);
    }
    const nowSec = clock().nowSec();
    await c.env.DB.prepare(
      "UPDATE schedule_templates SET is_deleted = 1, updated_at = ? WHERE id = ?",
    )
      .bind(nowSec, id)
      .run();
    return c.body(null, 204);
  });
