import type { IRepository, ISpecification } from "../interfaces.ts";
import type { Occurrence } from "../../domain/occurrence.ts";
import {
  asDeviceId,
  asOccurrenceId,
  asTaskExecutionId,
  asTaskId,
  asUserId,
  type OccurrenceId,
} from "../../domain/ids.ts";
import type { D1UnitOfWork } from "./unit-of-work.ts";

interface OccurrenceRow {
  id: string;
  task_id: string;
  due_at: number;
  fired_at: number | null;
  acked_at: number | null;
  status: "PENDING" | "ACKED" | "SKIPPED" | "MISSED";
  acked_by_user_id: string | null;
  acked_by_device_id: string | null;
  execution_id: string | null;
  idempotency_key: string | null;
  created_at: number;
  updated_at: number;
  is_deleted: number;
}

const rowToOccurrence = (r: OccurrenceRow): Occurrence => ({
  id: asOccurrenceId(r.id),
  taskId: asTaskId(r.task_id),
  dueAt: r.due_at,
  firedAt: r.fired_at,
  ackedAt: r.acked_at,
  status: r.status,
  ackedByUserId: r.acked_by_user_id ? asUserId(r.acked_by_user_id) : null,
  ackedByDeviceId: r.acked_by_device_id ? asDeviceId(r.acked_by_device_id) : null,
  executionId: r.execution_id ? asTaskExecutionId(r.execution_id) : null,
  idempotencyKey: r.idempotency_key,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  isDeleted: r.is_deleted === 1,
});

export class D1OccurrenceRepository
  implements IRepository<Occurrence, OccurrenceId>
{
  constructor(
    private readonly d1: D1Database,
    private readonly uow: D1UnitOfWork,
  ) {}

  async findById(id: OccurrenceId): Promise<Occurrence | null> {
    const row = await this.d1
      .prepare("SELECT * FROM occurrences WHERE id = ? AND is_deleted = 0")
      .bind(id)
      .first<OccurrenceRow>();
    return row ? rowToOccurrence(row) : null;
  }

  async findMany(spec: ISpecification<Occurrence>): Promise<Occurrence[]> {
    if (spec.tag === "PendingForHome") {
      const homeId = spec.params["homeId"] as string;
      const limit = (spec.params["limit"] as number | undefined) ?? 50;
      const { results } = await this.d1
        .prepare(
          `SELECT o.* FROM occurrences o
           JOIN tasks t ON t.id = o.task_id
           WHERE t.home_id = ? AND o.status = 'PENDING' AND o.is_deleted = 0
           ORDER BY o.due_at ASC LIMIT ?`,
        )
        .bind(homeId, limit)
        .all<OccurrenceRow>();
      return results.map(rowToOccurrence);
    }
    if (spec.tag === "ForTask") {
      const taskId = spec.params["taskId"] as string;
      const { results } = await this.d1
        .prepare(
          `SELECT * FROM occurrences WHERE task_id = ? AND is_deleted = 0
           ORDER BY due_at DESC LIMIT 100`,
        )
        .bind(taskId)
        .all<OccurrenceRow>();
      return results.map(rowToOccurrence);
    }
    throw new Error(`D1OccurrenceRepository: unknown spec tag ${spec.tag}`);
  }

  add(o: Occurrence): Promise<void> {
    this.uow.enqueue(
      this.d1
        .prepare(
          `INSERT OR IGNORE INTO occurrences
             (id, task_id, due_at, fired_at, acked_at, status,
              acked_by_user_id, acked_by_device_id, execution_id,
              idempotency_key, created_at, updated_at, is_deleted)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          o.id,
          o.taskId,
          o.dueAt,
          o.firedAt,
          o.ackedAt,
          o.status,
          o.ackedByUserId,
          o.ackedByDeviceId,
          o.executionId,
          o.idempotencyKey,
          o.createdAt,
          o.updatedAt,
          o.isDeleted ? 1 : 0,
        ),
    );
    return Promise.resolve();
  }

  update(o: Occurrence): Promise<void> {
    this.uow.enqueue(
      this.d1
        .prepare(
          `UPDATE occurrences SET
             due_at = ?, fired_at = ?, acked_at = ?, status = ?,
             acked_by_user_id = ?, acked_by_device_id = ?,
             execution_id = ?, updated_at = ?, is_deleted = ?
           WHERE id = ?`,
        )
        .bind(
          o.dueAt,
          o.firedAt,
          o.ackedAt,
          o.status,
          o.ackedByUserId,
          o.ackedByDeviceId,
          o.executionId,
          o.updatedAt,
          o.isDeleted ? 1 : 0,
          o.id,
        ),
    );
    return Promise.resolve();
  }

  remove(id: OccurrenceId): Promise<void> {
    const now = Date.now();
    this.uow.enqueue(
      this.d1
        .prepare("UPDATE occurrences SET is_deleted = 1, updated_at = ? WHERE id = ?")
        .bind(now, id),
    );
    return Promise.resolve();
  }
}
