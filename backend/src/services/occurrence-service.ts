import { clock } from "../clock.ts";
import type { IUnitOfWork } from "../repos/interfaces.ts";
import type { D1UnitOfWork } from "../repos/d1/unit-of-work.ts";
import { pendingForHome } from "../repos/specs.ts";
import {
  asOccurrenceId,
  asTaskExecutionId,
  newUuid,
  type DeviceId,
  type HomeId,
} from "../domain/ids.ts";
import type { Occurrence } from "../domain/occurrence.ts";
import { ok, err, type Result } from "../result.ts";

export interface OccurrenceDto {
  id: string;
  taskId: string;
  dueAt: number;
  status: Occurrence["status"];
  ackedAt: number | null;
  ackedByUserId: string | null;
  executionId: string | null;
}

const toDto = (o: Occurrence): OccurrenceDto => ({
  id: o.id,
  taskId: o.taskId,
  dueAt: o.dueAt,
  status: o.status,
  ackedAt: o.ackedAt,
  ackedByUserId: o.ackedByUserId,
  executionId: o.executionId,
});

export const listPendingForHome = async (
  uow: IUnitOfWork,
  homeId: HomeId,
  limit = 50,
): Promise<OccurrenceDto[]> => {
  const items = await uow.occurrences.findMany(pendingForHome(homeId, limit));
  return items.map(toDto);
};

export type AckError = "not-found" | "not-pending" | "wrong-home";

export interface AckOpts {
  callerHomeId: string;
  callerUserId: string | null;
  ackedByDevice: DeviceId | null;
  resultValue: number | null;
  notes: string | null;
}

interface TaskFields {
  home_id: string;
  label_id: string | null;
  result_type_id: string | null;
}

interface ResultTypeFields {
  unit_name: string;
}

// Takes the concrete D1UnitOfWork because writing the append-only
// task_executions row uses the UoW's enqueue() to land in the same
// batch as the occurrence UPDATE — that escape hatch isn't on the
// IUnitOfWork interface (which models pure aggregate writes).
export const ackOccurrence = async (
  db: D1Database,
  uow: D1UnitOfWork,
  occId: string,
  opts: AckOpts,
): Promise<Result<OccurrenceDto, AckError>> =>
  uow.run(async (tx) => {
    const occ = await tx.occurrences.findById(asOccurrenceId(occId));
    if (!occ) return err("not-found");

    // Pull task + result-type fields directly from D1 — these are
    // outside the live aggregate boundary but needed for the
    // denormalized snapshot we write into task_executions.
    const task = await db
      .prepare("SELECT home_id, label_id, result_type_id FROM tasks WHERE id = ?")
      .bind(occ.taskId)
      .first<TaskFields>();
    if (!task) return err("not-found");
    if (task.home_id !== opts.callerHomeId) return err("wrong-home");

    if (occ.status === "ACKED") return ok(toDto(occ)); // idempotent
    if (occ.status !== "PENDING") return err("not-pending");

    let unit: string | null = null;
    if (task.result_type_id) {
      const rt = await db
        .prepare("SELECT unit_name FROM task_results WHERE id = ?")
        .bind(task.result_type_id)
        .first<ResultTypeFields>();
      unit = rt?.unit_name ?? null;
    }

    const nowMs = clock().nowMs();
    const nowSec = Math.floor(nowMs / 1000);
    const executionId = asTaskExecutionId(newUuid());

    // task_executions is append-only. We INSERT it via uow.enqueue
    // through the schedule-repo's UoW handle so it lands in the
    // same db.batch as the occurrences UPDATE.
    uow.enqueue(
      db
        .prepare(
          `INSERT INTO task_executions
             (id, home_id, task_id, occurrence_id, user_id, device_id,
              label_id, result_type_id, result_value, result_unit, notes, ts)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          executionId,
          task.home_id,
          occ.taskId,
          occ.id,
          opts.callerUserId,
          opts.ackedByDevice,
          task.label_id,
          task.result_type_id,
          opts.resultValue,
          unit,
          opts.notes,
          nowSec,
        ),
    );
    void tx; // tx and uow are the same instance; reads above used db directly.

    const next: Occurrence = {
      ...occ,
      status: "ACKED",
      ackedAt: nowMs,
      ackedByUserId: opts.callerUserId
        ? (opts.callerUserId as Occurrence["ackedByUserId"])
        : null,
      ackedByDeviceId: opts.ackedByDevice,
      executionId,
      updatedAt: nowMs,
    };
    await tx.occurrences.update(next);
    return ok(toDto(next));
  });
