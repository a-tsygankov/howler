import type { IUnitOfWork } from "../repos/interfaces.ts";
import { pendingForUser, occurrencesForTask } from "../repos/specs.ts";
import type { DeviceId, UserId } from "../domain/ids.ts";
import { asOccurrenceId } from "../domain/ids.ts";
import type { Occurrence } from "../domain/occurrence.ts";
import { ok, err, type Result } from "../result.ts";

export interface OccurrenceDto {
  id: string;
  taskId: string;
  dueAt: number;
  status: Occurrence["status"];
  ackedAt: number | null;
}

const toDto = (o: Occurrence): OccurrenceDto => ({
  id: o.id,
  taskId: o.taskId,
  dueAt: o.dueAt,
  status: o.status,
  ackedAt: o.ackedAt,
});

export const listPendingForUser = async (
  uow: IUnitOfWork,
  userId: UserId,
  limit = 50,
): Promise<OccurrenceDto[]> => {
  const items = await uow.occurrences.findMany(pendingForUser(userId, limit));
  return items.map(toDto);
};

export const listOccurrencesForTask = async (
  uow: IUnitOfWork,
  taskId: string,
): Promise<OccurrenceDto[]> => {
  const items = await uow.occurrences.findMany(
    occurrencesForTask(asOccurrenceId(taskId) as unknown as never),
  );
  return items.map(toDto);
};

export type AckError = "not-found" | "not-pending" | "wrong-user";

export const ackOccurrence = async (
  uow: IUnitOfWork,
  occId: string,
  callerUserId: string,
  ackedByDevice: DeviceId | null,
): Promise<Result<OccurrenceDto, AckError>> =>
  uow.run(async (tx) => {
    const occ = await tx.occurrences.findById(asOccurrenceId(occId));
    if (!occ) return err("not-found");
    // Defence-in-depth: ack only your own occurrences.
    const task = await tx.tasks.findById(occ.taskId);
    if (!task || task.userId !== callerUserId) return err("wrong-user");
    if (occ.status === "ACKED") return ok(toDto(occ)); // idempotent
    if (occ.status !== "PENDING") return err("not-pending");
    const nowMs = Date.now();
    const next: Occurrence = {
      ...occ,
      status: "ACKED",
      ackedAt: nowMs,
      ackedByDevice,
      updatedAt: nowMs,
    };
    await tx.occurrences.update(next);
    return ok(toDto(next));
  });
