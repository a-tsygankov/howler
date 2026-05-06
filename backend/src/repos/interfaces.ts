import type { Task } from "../domain/task.ts";
import type { Schedule } from "../domain/schedule.ts";
import type { Occurrence } from "../domain/occurrence.ts";
import type {
  DeviceId,
  OccurrenceId,
  ScheduleId,
  TaskId,
  UserId,
} from "../domain/ids.ts";

// Plan §9.1 — transport-free predicate. Repositories know how to
// translate well-known specs into their backend; unknown tags throw.
export interface ISpecification<_TEntity> {
  readonly tag: string;
  readonly params: Record<string, unknown>;
}

export interface IRepository<TEntity, TId> {
  findById(id: TId): Promise<TEntity | null>;
  findMany(spec: ISpecification<TEntity>): Promise<TEntity[]>;
  add(entity: TEntity): Promise<void>;
  update(entity: TEntity): Promise<void>;
  remove(id: TId): Promise<void>;
}

export interface IUnitOfWork {
  readonly tasks: IRepository<Task, TaskId>;
  readonly schedules: IRepository<Schedule, ScheduleId>;
  readonly occurrences: IRepository<Occurrence, OccurrenceId>;

  /** Atomic span. Pending writes flush as one D1 batch on success. */
  run<T>(fn: (uow: IUnitOfWork) => Promise<T>): Promise<T>;
}

// Re-exported for convenience — services import only from this file.
export type { Task, Schedule, Occurrence };
export type { TaskId, ScheduleId, OccurrenceId, UserId, DeviceId };
