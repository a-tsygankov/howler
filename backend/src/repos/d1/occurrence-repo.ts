import type { IRepository, ISpecification } from "../interfaces.ts";
import type { Occurrence } from "../../domain/occurrence.ts";
import type { OccurrenceId } from "../../domain/ids.ts";
import type { D1UnitOfWork } from "./unit-of-work.ts";

// Phase 0 stub. Filled in Phase 1 with /occurrences/:id/ack and the
// Cron+Queue fan-out path.
export class D1OccurrenceRepository
  implements IRepository<Occurrence, OccurrenceId>
{
  constructor(
    private readonly _d1: D1Database,
    private readonly _uow: D1UnitOfWork,
  ) {}
  findById(_id: OccurrenceId): Promise<Occurrence | null> {
    return Promise.reject(new Error("D1OccurrenceRepository: not implemented"));
  }
  findMany(_spec: ISpecification<Occurrence>): Promise<Occurrence[]> {
    return Promise.reject(new Error("D1OccurrenceRepository: not implemented"));
  }
  add(_o: Occurrence): Promise<void> {
    return Promise.reject(new Error("D1OccurrenceRepository: not implemented"));
  }
  update(_o: Occurrence): Promise<void> {
    return Promise.reject(new Error("D1OccurrenceRepository: not implemented"));
  }
  remove(_id: OccurrenceId): Promise<void> {
    return Promise.reject(new Error("D1OccurrenceRepository: not implemented"));
  }
}
