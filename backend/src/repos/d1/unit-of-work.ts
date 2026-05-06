import type {
  IUnitOfWork,
  IRepository,
} from "../interfaces.ts";
import type { Task } from "../../domain/task.ts";
import type { Schedule } from "../../domain/schedule.ts";
import type { Occurrence } from "../../domain/occurrence.ts";
import type {
  TaskId,
  ScheduleId,
  OccurrenceId,
} from "../../domain/ids.ts";
import { D1TaskRepository } from "./task-repo.ts";
import { D1ScheduleRepository } from "./schedule-repo.ts";
import { D1OccurrenceRepository } from "./occurrence-repo.ts";

// Plan §9.2 — UoW lifetime = one fetch / scheduled / queue invocation.
// Reads are issued immediately; writes are deferred and flushed in
// one db.batch([...]) on commit. No transactions across requests.
export class D1UnitOfWork implements IUnitOfWork {
  private pending: D1PreparedStatement[] = [];
  readonly tasks: IRepository<Task, TaskId>;
  readonly schedules: IRepository<Schedule, ScheduleId>;
  readonly occurrences: IRepository<Occurrence, OccurrenceId>;

  constructor(private readonly d1: D1Database) {
    this.tasks = new D1TaskRepository(d1, this);
    this.schedules = new D1ScheduleRepository(d1, this);
    this.occurrences = new D1OccurrenceRepository(d1, this);
  }

  async run<T>(fn: (uow: IUnitOfWork) => Promise<T>): Promise<T> {
    try {
      const result = await fn(this);
      if (this.pending.length > 0) {
        await this.d1.batch(this.pending);
        this.pending = [];
      }
      return result;
    } catch (e) {
      this.pending = [];
      throw e;
    }
  }

  /** Repos call this to enqueue writes. Domain code does not. */
  enqueue(stmt: D1PreparedStatement): void {
    this.pending.push(stmt);
  }
}
