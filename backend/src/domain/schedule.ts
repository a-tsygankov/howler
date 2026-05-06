import type { ScheduleId, TaskId } from "./ids.ts";

// Plan §6 — rule_json shape varies by task kind. Zod schema in
// shared/schemas.ts is the source of truth at the wire boundary.
export type ScheduleRule =
  | { version: 1; kind: "DAILY"; times: string[] }
  | { version: 1; kind: "PERIODIC"; intervalDays: number }
  | { version: 1; kind: "ONESHOT" };

export interface Schedule {
  id: ScheduleId;
  taskId: TaskId;
  templateId: string | null;
  rule: ScheduleRule;
  tz: string;
  nextFireAt: number | null;
  createdAt: number;
  updatedAt: number;
  isDeleted: boolean;
}
