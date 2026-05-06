import { clock } from "../clock.ts";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../env.ts";
import { D1UnitOfWork } from "../repos/d1/unit-of-work.ts";
import { CreateTaskSchema, UpdateTaskSchema } from "../shared/schemas.ts";
import {
  createTask,
  getTask,
  listTasks,
  updateTask,
} from "../services/task-service.ts";
import { asHomeId, asTaskId } from "../domain/ids.ts";
import { requireAuth, requireUser, type AuthVars } from "../middleware/auth.ts";

const replaceAssignments = async (
  db: D1Database,
  taskId: string,
  homeId: string,
  userIds: string[],
  nowSec: number,
): Promise<void> => {
  // Validate every userId belongs to the caller's home before
  // writing — otherwise a hostile client could attach foreign users.
  if (userIds.length > 0) {
    const placeholders = userIds.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT id FROM users WHERE home_id = ? AND is_deleted = 0
         AND id IN (${placeholders})`,
      )
      .bind(homeId, ...userIds)
      .all<{ id: string }>();
    const valid = new Set(results.map((r) => r.id));
    for (const u of userIds) {
      if (!valid.has(u)) throw new Error(`user ${u} not in this home`);
    }
  }
  const ops: D1PreparedStatement[] = [
    db.prepare("DELETE FROM task_assignments WHERE task_id = ?").bind(taskId),
  ];
  for (const userId of userIds) {
    ops.push(
      db
        .prepare(
          "INSERT INTO task_assignments (task_id, user_id, created_at) VALUES (?, ?, ?)",
        )
        .bind(taskId, userId, nowSec),
    );
  }
  if (ops.length > 1) await db.batch(ops);
  else await ops[0]!.run();
};

export const tasksRouter = new Hono<{
  Bindings: Bindings;
  Variables: AuthVars;
}>()
  .use("*", requireAuth(), requireUser())

  .get("/", async (c) => {
    const homeId = asHomeId(c.get("user").homeId);
    const uow = new D1UnitOfWork(c.env.DB);
    const tasks = await listTasks(uow, homeId);
    return c.json({ tasks });
  })

  .get("/:id", async (c) => {
    const callerHomeId = c.get("user").homeId;
    const uow = new D1UnitOfWork(c.env.DB);
    const result = await getTask(uow, c.req.param("id"));
    if (!result.ok) return c.json({ error: result.error }, 404);
    if (result.value.homeId !== callerHomeId) {
      return c.json({ error: "not-found" }, 404);
    }
    // Hydrate assignees.
    const { results } = await c.env.DB
      .prepare("SELECT user_id FROM task_assignments WHERE task_id = ?")
      .bind(result.value.id)
      .all<{ user_id: string }>();
    return c.json({
      ...result.value,
      assignees: results.map((r) => r.user_id),
    });
  })

  .post("/", zValidator("json", CreateTaskSchema), async (c) => {
    const auth = c.get("user");
    const home = await c.env.DB
      .prepare("SELECT tz FROM homes WHERE id = ?")
      .bind(auth.homeId)
      .first<{ tz: string }>();
    const homeTz = home?.tz ?? "UTC";
    const uow = new D1UnitOfWork(c.env.DB);
    let input = c.req.valid("json");

    // Resolve templateId → rule before the service runs. Template
    // rules already match the ScheduleRule discriminator, so we just
    // unpack them into times/intervalDays. ONESHOT templates are
    // unusual but supported.
    if (input.templateId) {
      const t = await c.env.DB
        .prepare("SELECT rule_json, home_id FROM schedule_templates WHERE id = ? AND is_deleted = 0")
        .bind(input.templateId)
        .first<{ rule_json: string; home_id: string | null }>();
      if (!t || (t.home_id && t.home_id !== auth.homeId)) {
        return c.json({ error: "template not found" }, 404);
      }
      const rule = JSON.parse(t.rule_json) as
        | { kind: "DAILY"; times: string[] }
        | { kind: "PERIODIC"; intervalDays: number }
        | { kind: "ONESHOT" };
      input = {
        ...input,
        kind: rule.kind,
        ...(rule.kind === "DAILY" ? { times: rule.times } : {}),
        ...(rule.kind === "PERIODIC" ? { intervalDays: rule.intervalDays } : {}),
      };
    }

    const { dto, taskId } = await createTask(
      uow,
      { homeId: auth.homeId, creatorUserId: auth.userId, homeTz },
      input,
    );
    if (input.assignees && input.assignees.length > 0) {
      await replaceAssignments(
        c.env.DB,
        taskId,
        auth.homeId,
        input.assignees,
        clock().nowSec(),
      );
    }
    return c.json(dto, 201);
  })

  .patch("/:id", zValidator("json", UpdateTaskSchema), async (c) => {
    const auth = c.get("user");
    const id = c.req.param("id");
    const uow = new D1UnitOfWork(c.env.DB);
    const patch = c.req.valid("json");
    const result = await updateTask(uow, id, auth.homeId, patch);
    if (!result.ok) {
      const status = result.error === "not-found" ? 404 : 403;
      return c.json({ error: result.error }, status);
    }
    if (patch.assignees !== undefined) {
      await replaceAssignments(
        c.env.DB,
        id,
        auth.homeId,
        patch.assignees,
        clock().nowSec(),
      );
    }
    return c.json(result.value);
  })

  // Per-task execution history. Append-only `task_executions` rows
  // (plan §6.5) are the dashboard's data source for sparklines and
  // aggregates ("avg daily grams over the last 7 days"). Limit
  // capped server-side; default 30 covers a month of daily acks.
  .get("/:id/executions", async (c) => {
    const callerHomeId = c.get("user").homeId;
    const id = c.req.param("id");
    const limit = Math.min(
      parseInt(c.req.query("limit") ?? "30", 10) || 30,
      365,
    );
    const task = await c.env.DB
      .prepare("SELECT home_id FROM tasks WHERE id = ? AND is_deleted = 0")
      .bind(id)
      .first<{ home_id: string }>();
    if (!task || task.home_id !== callerHomeId) {
      return c.json({ error: "not-found" }, 404);
    }
    const { results } = await c.env.DB
      .prepare(
        `SELECT id, task_id, occurrence_id, user_id, label_id,
           result_type_id, result_value, result_unit, notes, ts
         FROM task_executions
         WHERE task_id = ?
         ORDER BY ts DESC
         LIMIT ?`,
      )
      .bind(id, limit)
      .all<{
        id: string;
        task_id: string;
        occurrence_id: string | null;
        user_id: string | null;
        label_id: string | null;
        result_type_id: string | null;
        result_value: number | null;
        result_unit: string | null;
        notes: string | null;
        ts: number;
      }>();
    return c.json({
      executions: results.map((r) => ({
        id: r.id,
        taskId: r.task_id,
        occurrenceId: r.occurrence_id,
        userId: r.user_id,
        labelId: r.label_id,
        resultTypeId: r.result_type_id,
        resultValue: r.result_value,
        resultUnit: r.result_unit,
        notes: r.notes,
        ts: r.ts,
      })),
    });
  })

  .delete("/:id", async (c) => {
    const auth = c.get("user");
    const id = c.req.param("id");
    const uow = new D1UnitOfWork(c.env.DB);
    const result = await getTask(uow, id);
    if (!result.ok) return c.json({ error: result.error }, 404);
    if (result.value.homeId !== auth.homeId) {
      return c.json({ error: "not-found" }, 404);
    }
    await uow.run(async (tx) => {
      await tx.tasks.remove(asTaskId(result.value.id));
    });
    return c.body(null, 204);
  });
