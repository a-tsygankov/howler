import type {
  DeviceId,
  OccurrenceId,
  TaskExecutionId,
  TaskId,
  UserId,
} from "./ids.ts";

export type OccurrenceStatus = "PENDING" | "ACKED" | "SKIPPED" | "MISSED";

export interface Occurrence {
  id: OccurrenceId;
  taskId: TaskId;
  dueAt: number;
  firedAt: number | null;
  ackedAt: number | null;
  status: OccurrenceStatus;
  ackedByUserId: UserId | null;
  ackedByDeviceId: DeviceId | null;
  executionId: TaskExecutionId | null;
  idempotencyKey: string | null;
  createdAt: number;
  updatedAt: number;
  isDeleted: boolean;
}
