import { clock } from "../clock.ts";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings } from "../env.ts";
import { newUuid } from "../domain/ids.ts";
import { markDeviceAlive, requireAuth, requireUser, type AuthVars } from "../middleware/auth.ts";

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
  // Loose auth at the router level so device tokens (issued by the
  // pair flow) can hit the GET — the on-device result-picker has
  // to look up the type a task is associated with, and gating the
  // entire router behind requireUser() left the dial's
  // findResultType() returning nullptr forever (resultTypes_ stays
  // empty after every sync). Mutations re-arm requireUser() per
  // route below — the device must not be able to create / edit /
  // delete result-type rows.
  .use("*", requireAuth(), markDeviceAlive())

  .get("/", async (c) => {
    const homeId = c.get("auth").homeId;
    const { results } = await c.env.DB
      .prepare(
        `SELECT * FROM task_results
         WHERE home_id = ? AND is_deleted = 0
         ORDER BY sort_order ASC, display_name ASC`,
      )
      .bind(homeId)
      .all<TaskResultRow>();
    return c.json({ taskResults: results.map(toDto) });
  })

  .post("/", requireUser(), zValidator("json", TaskResultInput), async (c) => {
    const info = c.get("user");
    const body = c.req.valid("json");
    const id = newUuid();
    const nowSec = clock().nowSec();
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

  .patch("/:id", requireUser(), zValidator("json", TaskResultInput.partial()), async (c) => {
    const info = c.get("user");
    const id = c.req.param("id");
    const patch = c.req.valid("json");
    const row = await c.env.DB
      .prepare("SELECT home_id FROM task_results WHERE id = ? AND is_deleted = 0")
      .bind(id)
      .first<{ home_id: string }>();
    if (!row || row.home_id !== info.homeId) {
      return c.json({ error: "not-found" }, 404);
    }
    const sets: string[] = [];
    const binds: unknown[] = [];
    if (patch.displayName !== undefined) {
      sets.push("display_name = ?");
      binds.push(patch.displayName);
    }
    if (patch.unitName !== undefined) {
      sets.push("unit_name = ?");
      binds.push(patch.unitName);
    }
    if (patch.minValue !== undefined) {
      sets.push("min_value = ?");
      binds.push(patch.minValue);
    }
    if (patch.maxValue !== undefined) {
      sets.push("max_value = ?");
      binds.push(patch.maxValue);
    }
    if (patch.step !== undefined) {
      sets.push("step = ?");
      binds.push(patch.step);
    }
    if (patch.defaultValue !== undefined) {
      sets.push("default_value = ?");
      binds.push(patch.defaultValue);
    }
    if (patch.useLastValue !== undefined) {
      sets.push("use_last_value = ?");
      binds.push(patch.useLastValue ? 1 : 0);
    }
    if (patch.sortOrder !== undefined) {
      sets.push("sort_order = ?");
      binds.push(patch.sortOrder);
    }
    if (sets.length === 0) return c.body(null, 204);
    sets.push("updated_at = ?");
    binds.push(clock().nowSec());
    binds.push(id);
    await c.env.DB.prepare(
      `UPDATE task_results SET ${sets.join(", ")} WHERE id = ?`,
    )
      .bind(...binds)
      .run();
    return c.body(null, 204);
  })

  // Plan §6.3 #10: deleting a TaskResult is a soft-delete; tasks
  // referencing it keep the FK pointing at the now-deleted row, so
  // historical task_executions stay legible via the snapshotted
  // result_unit. We surface a count of affected tasks in the
  // response so the SPA can show the warning before confirming.
  .delete("/:id", requireUser(), async (c) => {
    const info = c.get("user");
    const id = c.req.param("id");
    const row = await c.env.DB
      .prepare("SELECT home_id, system FROM task_results WHERE id = ? AND is_deleted = 0")
      .bind(id)
      .first<{ home_id: string; system: number }>();
    if (!row || row.home_id !== info.homeId) {
      return c.json({ error: "not-found" }, 404);
    }
    const referenced = await c.env.DB
      .prepare(
        "SELECT COUNT(*) AS n FROM tasks WHERE result_type_id = ? AND is_deleted = 0",
      )
      .bind(id)
      .first<{ n: number }>();
    const nowSec = clock().nowSec();
    await c.env.DB.prepare(
      "UPDATE task_results SET is_deleted = 1, updated_at = ? WHERE id = ?",
    )
      .bind(nowSec, id)
      .run();
    return c.json({ ok: true, tasksAffected: referenced?.n ?? 0 });
  });
