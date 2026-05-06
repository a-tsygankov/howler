import { clock } from "../../clock.ts";
import type { IRepository, ISpecification } from "../interfaces.ts";
import type { Schedule, ScheduleRule } from "../../domain/schedule.ts";
import { type ScheduleId, asScheduleId, type TaskId, asTaskId } from "../../domain/ids.ts";
import type { D1UnitOfWork } from "./unit-of-work.ts";

interface ScheduleRow {
  id: string;
  task_id: string;
  template_id: string | null;
  rule_json: string;
  tz: string;
  next_fire_at: number | null;
  created_at: number;
  updated_at: number;
  is_deleted: number;
}

const rowToSchedule = (r: ScheduleRow): Schedule => ({
  id: asScheduleId(r.id),
  taskId: asTaskId(r.task_id),
  templateId: r.template_id,
  rule: JSON.parse(r.rule_json) as ScheduleRule,
  tz: r.tz,
  nextFireAt: r.next_fire_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  isDeleted: r.is_deleted === 1,
});

export class D1ScheduleRepository implements IRepository<Schedule, ScheduleId> {
  constructor(
    private readonly d1: D1Database,
    private readonly uow: D1UnitOfWork,
  ) {}

  async findById(id: ScheduleId): Promise<Schedule | null> {
    const row = await this.d1
      .prepare("SELECT * FROM schedules WHERE id = ? AND is_deleted = 0")
      .bind(id)
      .first<ScheduleRow>();
    return row ? rowToSchedule(row) : null;
  }

  async findMany(spec: ISpecification<Schedule>): Promise<Schedule[]> {
    if (spec.tag === "DueBefore") {
      const cutoff = spec.params["cutoff"] as number;
      const limit = (spec.params["limit"] as number | undefined) ?? 100;
      const { results } = await this.d1
        .prepare(
          `SELECT * FROM schedules
           WHERE next_fire_at IS NOT NULL AND next_fire_at <= ? AND is_deleted = 0
           ORDER BY next_fire_at ASC LIMIT ?`,
        )
        .bind(cutoff, limit)
        .all<ScheduleRow>();
      return results.map(rowToSchedule);
    }
    if (spec.tag === "ForTask") {
      const taskId = spec.params["taskId"] as string;
      const { results } = await this.d1
        .prepare("SELECT * FROM schedules WHERE task_id = ? AND is_deleted = 0")
        .bind(taskId)
        .all<ScheduleRow>();
      return results.map(rowToSchedule);
    }
    throw new Error(`D1ScheduleRepository: unknown spec tag ${spec.tag}`);
  }

  add(s: Schedule): Promise<void> {
    this.uow.enqueue(
      this.d1
        .prepare(
          `INSERT INTO schedules
             (id, task_id, template_id, rule_json, tz, next_fire_at,
              created_at, updated_at, is_deleted)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          s.id,
          s.taskId,
          s.templateId,
          JSON.stringify(s.rule),
          s.tz,
          s.nextFireAt,
          s.createdAt,
          s.updatedAt,
          s.isDeleted ? 1 : 0,
        ),
    );
    return Promise.resolve();
  }

  update(s: Schedule): Promise<void> {
    this.uow.enqueue(
      this.d1
        .prepare(
          `UPDATE schedules SET
             template_id = ?, rule_json = ?, tz = ?, next_fire_at = ?,
             updated_at = ?, is_deleted = ?
           WHERE id = ?`,
        )
        .bind(
          s.templateId,
          JSON.stringify(s.rule),
          s.tz,
          s.nextFireAt,
          s.updatedAt,
          s.isDeleted ? 1 : 0,
          s.id,
        ),
    );
    return Promise.resolve();
  }

  remove(id: ScheduleId): Promise<void> {
    const now = clock().nowMs();
    this.uow.enqueue(
      this.d1
        .prepare("UPDATE schedules SET is_deleted = 1, updated_at = ? WHERE id = ?")
        .bind(now, id),
    );
    return Promise.resolve();
  }
}
