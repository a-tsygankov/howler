import { clock } from "../clock.ts";
import type { IUnitOfWork } from "../repos/interfaces.ts";
import { ownedByHome } from "../repos/specs.ts";
import {
  asHomeId,
  asLabelId,
  asScheduleId,
  asTaskId,
  asTaskResultId,
  asUserId,
  newUuid,
  type HomeId,
} from "../domain/ids.ts";
import type { Task } from "../domain/task.ts";
import type { Schedule, ScheduleRule } from "../domain/schedule.ts";
import type {
  CreateTaskInput,
  TaskDto,
  UpdateTaskInput,
} from "../shared/schemas.ts";
import { type Result, ok, err } from "../result.ts";
import { computeNextFireAt } from "./firing.ts";

const toDto = (t: Task): TaskDto => ({
  id: t.id,
  homeId: t.homeId,
  creatorUserId: t.creatorUserId,
  title: t.title,
  description: t.description,
  priority: t.priority,
  kind: t.kind,
  deadlineHint: t.deadlineHint,
  avatarId: t.avatarId,
  labelId: t.labelId,
  resultTypeId: t.resultTypeId,
  isPrivate: t.isPrivate,
  active: t.active,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

export const listTasks = async (
  uow: IUnitOfWork,
  homeId: HomeId,
): Promise<TaskDto[]> => {
  const tasks = await uow.tasks.findMany(ownedByHome(homeId));
  return tasks.map(toDto);
};

export const getTask = async (
  uow: IUnitOfWork,
  id: string,
): Promise<Result<TaskDto, "not-found">> => {
  const t = await uow.tasks.findById(asTaskId(id));
  return t ? ok(toDto(t)) : err("not-found");
};

const ruleFor = (input: CreateTaskInput): ScheduleRule => {
  switch (input.kind) {
    case "DAILY":
      return { version: 1, kind: "DAILY", times: input.times ?? ["09:00"] };
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

export interface CreateTaskOpts {
  homeId: string;
  creatorUserId: string;
  homeTz: string;
}

export interface CreateTaskResult {
  dto: TaskDto;
  taskId: string;
}

export const createTask = async (
  uow: IUnitOfWork,
  opts: CreateTaskOpts,
  input: CreateTaskInput,
): Promise<CreateTaskResult> =>
  uow.run(async (tx) => {
    const nowMs = clock().nowMs();
    const nowSec = Math.floor(nowMs / 1000);
    const taskId = asTaskId(newUuid());
    const task: Task = {
      id: taskId,
      homeId: asHomeId(opts.homeId),
      creatorUserId: asUserId(opts.creatorUserId),
      title: input.title,
      description: input.description ?? null,
      priority: input.priority as Task["priority"],
      kind: input.kind,
      deadlineHint: input.deadlineHint ?? null,
      avatarId: null,
      labelId: input.labelId ? asLabelId(input.labelId) : null,
      resultTypeId: input.resultTypeId ? asTaskResultId(input.resultTypeId) : null,
      isPrivate: input.isPrivate ?? false,
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
      tz: input.tz ?? opts.homeTz,
      nextFireAt,
      createdAt: nowMs,
      updatedAt: nowMs,
      isDeleted: false,
    };
    await tx.tasks.add(task);
    await tx.schedules.add(schedule);
    return { dto: toDto(task), taskId };
  });

export type UpdateTaskError = "not-found" | "wrong-home";

export const updateTask = async (
  uow: IUnitOfWork,
  id: string,
  callerHomeId: string,
  patch: UpdateTaskInput,
): Promise<Result<TaskDto, UpdateTaskError>> =>
  uow.run(async (tx) => {
    const t = await tx.tasks.findById(asTaskId(id));
    if (!t) return err("not-found");
    if (t.homeId !== callerHomeId) return err("wrong-home");
    const next: Task = {
      ...t,
      title: patch.title ?? t.title,
      description:
        patch.description === undefined ? t.description : patch.description,
      priority: (patch.priority as Task["priority"]) ?? t.priority,
      active: patch.active ?? t.active,
      labelId: patch.labelId === undefined
        ? t.labelId
        : patch.labelId === null
          ? null
          : asLabelId(patch.labelId),
      resultTypeId: patch.resultTypeId === undefined
        ? t.resultTypeId
        : patch.resultTypeId === null
          ? null
          : asTaskResultId(patch.resultTypeId),
      isPrivate: patch.isPrivate ?? t.isPrivate,
      updatedAt: clock().nowMs(),
    };
    await tx.tasks.update(next);
    return ok(toDto(next));
  });
