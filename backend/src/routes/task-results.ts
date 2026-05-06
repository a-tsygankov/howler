import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings } from "../env.ts";
import { newUuid } from "../domain/ids.ts";
import { requireAuth, requireUser, type AuthVars } from "../middleware/auth.ts";

const TaskResultInput = z.object({
  displayName: z.string().min(1).max(40),
  unitName: z.string().min(1).max(20),
  minValue: z.number().nullish(),
  maxValue: z.number().nullish(),
  step: z.number().positive().default(1),
  defaultValue: z.number().nullish(),
  useLastValue: z.boolean().default(true),
  sortOrder: z.number().int().optional(),
});

interface TaskResultRow {
  id: string;
  home_id: string;
  display_name: string;
  unit_name: string;
  min_value: number | null;
  max_value: number | null;
  step: number;
  default_value: number | null;
  use_last_value: number;
  system: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

const toDto = (r: TaskResultRow) => ({
  id: r.id,
  homeId: r.home_id,
  displayName: r.display_name,
  unitName: r.unit_name,
  minValue: r.min_value,
  maxValue: r.max_value,
  step: r.step,
  defaultValue: r.default_value,
  useLastValue: r.use_last_value === 1,
  system: r.system === 1,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const taskResultsRouter = new Hono<{
  Bindings: Bindings;
  Variables: AuthVars;
}>()
  .use("*", requireAuth(), requireUser())

  .get("/", async (c) => {
    const info = c.get("user");
    const { results } = await c.env.DB
      .prepare(
        `SELECT * FROM task_results
         WHERE home_id = ? AND is_deleted = 0
         ORDER BY sort_order ASC, display_name ASC`,
      )
      .bind(info.homeId)
      .all<TaskResultRow>();
    return c.json({ taskResults: results.map(toDto) });
  })

  .post("/", zValidator("json", TaskResultInput), async (c) => {
    const info = c.get("user");
    const body = c.req.valid("json");
    const id = newUuid();
    const nowSec = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(
      `INSERT INTO task_results (id, home_id, display_name, unit_name, min_value, max_value, step, default_value, use_last_value, system, sort_order, created_at, updated_at, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0)`,
    )
      .bind(
        id,
        info.homeId,
        body.displayName,
        body.unitName,
        body.minValue ?? null,
        body.maxValue ?? null,
        body.step,
        body.defaultValue ?? null,
        body.useLastValue ? 1 : 0,
        body.sortOrder ?? 100,
        nowSec,
        nowSec,
      )
      .run();
    return c.json({ id, homeId: info.homeId, ...body, system: false, createdAt: nowSec, updatedAt: nowSec }, 201);
  })

  .delete("/:id", async (c) => {
    const info = c.get("user");
    const id = c.req.param("id");
    const row = await c.env.DB
      .prepare("SELECT home_id, system FROM task_results WHERE id = ? AND is_deleted = 0")
      .bind(id)
      .first<{ home_id: string; system: number }>();
    if (!row || row.home_id !== info.homeId) {
      return c.json({ error: "not-found" }, 404);
    }
    const nowSec = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(
      "UPDATE task_results SET is_deleted = 1, updated_at = ? WHERE id = ?",
    )
      .bind(nowSec, id)
      .run();
    return c.body(null, 204);
  });
