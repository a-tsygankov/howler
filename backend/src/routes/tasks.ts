import { clock } from "../clock.ts";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../env.ts";
import { D1UnitOfWork } from "../repos/d1/unit-of-work.ts";
import { CreateTaskSchema, UpdateTaskSchema } from "../shared/schemas.ts";
import {
  createTask,
  getTask,
  updateTask,
} from "../services/task-service.ts";
import { asTaskId } from "../domain/ids.ts";
import { markDeviceAlive, requireAuth, requireUser, type AuthVars } from "../middleware/auth.ts";
import {
  isTaskAccessible,
  principalCanAccessTask,
  resolvePrincipal,
  visibleTasksPredicate,
} from "../services/visibility.ts";

interface TaskListRow {
  id: string;
  home_id: string;
  creator_user_id: string | null;
  title: string;
  description: string | null;
  priority: number;
  kind: "DAILY" | "PERIODIC" | "ONESHOT";
  deadline_hint: number | null;
  avatar_id: string | null;
  label_id: string | null;
  result_type_id: string | null;
  is_private: number;
  active: number;
  created_at: number;
  updated_at: number;
}

const listRowToDto = (t: TaskListRow) => ({
  id: t.id,
  homeId: t.home_id,
  creatorUserId: t.creator_user_id,
  title: t.title,
  description: t.description,
  priority: t.priority,
  kind: t.kind,
  deadlineHint: t.deadline_hint,
  avatarId: t.avatar_id,
  labelId: t.label_id,
  resultTypeId: t.result_type_id,
  isPrivate: t.is_private === 1,
  active: t.active === 1,
  createdAt: t.created_at,
  updatedAt: t.updated_at,
});

// A task is in exactly one assignment mode: user-targeted (private)
// or device-targeted (shared). `assignees` + `assignedDevices` carry
// the two target sets; at most one may be non-empty.
type TargetError = "assign-users-xor-devices" | "user-not-in-home" | "device-not-in-home";

const idsInHome = async (
  db: D1Database,
  table: "users" | "devices",
  homeId: string,
  ids: string[],
): Promise<Set<string>> => {
  if (ids.length === 0) return new Set();
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT id FROM ${table} WHERE home_id = ? AND is_deleted = 0
       AND id IN (${placeholders})`,
    )
    .bind(homeId, ...ids)
    .all<{ id: string }>();
  return new Set(results.map((r) => r.id));
};

// Validate the requested target sets against the home + the XOR rule.
// Returns a typed error string (→ 400) or null when valid.
const validateTargets = async (
  db: D1Database,
  homeId: string,
  userIds: string[],
  deviceIds: string[],
): Promise<TargetError | null> => {
  if (userIds.length > 0 && deviceIds.length > 0) {
    return "assign-users-xor-devices";
  }
  if (userIds.length > 0) {
    const valid = await idsInHome(db, "users", homeId, userIds);
    if (userIds.some((u) => !valid.has(u))) return "user-not-in-home";
  }
  if (deviceIds.length > 0) {
    const valid = await idsInHome(db, "devices", homeId, deviceIds);
    if (deviceIds.some((d) => !valid.has(d))) return "device-not-in-home";
  }
  return null;
};

// Replace BOTH target sets for a task and keep `tasks.is_private` in
// sync (1 iff the task has user assignees, else 0). Assumes the sets
// have already passed validateTargets(). The is_private UPDATE also
// bumps the home update_counter via the 0012 tasks trigger; the join
// writes bump via the 0012/0017 assignment triggers.
const writeTargets = async (
  db: D1Database,
  taskId: string,
  userIds: string[],
  deviceIds: string[],
  nowSec: number,
): Promise<void> => {
  const ops: D1PreparedStatement[] = [
    db.prepare("DELETE FROM task_assignments WHERE task_id = ?").bind(taskId),
    db.prepare("DELETE FROM task_device_assignments WHERE task_id = ?").bind(taskId),
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
  for (const deviceId of deviceIds) {
    ops.push(
      db
        .prepare(
          "INSERT INTO task_device_assignments (task_id, device_id, created_at) VALUES (?, ?, ?)",
        )
        .bind(taskId, deviceId, nowSec),
    );
  }
  ops.push(
    db
      .prepare("UPDATE tasks SET is_private = ?, updated_at = ? WHERE id = ?")
      .bind(userIds.length > 0 ? 1 : 0, nowSec, taskId),
  );
  await db.batch(ops);
};

export const tasksRouter = new Hono<{
  Bindings: Bindings;
  Variables: AuthVars;
}>()
  // Loose auth so device tokens can hit the
  // /:id/complete direct-completion path used by the firmware
  // mark-done flow when no live occurrence exists. Every other
  // handler re-arms requireUser() because the device shouldn't be
  // creating, editing, or deleting tasks. Same shape dashboard.ts
  // and occurrences.ts already use.
  .use("*", requireAuth(), markDeviceAlive())

  .get("/", requireUser(), async (c) => {
    const homeId = c.get("user").homeId;
    // Visibility-filtered list: a user sees shared + their-own +
    // (if admin) all. Same predicate the dashboard uses.
    const principal = await resolvePrincipal(c.env.DB, c.get("auth"));
    const pred = visibleTasksPredicate(principal, "tasks");
    const { results: rows } = await c.env.DB
      .prepare(
        `SELECT id, home_id, creator_user_id, title, description, priority, kind,
           deadline_hint, avatar_id, label_id, result_type_id, is_private, active,
           created_at, updated_at
         FROM tasks
         WHERE home_id = ? AND is_deleted = 0 AND ${pred.sql}`,
      )
      .bind(homeId, ...pred.binds)
      .all<TaskListRow>();
    const tasks = rows.map(listRowToDto);
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

  .get("/:id", requireUser(), async (c) => {
    const callerHomeId = c.get("user").homeId;
    const uow = new D1UnitOfWork(c.env.DB);
    const result = await getTask(uow, c.req.param("id"));
    if (!result.ok) return c.json({ error: result.error }, 404);
    if (result.value.homeId !== callerHomeId) {
      return c.json({ error: "not-found" }, 404);
    }
    const [{ results: assignees }, { results: deviceAssignees }, scheduleRow] =
      await Promise.all([
        c.env.DB
          .prepare("SELECT user_id FROM task_assignments WHERE task_id = ?")
          .bind(result.value.id)
          .all<{ user_id: string }>(),
        c.env.DB
          .prepare("SELECT device_id FROM task_device_assignments WHERE task_id = ?")
          .bind(result.value.id)
          .all<{ device_id: string }>(),
        c.env.DB
          .prepare(
            "SELECT rule_json FROM schedules WHERE task_id = ? AND is_deleted = 0",
          )
          .bind(result.value.id)
          .first<{ rule_json: string }>(),
      ]);
    // Visibility: a private task is readable only by its assignees,
    // creator, or an admin. Computed from the assignee set we just
    // fetched — no extra round-trip.
    const principal = await resolvePrincipal(c.env.DB, c.get("auth"));
    if (
      !principalCanAccessTask(principal, {
        creatorUserId: result.value.creatorUserId,
        userAssigneeIds: assignees.map((r) => r.user_id),
      })
    ) {
      return c.json({ error: "not-found" }, 404);
    }
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
      assignedDevices: deviceAssignees.map((r) => r.device_id),
      rule,
    });
  })

  .post("/", requireUser(), zValidator("json", CreateTaskSchema), async (c) => {
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
    // the selected label so the dashboard row gets a visual right
    // away. Migration 0015 unified labels onto avatar_id (preferred
    // path); fall back to the legacy `icon` column for labels that
    // haven't been re-saved since the migration. Both formats end
    // up as the unified `icon:<name>` / UUID shape on the task.
    if (!input.avatarId && input.labelId) {
      const lbl = await c.env.DB
        .prepare("SELECT avatar_id, icon FROM labels WHERE id = ? AND home_id = ? AND is_deleted = 0")
        .bind(input.labelId, auth.homeId)
        .first<{ avatar_id: string | null; icon: string | null }>();
      const inherited = lbl?.avatar_id ?? (lbl?.icon ? `icon:${lbl.icon}` : null);
      if (inherited) input = { ...input, avatarId: inherited };
    }

    const userIds = input.assignees ?? [];
    const deviceIds = input.assignedDevices ?? [];
    const targetErr = await validateTargets(c.env.DB, auth.homeId, userIds, deviceIds);
    if (targetErr) return c.json({ error: targetErr }, 400);

    const { dto, taskId } = await createTask(
      uow,
      { homeId: auth.homeId, creatorUserId: auth.userId, homeTz },
      input,
    );
    if (userIds.length > 0 || deviceIds.length > 0) {
      await writeTargets(c.env.DB, taskId, userIds, deviceIds, clock().nowSec());
    }
    return c.json(dto, 201);
  })

  .patch("/:id", requireUser(), zValidator("json", UpdateTaskSchema), async (c) => {
    const auth = c.get("user");
    const id = c.req.param("id");
    const uow = new D1UnitOfWork(c.env.DB);
    const patch = c.req.valid("json");
    // Access gate. Cross-home stays a 403 (wrong-home, existing
    // contract); same-home-but-private is a 404 so a hidden task
    // can't be probed. Only the creator / an assignee / an admin may
    // edit a private task.
    const principal = await resolvePrincipal(c.env.DB, c.get("auth"));
    const homeRow = await c.env.DB
      .prepare("SELECT home_id FROM tasks WHERE id = ? AND is_deleted = 0")
      .bind(id)
      .first<{ home_id: string }>();
    if (!homeRow) return c.json({ error: "not-found" }, 404);
    if (homeRow.home_id !== auth.homeId) return c.json({ error: "wrong-home" }, 403);
    if (!(await isTaskAccessible(c.env.DB, id, principal))) {
      return c.json({ error: "not-found" }, 404);
    }
    const touchesTargets =
      patch.assignees !== undefined || patch.assignedDevices !== undefined;
    // Validate target sets BEFORE mutating the task so a bad request
    // doesn't leave a half-applied edit. Either array provided alone
    // is a full replace; the unprovided side defaults to empty.
    const userIds = patch.assignees ?? [];
    const deviceIds = patch.assignedDevices ?? [];
    if (touchesTargets) {
      const targetErr = await validateTargets(c.env.DB, auth.homeId, userIds, deviceIds);
      if (targetErr) return c.json({ error: targetErr }, 400);
    }
    const result = await updateTask(uow, id, auth.homeId, patch);
    if (!result.ok) {
      const status = result.error === "not-found" ? 404 : 403;
      return c.json({ error: result.error }, status);
    }
    if (touchesTargets) {
      await writeTargets(c.env.DB, id, userIds, deviceIds, clock().nowSec());
    }
    return c.json(result.value);
  })

  // The schedule attached to a task — its current rule + tz +
  // next_fire_at. Used by the SPA to populate the daily-time-picker
  // when entering edit mode for a task.
  .get("/:id/schedule", requireUser(), async (c) => {
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
  .get("/:id/executions", requireUser(), async (c) => {
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
    const principal = await resolvePrincipal(c.env.DB, c.get("auth"));
    if (!(await isTaskAccessible(c.env.DB, id, principal))) {
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
    // Accepts BOTH user and device tokens — the dial uses this
    // endpoint for tasks without a live occurrence (long-press or
    // a tap on an "open task" row that has no PENDING occurrence).
    // For user tokens, actorUserId defaults to the caller; for
    // device tokens, the body MUST carry a userId (picked via the
    // post-done UserPicker) or the row is recorded with userId =
    // NULL ("skip attribution"). device_id is set from the token
    // when present so the ack carries the originating dial.
    const auth = c.get("auth");
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
    // Visibility: only the creator / an assignee / an admin (user
    // tokens), or any dial for a shared task (device tokens), may
    // complete it. A private task is invisible — and uncompletable —
    // to everyone else. 404 keeps it unprobeable.
    const principal = await resolvePrincipal(c.env.DB, auth);
    if (!(await isTaskAccessible(c.env.DB, taskId, principal))) {
      return c.json({ error: "not-found" }, 404);
    }
    // Optional userId override — for shared-device contexts where
    // the session is generic but the actual completer is a
    // specific home member. Validate same-home before trusting.
    // Default for user tokens: the caller. Default for device
    // tokens: NULL (no attribution) — the device can override by
    // sending body.userId from the on-device UserPicker.
    let actorUserId: string | null =
      auth.type === "user" ? auth.userId : null;
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
    const ackedByDevice = auth.type === "device" ? auth.deviceId : null;
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
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        body.id,
        auth.homeId,
        taskId,
        actorUserId,
        ackedByDevice,
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

  .delete("/:id", requireUser(), async (c) => {
    const auth = c.get("user");
    const id = c.req.param("id");
    const uow = new D1UnitOfWork(c.env.DB);
    const result = await getTask(uow, id);
    if (!result.ok) return c.json({ error: result.error }, 404);
    if (result.value.homeId !== auth.homeId) {
      return c.json({ error: "not-found" }, 404);
    }
    const principal = await resolvePrincipal(c.env.DB, c.get("auth"));
    if (!(await isTaskAccessible(c.env.DB, id, principal))) {
      return c.json({ error: "not-found" }, 404);
    }
    await uow.run(async (tx) => {
      await tx.tasks.remove(asTaskId(result.value.id));
    });
    return c.body(null, 204);
  });
