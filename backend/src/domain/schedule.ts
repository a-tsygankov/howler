import type { ScheduleId, TaskId } from "./ids.ts";

// Plan §6 — rule_json shape varies by task kind. Zod schema in
// shared/schemas.ts is the source of truth at the wire boundary.
export type ScheduleRule =
  | { version: 1; kind: "DAILY"; times: string[] }
  | { version: 1; kind: "PERIODIC"; intervalDays: number }
  | { version: 1; kind: "ONESHOT"; intervalDays?: number };

export interface Schedule {
  id: ScheduleId;
  taskId: TaskId;
  templateId: string | null;
  rule: ScheduleRule;
  tz: string;
  nextFireAt: number | null;
  createdAt: number;
  updatedAt: number;
  /// Wall-clock ms of the last *user-driven* mutation to the rule.
  /// Bumped on creation and on rule edits; cron-driven `next_fire_at`
  /// advances LEAVE THIS ALONE. The dashboard's urgency calc
  /// (`backend/src/services/urgency.ts`) anchors its "rhythm reset"
  /// here so an actively-firing schedule doesn't keep racing the
  /// anchor forward and starving the urgent tier (see migration
  /// 0008_rule_modified_at.sql).
  ruleModifiedAt: number;
  isDeleted: boolean;
}
