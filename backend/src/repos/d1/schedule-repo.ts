import type { IRepository, ISpecification } from "../interfaces.ts";
import type { Schedule } from "../../domain/schedule.ts";
import type { ScheduleId } from "../../domain/ids.ts";
import type { D1UnitOfWork } from "./unit-of-work.ts";

// Phase 0 stub. Filled in Phase 1 with the Cron fan-out service.
export class D1ScheduleRepository implements IRepository<Schedule, ScheduleId> {
  constructor(
    private readonly _d1: D1Database,
    private readonly _uow: D1UnitOfWork,
  ) {}
  findById(_id: ScheduleId): Promise<Schedule | null> {
    return Promise.reject(new Error("D1ScheduleRepository: not implemented"));
  }
  findMany(_spec: ISpecification<Schedule>): Promise<Schedule[]> {
    return Promise.reject(new Error("D1ScheduleRepository: not implemented"));
  }
  add(_s: Schedule): Promise<void> {
    return Promise.reject(new Error("D1ScheduleRepository: not implemented"));
  }
  update(_s: Schedule): Promise<void> {
    return Promise.reject(new Error("D1ScheduleRepository: not implemented"));
  }
  remove(_id: ScheduleId): Promise<void> {
    return Promise.reject(new Error("D1ScheduleRepository: not implemented"));
  }
}
