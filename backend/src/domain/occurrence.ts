import type { DeviceId, OccurrenceId, TaskId } from "./ids.ts";

export type OccurrenceStatus = "PENDING" | "ACKED" | "SKIPPED" | "MISSED";

export interface Occurrence {
  id: OccurrenceId;
  taskId: TaskId;
  dueAt: number;
  firedAt: number | null;
  ackedAt: number | null;
  status: OccurrenceStatus;
  ackedByDevice: DeviceId | null;
  idempotencyKey: string | null;
  createdAt: number;
  updatedAt: number;
  isDeleted: boolean;
}
