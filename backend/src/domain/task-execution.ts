import type {
  DeviceId,
  HomeId,
  LabelId,
  OccurrenceId,
  TaskExecutionId,
  TaskId,
  TaskResultId,
  UserId,
} from "./ids.ts";

/// Append-only — never UPDATEd. Plan §6.5.
export interface TaskExecution {
  id: TaskExecutionId;
  homeId: HomeId;
  taskId: TaskId;
  occurrenceId: OccurrenceId | null;
  userId: UserId | null;
  deviceId: DeviceId | null;
  labelId: LabelId | null; // denormalized snapshot
  resultTypeId: TaskResultId | null;
  resultValue: number | null;
  resultUnit: string | null; // denormalized snapshot
  notes: string | null;
  ts: number; // epoch seconds
}
