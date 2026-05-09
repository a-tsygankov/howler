import { Hono } from "hono";
import type { Bindings } from "../env.ts";
import { clock } from "../clock.ts";
import { computeUrgency, type UrgencyResult } from "../services/urgency.ts";
import { markDeviceAlive, requireAuth, type AuthVars } from "../middleware/auth.ts";
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
  rule_modified_at: number | null;
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
  // Accept BOTH user and device tokens. The device firmware needs
  // the dashboard to render the on-screen task list — gating this
  // behind requireUser() left the dial showing empty even when its
  // device token was valid for the home. The auth info already
  // carries homeId for both shapes; we read that directly instead
  // of the narrowed `user` view. `markDeviceAlive` records that
  // the dial reached the server so the webapp Settings page can
  // show "last sync N min ago" without an extra heartbeat endpoint.
  .use("*", requireAuth(), markDeviceAlive())

  .get("/", async (c) => {
    const homeId = c.get("auth").homeId;
    const nowSec = clock().nowSec();
    // `?include=hidden` returns HIDDEN-tier rows too. The on-device
    // "All tasks" screen needs every active task, not just the urgent
    // tier the home screen shows. Default behaviour (filter HIDDEN)
    // is unchanged so the webapp's home page stays a focused list.
    const includeHidden = c.req.query("include") === "hidden";

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

    // Pull schedules + most-recent execution + every label icon
    // referenced by these tasks in three batched queries so the
    // home stays N+1-free. Labels lookup feeds the avatar fallback
    // for tasks that have a label but null avatar_id.
    const labelIds = [
      ...new Set(tasks.map((t) => t.label_id).filter((x): x is string => !!x)),
    ];
    const [
      { results: scheduleRows },
      { results: executionRows },
      labelIconRows,
    ] = await Promise.all([
      c.env.DB
        .prepare(
          `SELECT task_id, rule_json, updated_at, rule_modified_at
           FROM schedules
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
      labelIds.length === 0
        ? Promise.resolve({ results: [] as Array<{ id: string; icon: string | null }> })
        : c.env.DB
            .prepare(
              `SELECT id, icon FROM labels
               WHERE id IN (${labelIds.map(() => "?").join(",")})
                 AND is_deleted = 0`,
            )
            .bind(...labelIds)
            .all<{ id: string; icon: string | null }>(),
    ]);
    const labelIconById = new Map<string, string>();
    for (const l of labelIconRows.results) {
      if (l.icon) labelIconById.set(l.id, l.icon);
    }

    const scheduleByTask = new Map<
      string,
      { rule: ScheduleRule; modifiedAt: number }
    >();
    for (const s of scheduleRows) {
      try {
        // Anchor on rule_modified_at (added in migration 0008) — the
        // user-driven mutation timestamp. Pre-0008 rows have a 0 default
        // until the migration's UPDATE backfills them; if a deploy
        // races so the row appears with rule_modified_at=0/null we
        // fall back to updated_at so urgency still works (just with
        // the prior buggy semantics, not a crash).
        const ms =
          s.rule_modified_at && s.rule_modified_at > 0
            ? s.rule_modified_at
            : s.updated_at;
        scheduleByTask.set(s.task_id, {
          rule: JSON.parse(s.rule_json) as ScheduleRule,
          // Stored in ms; urgency calc works in seconds (matches now,
          // deadline_hint, task_executions.ts).
          modifiedAt: Math.floor(ms / 1000),
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
      if (urg.urgency === "HIDDEN" && !includeHidden) continue;
      // Effective avatar: explicit avatar_id wins; otherwise fall
      // back to the label's icon under the "icon:" prefix so tasks
      // that just have a label still get an icon on the dashboard.
      const dto = taskDto(t);
      if (!dto.avatarId && t.label_id) {
        const ico = labelIconById.get(t.label_id);
        if (ico) dto.avatarId = `icon:${ico}`;
      }
      items.push({ task: dto, rule: sched.rule, urgency: urg });
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
      // Each row carries BOTH the server-computed urgency snapshot
      // (used by the webapp untouched) AND the raw inputs needed to
      // recompute urgency client-side: `scheduleModifiedAt`,
      // `oneshotDeadline` (= task.deadlineHint for ONESHOT, null
      // otherwise), and `lastExecutionAt`. The device firmware uses
      // the inputs to drive `domain::computeUrgency()` per frame so
      // "due in 14 m" labels stay accurate between sync rounds —
      // see slice B in docs/sync-analysis.md. Webapp clients can
      // ignore the new fields; they're additive.
      tasks: items.map((it) => {
        const sched = scheduleByTask.get(it.task.id);
        const oneshotDeadline =
          it.rule?.kind === "ONESHOT"
            ? (tasks.find((t) => t.id === it.task.id)?.deadline_hint ?? null)
            : null;
        return {
          task: it.task,
          rule: it.rule,
          urgency: it.urgency.urgency,
          prevDeadline: it.urgency.prevDeadline,
          nextDeadline: it.urgency.nextDeadline,
          periodSec: it.urgency.periodSec,
          isMissed: it.urgency.isMissed,
          secondsUntilNext: it.urgency.secondsUntilNext,
          // Local-urgency inputs (slice B).
          scheduleModifiedAt: sched?.modifiedAt ?? null,
          oneshotDeadline,
          lastExecutionAt: lastExecutionByTask.get(it.task.id) ?? null,
        };
      }),
    });
  });
