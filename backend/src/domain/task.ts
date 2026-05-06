import type { TaskId, UserId } from "./ids.ts";

export type TaskKind = "DAILY" | "PERIODIC" | "ONESHOT";

export interface Task {
  id: TaskId;
  userId: UserId;
  title: string;
  description: string | null;
  priority: 0 | 1 | 2 | 3;
  kind: TaskKind;
  deadlineHint: number | null;
  avatarId: string | null;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  isDeleted: boolean;
}
