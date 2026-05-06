import type { IUnitOfWork } from "../repos/interfaces.ts";
import { ownedBy } from "../repos/specs.ts";
import {
  asTaskId,
  asUserId,
  asScheduleId,
  newUuid,
  type UserId,
} from "../domain/ids.ts";
import type { Task } from "../domain/task.ts";
import type { Schedule, ScheduleRule } from "../domain/schedule.ts";
import type { CreateTaskInput, TaskDto, UpdateTaskInput } from "../shared/schemas.ts";
import { type Result, ok, err } from "../result.ts";
import { computeNextFireAt } from "./firing.ts";

const toDto = (t: Task): TaskDto => ({
  id: t.id,
  userId: t.userId,
  title: t.title,
  description: t.description,
  priority: t.priority,
  kind: t.kind,
  deadlineHint: t.deadlineHint,
  avatarId: t.avatarId,
  active: t.active,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

export const listTasks = async (
  uow: IUnitOfWork,
  userId: UserId,
): Promise<TaskDto[]> => {
  const tasks = await uow.tasks.findMany(ownedBy(userId));
  return tasks.map(toDto);
};

export const getTask = async (
  uow: IUnitOfWork,
  id: string,
): Promise<Result<TaskDto, "not-found">> => {
  const t = await uow.tasks.findById(asTaskId(id));
  return t ? ok(toDto(t)) : err("not-found");
};

export type UpdateTaskError = "not-found" | "wrong-user";

export const updateTask = async (
  uow: IUnitOfWork,
  id: string,
  callerUserId: string,
  patch: UpdateTaskInput,
): Promise<Result<TaskDto, UpdateTaskError>> =>
  uow.run(async (tx) => {
    const t = await tx.tasks.findById(asTaskId(id));
    if (!t) return err("not-found");
    if (t.userId !== callerUserId) return err("wrong-user");
    const next: Task = {
      ...t,
      title: patch.title ?? t.title,
      description: patch.description === undefined ? t.description : patch.description,
      priority: (patch.priority as Task["priority"]) ?? t.priority,
      active: patch.active ?? t.active,
      updatedAt: Date.now(),
    };
    await tx.tasks.update(next);
    return ok(toDto(next));
  });

const ruleFor = (input: CreateTaskInput): ScheduleRule => {
  switch (input.kind) {
    case "DAILY":
      return {
        version: 1,
        kind: "DAILY",
        times: input.times ?? ["09:00"],
      };
    case "PERIODIC":
      return {
        version: 1,
        kind: "PERIODIC",
        intervalDays: input.intervalDays ?? 7,
      };
    case "ONESHOT":
      return { version: 1, kind: "ONESHOT" };
  }
};

export const createTask = async (
  uow: IUnitOfWork,
  userId: string,
  input: CreateTaskInput,
): Promise<TaskDto> =>
  uow.run(async (tx) => {
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const taskId = asTaskId(newUuid());
    const task: Task = {
      id: taskId,
      userId: asUserId(userId),
      title: input.title,
      description: input.description ?? null,
      priority: input.priority as Task["priority"],
      kind: input.kind,
      deadlineHint: input.deadlineHint ?? null,
      avatarId: null,
      active: true,
      createdAt: nowMs,
      updatedAt: nowMs,
      isDeleted: false,
    };
    const rule = ruleFor(input);
    const nextFireAt = computeNextFireAt(rule, nowSec, input.deadlineHint ?? null);
    const schedule: Schedule = {
      id: asScheduleId(newUuid()),
      taskId,
      templateId: null,
      rule,
      tz: input.tz,
      nextFireAt,
      createdAt: nowMs,
      updatedAt: nowMs,
      isDeleted: false,
    };
    await tx.tasks.add(task);
    await tx.schedules.add(schedule);
    return toDto(task);
  });
