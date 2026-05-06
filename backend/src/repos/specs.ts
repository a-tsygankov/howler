import type { ISpecification } from "./interfaces.ts";
import type { Task } from "../domain/task.ts";
import type { Occurrence } from "../domain/occurrence.ts";
import type { DeviceId, UserId } from "../domain/ids.ts";

// Specs are small, named, typed. They are NOT a generic query DSL —
// each tag has a single intent the repository understands.

export const ownedBy = (userId: UserId): ISpecification<Task> => ({
  tag: "OwnedBy",
  params: { userId },
});

export const pendingForDevice = (
  deviceId: DeviceId,
): ISpecification<Occurrence> => ({
  tag: "PendingForDevice",
  params: { deviceId },
});

export const dueBefore = (
  cutoff: number,
): ISpecification<Occurrence> => ({
  tag: "DueBefore",
  params: { cutoff },
});
