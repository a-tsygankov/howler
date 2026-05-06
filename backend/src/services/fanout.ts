// Cron-driven fan-out + queue-driven occurrence firing.
//
// Cron tick: every minute the scheduled() handler picks up to 100
// schedules whose next_fire_at <= now and enqueues a job per schedule.
// The queue consumer materialises one occurrence per job and advances
// the schedule's next_fire_at — matching plan §7.
//
// We split it this way (rather than doing the work inline in cron)
// because the cron tick has a tight CPU-time budget, and a queue
// consumer batches and absorbs bursts gracefully.

import type { Bindings, OccurrenceFireMessage } from "../env.ts";
import { D1UnitOfWork } from "../repos/d1/unit-of-work.ts";
import { dueBefore } from "../repos/specs.ts";
import { computeNextFireAt } from "./firing.ts";
import {
  asOccurrenceId,
  asScheduleId,
  newUuid,
} from "../domain/ids.ts";
import { dispatchPushForOccurrence } from "./push.ts";
import { recordCronTick, recordOccurrenceFired } from "../observability.ts";

const FANOUT_BATCH = 100;

export const scheduledFanout = async (env: Bindings): Promise<number> => {
  const startMs = Date.now();
  const uow = new D1UnitOfWork(env.DB);
  const nowSec = Math.floor(startMs / 1000);
  const due = await uow.schedules.findMany(dueBefore(nowSec, FANOUT_BATCH));
  if (due.length === 0) {
    recordCronTick(env, 0, Date.now() - startMs);
    return 0;
  }
  const messages: MessageSendRequest<OccurrenceFireMessage>[] = due.map((s) => ({
    body: { scheduleId: s.id, dueAt: s.nextFireAt ?? nowSec },
  }));
  await env.OCCURRENCE_QUEUE.sendBatch(messages);
  recordCronTick(env, due.length, Date.now() - startMs);
  return due.length;
};

export const consumeFireQueue = async (
  env: Bindings,
  batch: MessageBatch<OccurrenceFireMessage>,
): Promise<void> => {
  for (const msg of batch.messages) {
    try {
      await fireOne(env, msg.body);
      msg.ack();
    } catch (e) {
      console.error("[fanout] queue message failed:", e);
      msg.retry();
    }
  }
};

const fireOne = async (
  env: Bindings,
  body: OccurrenceFireMessage,
): Promise<void> => {
  const uow = new D1UnitOfWork(env.DB);
  let firedTaskId: string | null = null;
  let firedOccId: string | null = null;
  await uow.run(async (tx) => {
    const schedule = await tx.schedules.findById(asScheduleId(body.scheduleId));
    if (!schedule) return; // schedule deleted between cron pick and consume
    if (schedule.nextFireAt === null) return; // already advanced past

    const nowMs = Date.now();
    const occId = asOccurrenceId(newUuid());
    await tx.occurrences.add({
      id: occId,
      taskId: schedule.taskId,
      dueAt: body.dueAt,
      firedAt: nowMs,
      ackedAt: null,
      status: "PENDING",
      ackedByUserId: null,
      ackedByDeviceId: null,
      executionId: null,
      idempotencyKey: `sched:${schedule.id}:${body.dueAt}`,
      createdAt: nowMs,
      updatedAt: nowMs,
      isDeleted: false,
    });
    firedTaskId = schedule.taskId;
    firedOccId = occId;
    recordOccurrenceFired(env, schedule.taskId, schedule.id, body.dueAt, nowMs);

    const nowSec = Math.floor(nowMs / 1000);
    const nextFireAt = computeNextFireAt(schedule.rule, nowSec, null);
    await tx.schedules.update({
      ...schedule,
      nextFireAt,
      updatedAt: nowMs,
    });
  });

  // Push fanout happens *after* the UoW commits — we don't want a
  // failed push to roll back the occurrence write. Best-effort.
  if (firedTaskId && firedOccId) {
    try {
      await dispatchPushForOccurrence(env, firedTaskId, firedOccId);
    } catch (e) {
      console.warn("[fanout] push dispatch failed:", e);
    }
  }
};
