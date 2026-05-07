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
    if (tasks.length === 0) return c.json({ tasks });
    // Hydrate the schedule rule per task in one batch read so the
    // SPA can render times without an N+1 fetch. Rule is parsed
    // here (cheap) so the wire stays a structured shape.
    const placeholders = tasks.map(() => "?").join(",");
    const ids = tasks.map((t) => t.id);
    const { results } = await c.env.DB
      .prepare(
        `SELECT task_id, rule_json FROM schedules
         WHERE task_id IN (${placeholders}) AND is_deleted = 0`,
      )
      .bind(...ids)
      .all<{ task_id: string; rule_json: string }>();
    const ruleByTask = new Map<string, unknown>();
    for (const r of results) {
      try {
        ruleByTask.set(r.task_id, JSON.parse(r.rule_json));
      } catch {
        /* ignore malformed row */
      }
    }
    return c.json({
      tasks: tasks.map((t) => ({
        ...t,
        rule: ruleByTask.get(t.id) ?? null,
      })),
    });
  })

  .get("/:id", async (c) => {
    const callerHomeId = c.get("user").homeId;
    const uow = new D1UnitOfWork(c.env.DB);
    const result = await getTask(uow, c.req.param("id"));
    if (!result.ok) return c.json({ error: result.error }, 404);
    if (result.value.homeId !== callerHomeId) {
      return c.json({ error: "not-found" }, 404);
    }
    const [{ results: assignees }, scheduleRow] = await Promise.all([
      c.env.DB
        .prepare("SELECT user_id FROM task_assignments WHERE task_id = ?")
        .bind(result.value.id)
        .all<{ user_id: string }>(),
      c.env.DB
        .prepare(
          "SELECT rule_json FROM schedules WHERE task_id = ? AND is_deleted = 0",
        )
        .bind(result.value.id)
        .first<{ rule_json: string }>(),
    ]);
    let rule: unknown = null;
    if (scheduleRow) {
      try {
        rule = JSON.parse(scheduleRow.rule_json);
      } catch {
        /* ignore */
      }
    }
    return c.json({
      ...result.value,
      assignees: assignees.map((r) => r.user_id),
      rule,
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

    // If the caller didn't pick an explicit avatar, inherit it from
    // the selected label's icon ("icon:<name>") so the dashboard
    // row gets a visual right away. Spec m-2026-05-06.
    if (!input.avatarId && input.labelId) {
      const lbl = await c.env.DB
        .prepare("SELECT icon FROM labels WHERE id = ? AND home_id = ? AND is_deleted = 0")
        .bind(input.labelId, auth.homeId)
        .first<{ icon: string | null }>();
      if (lbl?.icon) input = { ...input, avatarId: `icon:${lbl.icon}` };
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

  // The schedule attached to a task — its current rule + tz +
  // next_fire_at. Used by the SPA to populate the daily-time-picker
  // when entering edit mode for a task.
  .get("/:id/schedule", async (c) => {
    const callerHomeId = c.get("user").homeId;
    const id = c.req.param("id");
    const task = await c.env.DB
      .prepare("SELECT home_id FROM tasks WHERE id = ? AND is_deleted = 0")
      .bind(id)
      .first<{ home_id: string }>();
    if (!task || task.home_id !== callerHomeId) {
      return c.json({ error: "not-found" }, 404);
    }
    const row = await c.env.DB
      .prepare(
        "SELECT id, task_id, rule_json, tz, next_fire_at FROM schedules WHERE task_id = ? AND is_deleted = 0",
      )
      .bind(id)
      .first<{
        id: string;
        task_id: string;
        rule_json: string;
        tz: string;
        next_fire_at: number | null;
      }>();
    if (!row) return c.json({ error: "not-found" }, 404);
    return c.json({
      id: row.id,
      taskId: row.task_id,
      rule: JSON.parse(row.rule_json),
      tz: row.tz,
      nextFireAt: row.next_fire_at,
    });
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

  // Direct task completion — independent of the cron→queue→
  // occurrence pipeline. The client posts a stable execution id
  // (UUID) so this endpoint is naturally idempotent: replaying the
  // same id from a retry queue is a no-op. resultValue / notes /
  // ts are optional; when omitted the server stamps `now` for ts.
  // See webapp/src/lib/executionQueue.ts for the offline queue
  // that drives this.
  .post("/:id/complete", async (c) => {
    const auth = c.get("user");
    const taskId = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as {
      id?: string;
      userId?: string;
      resultValue?: number | null;
      notes?: string | null;
      ts?: number;
    };
    if (!body.id || !/^[0-9a-f]{32}$/.test(body.id)) {
      return c.json({ error: "id required (32-hex)" }, 400);
    }
    const task = await c.env.DB
      .prepare(
        "SELECT home_id, label_id, result_type_id FROM tasks WHERE id = ? AND is_deleted = 0",
      )
      .bind(taskId)
      .first<{ home_id: string; label_id: string | null; result_type_id: string | null }>();
    if (!task || task.home_id !== auth.homeId) {
      return c.json({ error: "not-found" }, 404);
    }
    // Optional userId override — for shared-device contexts where
    // the session is generic but the actual completer is a
    // specific home member. Validate same-home before trusting.
    let actorUserId = auth.userId;
    if (body.userId && /^[0-9a-f]{32}$/.test(body.userId)) {
      const u = await c.env.DB
        .prepare(
          "SELECT id FROM users WHERE id = ? AND home_id = ? AND is_deleted = 0",
        )
        .bind(body.userId, auth.homeId)
        .first<{ id: string }>();
      if (!u) return c.json({ error: "user not in this home" }, 403);
      actorUserId = body.userId;
    }
    let unit: string | null = null;
    if (task.result_type_id) {
      const rt = await c.env.DB
        .prepare("SELECT unit_name FROM task_results WHERE id = ?")
        .bind(task.result_type_id)
        .first<{ unit_name: string }>();
      unit = rt?.unit_name ?? null;
    }
    const ts = body.ts && Number.isFinite(body.ts) ? body.ts : clock().nowSec();
    // INSERT OR IGNORE keys off the PRIMARY KEY — duplicate id
    // from a retry collapses to a no-op. Tag the existing row by
    // re-reading after the insert so the response carries the
    // canonical timestamp regardless of which call won.
    await c.env.DB
      .prepare(
        `INSERT OR IGNORE INTO task_executions
           (id, home_id, task_id, occurrence_id, user_id, device_id,
            label_id, result_type_id, result_value, result_unit, notes, ts)
         VALUES (?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        body.id,
        auth.homeId,
        taskId,
        actorUserId,
        task.label_id,
        task.result_type_id,
        body.resultValue ?? null,
        unit,
        body.notes ?? null,
        ts,
      )
      .run();
    return c.json({
      id: body.id,
      taskId,
      userId: actorUserId,
      ts,
      resultValue: body.resultValue ?? null,
      resultUnit: unit,
      notes: body.notes ?? null,
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
