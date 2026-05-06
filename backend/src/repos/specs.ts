import type { ISpecification } from "./interfaces.ts";
import type { Task } from "../domain/task.ts";
import type { Schedule } from "../domain/schedule.ts";
import type { Occurrence } from "../domain/occurrence.ts";
import type { TaskId, UserId } from "../domain/ids.ts";

// Specs are small, named, typed. They are NOT a generic query DSL —
// each tag has a single intent the repository understands.

export const ownedBy = (userId: UserId): ISpecification<Task> => ({
  tag: "OwnedBy",
  params: { userId },
});

export const pendingForUser = (
  userId: UserId,
  limit = 50,
): ISpecification<Occurrence> => ({
  tag: "PendingForUser",
  params: { userId, limit },
});

export const occurrencesForTask = (
  taskId: TaskId,
): ISpecification<Occurrence> => ({
  tag: "ForTask",
  params: { taskId },
});

export const dueBefore = (
  cutoff: number,
  limit = 100,
): ISpecification<Schedule> => ({
  tag: "DueBefore",
  params: { cutoff, limit },
});

export const schedulesForTask = (
  taskId: TaskId,
): ISpecification<Schedule> => ({
  tag: "ForTask",
  params: { taskId },
});
