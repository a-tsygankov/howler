import type {
  HomeId,
  LabelId,
  TaskId,
  TaskResultId,
  UserId,
} from "./ids.ts";

export type TaskKind = "DAILY" | "PERIODIC" | "ONESHOT";

export interface Task {
  id: TaskId;
  homeId: HomeId;
  creatorUserId: UserId | null;
  title: string;
  description: string | null;
  priority: 0 | 1 | 2 | 3;
  kind: TaskKind;
  deadlineHint: number | null;
  avatarId: string | null;
  labelId: LabelId | null;
  resultTypeId: TaskResultId | null;
  isPrivate: boolean;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  isDeleted: boolean;
}
