import type { IUnitOfWork } from "../repos/interfaces.ts";
import { ownedBy } from "../repos/specs.ts";
import { asTaskId, asUserId, newUuid, type UserId } from "../domain/ids.ts";
import type { Task } from "../domain/task.ts";
import type { CreateTaskInput, TaskDto } from "../shared/schemas.ts";
import { type Result, ok, err } from "../result.ts";

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

export const createTask = async (
  uow: IUnitOfWork,
  userId: string,
  input: CreateTaskInput,
): Promise<TaskDto> =>
  uow.run(async (tx) => {
    const now = Date.now();
    const task: Task = {
      id: asTaskId(newUuid()),
      userId: asUserId(userId),
      title: input.title,
      description: input.description ?? null,
      priority: input.priority as Task["priority"],
      kind: input.kind,
      deadlineHint: input.deadlineHint ?? null,
      avatarId: null,
      active: true,
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
    };
    await tx.tasks.add(task);
    return toDto(task);
  });
