import { Hono } from "hono";
import type { Bindings } from "../env.ts";
import { clock } from "../clock.ts";
import { computeUrgency, type UrgencyResult } from "../services/urgency.ts";
import { requireAuth, requireUser, type AuthVars } from "../middleware/auth.ts";
import type { ScheduleRule } from "../shared/schemas.ts";

// Unified dashboard endpoint. Every client (web, dial, future
// native) hits this and renders urgent/non-urgent groups directly
// from its response — no cron- or queue-derived occurrences in the
// loop, no per-client duplication of the urgency rule. Polled by
// open dashboards every few minutes and re-fetched on any task /
// schedule mutation.
//
// The wire shape carries the *server's* `now` so clients can show
// "in 14 m" without their own clocks influencing what's urgent.

interface TaskRow {
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

interface ScheduleRow {
  task_id: string;
  rule_json: string;
  updated_at: number;
}

interface ExecutionRow {
  task_id: string;
  ts: number;
}

const taskDto = (t: TaskRow) => ({
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

export const dashboardRouter = new Hono<{
  Bindings: Bindings;
  Variables: AuthVars;
}>()
  .use("*", requireAuth(), requireUser())

  .get("/", async (c) => {
    const homeId = c.get("user").homeId;
    const nowSec = clock().nowSec();

    const { results: tasks } = await c.env.DB
      .prepare(
        `SELECT id, home_id, creator_user_id, title, description, priority,
           kind, deadline_hint, avatar_id, label_id, result_type_id,
           is_private, active, created_at, updated_at
         FROM tasks
         WHERE home_id = ? AND is_deleted = 0 AND active = 1`,
      )
      .bind(homeId)
      .all<TaskRow>();

    if (tasks.length === 0) return c.json({ now: nowSec, tasks: [] });

    const taskIds = tasks.map((t) => t.id);
    const placeholders = taskIds.map(() => "?").join(",");

    // Pull schedules + most-recent execution per task in two batched
    // queries so we don't fan out N+1 reads as the home grows.
    const [{ results: scheduleRows }, { results: executionRows }] =
      await Promise.all([
        c.env.DB
          .prepare(
            `SELECT task_id, rule_json, updated_at FROM schedules
             WHERE task_id IN (${placeholders}) AND is_deleted = 0`,
          )
          .bind(...taskIds)
          .all<ScheduleRow>(),
        c.env.DB
          .prepare(
            `SELECT task_id, MAX(ts) AS ts FROM task_executions
             WHERE task_id IN (${placeholders})
             GROUP BY task_id`,
          )
          .bind(...taskIds)
          .all<ExecutionRow>(),
      ]);

    const scheduleByTask = new Map<
      string,
      { rule: ScheduleRule; modifiedAt: number }
    >();
    for (const s of scheduleRows) {
      try {
        scheduleByTask.set(s.task_id, {
          rule: JSON.parse(s.rule_json) as ScheduleRule,
          // schedules.updated_at is stored in ms (matches the rest
          // of tasks/schedules) but the urgency calc works in
          // seconds (matches now, deadline_hint, task_executions.ts).
          modifiedAt: Math.floor(s.updated_at / 1000),
        });
      } catch {
        /* ignore malformed row */
      }
    }
    const lastExecutionByTask = new Map<string, number>();
    for (const e of executionRows) lastExecutionByTask.set(e.task_id, e.ts);

    type Item = {
      task: ReturnType<typeof taskDto>;
      rule: ScheduleRule | null;
      urgency: UrgencyResult;
    };
    const items: Item[] = [];
    for (const t of tasks) {
      const sched = scheduleByTask.get(t.id);
      if (!sched) continue; // task without a live schedule — can't classify
      const urg = computeUrgency({
        rule: sched.rule,
        scheduleModifiedAt: sched.modifiedAt,
        oneshotDeadline: sched.rule.kind === "ONESHOT" ? t.deadline_hint : null,
        lastExecutionAt: lastExecutionByTask.get(t.id) ?? null,
        nowSec,
      });
      if (urg.urgency === "HIDDEN") continue;
      items.push({ task: taskDto(t), rule: sched.rule, urgency: urg });
    }

    // Sort URGENT before NON_URGENT, then by next-deadline ascending
    // (ONESHOT past-deadline have nextDeadline = null — sort those
    // first within their tier so the "missed" rows surface).
    items.sort((a, b) => {
      const tierA = a.urgency.urgency === "URGENT" ? 0 : 1;
      const tierB = b.urgency.urgency === "URGENT" ? 0 : 1;
      if (tierA !== tierB) return tierA - tierB;
      const ad = a.urgency.nextDeadline ?? -1;
      const bd = b.urgency.nextDeadline ?? -1;
      return ad - bd;
    });

    return c.json({
      now: nowSec,
      tasks: items.map((it) => ({
        task: it.task,
        rule: it.rule,
        urgency: it.urgency.urgency,
        prevDeadline: it.urgency.prevDeadline,
        nextDeadline: it.urgency.nextDeadline,
        periodSec: it.urgency.periodSec,
        isMissed: it.urgency.isMissed,
        secondsUntilNext: it.urgency.secondsUntilNext,
      })),
    });
  });
