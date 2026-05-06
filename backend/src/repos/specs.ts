import type { ISpecification } from "./interfaces.ts";
import type { Task } from "../domain/task.ts";
import type { Schedule } from "../domain/schedule.ts";
import type { Occurrence } from "../domain/occurrence.ts";
import type { HomeId, TaskId } from "../domain/ids.ts";

export const ownedByHome = (homeId: HomeId): ISpecification<Task> => ({
  tag: "OwnedByHome",
  params: { homeId },
});

export const pendingForHome = (
  homeId: HomeId,
  limit = 50,
): ISpecification<Occurrence> => ({
  tag: "PendingForHome",
  params: { homeId, limit },
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
