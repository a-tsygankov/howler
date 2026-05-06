import type { IRepository, ISpecification } from "../interfaces.ts";
import type { Task } from "../../domain/task.ts";
import {
  asHomeId,
  asLabelId,
  asTaskId,
  asTaskResultId,
  asUserId,
  type TaskId,
} from "../../domain/ids.ts";
import type { D1UnitOfWork } from "./unit-of-work.ts";

interface TaskRow {
  id: string;
  home_id: string;
  creator_user_id: string | null;
  title: string;
  description: string | null;
  priority: number;
  kind: "DAILY" | "PERIODIC" | "ONESHOT";
  deadline_hint: number | null;
  avatar_id: string | null;
  label_id: string | null;
  result_type_id: string | null;
  is_private: number;
  active: number;
  created_at: number;
  updated_at: number;
  is_deleted: number;
}

const rowToTask = (r: TaskRow): Task => ({
  id: asTaskId(r.id),
  homeId: asHomeId(r.home_id),
  creatorUserId: r.creator_user_id ? asUserId(r.creator_user_id) : null,
  title: r.title,
  description: r.description,
  priority: r.priority as Task["priority"],
  kind: r.kind,
  deadlineHint: r.deadline_hint,
  avatarId: r.avatar_id,
  labelId: r.label_id ? asLabelId(r.label_id) : null,
  resultTypeId: r.result_type_id ? asTaskResultId(r.result_type_id) : null,
  isPrivate: r.is_private === 1,
  active: r.active === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  isDeleted: r.is_deleted === 1,
});

export class D1TaskRepository implements IRepository<Task, TaskId> {
  constructor(
    private readonly d1: D1Database,
    private readonly uow: D1UnitOfWork,
  ) {}

  async findById(id: TaskId): Promise<Task | null> {
    const row = await this.d1
      .prepare("SELECT * FROM tasks WHERE id = ? AND is_deleted = 0")
      .bind(id)
      .first<TaskRow>();
    return row ? rowToTask(row) : null;
  }

  async findMany(spec: ISpecification<Task>): Promise<Task[]> {
    if (spec.tag === "OwnedByHome") {
      const homeId = spec.params["homeId"] as string;
      const { results } = await this.d1
        .prepare(
          `SELECT * FROM tasks WHERE home_id = ? AND is_deleted = 0
           ORDER BY updated_at DESC`,
        )
        .bind(homeId)
        .all<TaskRow>();
      return results.map(rowToTask);
    }
    throw new Error(`D1TaskRepository: unknown spec tag ${spec.tag}`);
  }

  add(t: Task): Promise<void> {
    this.uow.enqueue(
      this.d1
        .prepare(
          `INSERT INTO tasks
           (id, home_id, creator_user_id, title, description, priority, kind,
            deadline_hint, avatar_id, label_id, result_type_id, is_private,
            active, created_at, updated_at, is_deleted)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          t.id,
          t.homeId,
          t.creatorUserId,
          t.title,
          t.description,
          t.priority,
          t.kind,
          t.deadlineHint,
          t.avatarId,
          t.labelId,
          t.resultTypeId,
          t.isPrivate ? 1 : 0,
          t.active ? 1 : 0,
          t.createdAt,
          t.updatedAt,
          t.isDeleted ? 1 : 0,
        ),
    );
    return Promise.resolve();
  }

  update(t: Task): Promise<void> {
    this.uow.enqueue(
      this.d1
        .prepare(
          `UPDATE tasks SET
             title = ?, description = ?, priority = ?, kind = ?,
             deadline_hint = ?, avatar_id = ?, label_id = ?,
             result_type_id = ?, is_private = ?, active = ?,
             updated_at = ?, is_deleted = ?
           WHERE id = ?`,
        )
        .bind(
          t.title,
          t.description,
          t.priority,
          t.kind,
          t.deadlineHint,
          t.avatarId,
          t.labelId,
          t.resultTypeId,
          t.isPrivate ? 1 : 0,
          t.active ? 1 : 0,
          t.updatedAt,
          t.isDeleted ? 1 : 0,
          t.id,
        ),
    );
    return Promise.resolve();
  }

  remove(id: TaskId): Promise<void> {
    const now = Date.now();
    this.uow.enqueue(
      this.d1
        .prepare("UPDATE tasks SET is_deleted = 1, updated_at = ? WHERE id = ?")
        .bind(now, id),
    );
    return Promise.resolve();
  }
}
