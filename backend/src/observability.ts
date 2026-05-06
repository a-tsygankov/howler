// Workers Analytics Engine — structured event firehose.
//
// One dataset, one row per event. Fields are typed lanes:
//   indexes : at most 1, low-cardinality, used for fast filtering
//   blobs   : up to 20 strings, e.g. error messages, ids
//   doubles : up to 20 numbers, e.g. durations / counts
//
// Telemetry is fire-and-forget. Bind missing in tests / local dev → no-op.
//
// Plan §17 #3 / §18 Phase 2.7 — dashboards built off this dataset
// land in docs/observability.md as SQL queries.

import type { AnalyticsBinding, Bindings } from "./env.ts";

const safeWrite = (
  binding: AnalyticsBinding | undefined,
  blobs: string[],
  doubles: number[],
  index: string,
): void => {
  if (!binding) return;
  try {
    binding.writeDataPoint({ blobs, doubles, indexes: [index] });
  } catch (e) {
    // Never let analytics break a request. Logged for sanity in dev.
    console.warn("[analytics] writeDataPoint failed:", e);
  }
};

// ── Cron + queue scheduler signals ───────────────────────────────────

export const recordCronTick = (
  env: Bindings,
  enqueued: number,
  durationMs: number,
): void => {
  safeWrite(env.ANALYTICS, ["cron-fanout"], [enqueued, durationMs], "cron");
};

export const recordOccurrenceFired = (
  env: Bindings,
  taskId: string,
  scheduleId: string,
  dueAt: number,
  firedAt: number,
): void => {
  // lag = how late the cron tick was vs the schedule's intended fire time.
  const lagSec = Math.max(0, Math.floor(firedAt / 1000) - dueAt);
  safeWrite(
    env.ANALYTICS,
    ["occurrence-fired", taskId, scheduleId],
    [lagSec],
    "fired",
  );
};

export const recordOccurrenceAcked = (
  env: Bindings,
  occurrenceId: string,
  firedAtMs: number | null,
  ackedAtMs: number,
  byKind: "user" | "device",
): void => {
  const ackLatencyMs = firedAtMs ? ackedAtMs - firedAtMs : 0;
  safeWrite(
    env.ANALYTICS,
    ["occurrence-acked", occurrenceId, byKind],
    [ackLatencyMs],
    "acked",
  );
};

// ── Auth signals ─────────────────────────────────────────────────────

export const recordAuthEvent = (
  env: Bindings,
  kind: string,
  result: "ok" | "error",
  durationMs: number,
  detail?: string,
): void => {
  safeWrite(
    env.ANALYTICS,
    ["auth", kind, result, detail ?? ""],
    [durationMs],
    `auth:${result}`,
  );
};

// ── Push delivery signals ────────────────────────────────────────────

export const recordPushDelivery = (
  env: Bindings,
  endpoint: string,
  status: number,
  ok: boolean,
): void => {
  // Endpoint origin is the push service (FCM / Mozilla / WNS); useful
  // dimension for spotting one provider misbehaving.
  let origin = "unknown";
  try {
    origin = new URL(endpoint).host;
  } catch {
    /* ignore */
  }
  safeWrite(
    env.ANALYTICS,
    ["push", ok ? "ok" : "error", String(status), origin],
    [ok ? 1 : 0, status],
    `push:${ok ? "ok" : "error"}`,
  );
};
