// Auth audit log — ring buffer capped at 100 rows per home (and 1000
// total for un-attributed events). Diagnostic surface for "why did
// this pair / login flow fail" without grepping Worker logs.
//
// Plan §17 #3 / Phase 2.7: each insert also fires a Workers Analytics
// Engine data point (via observability.recordAuthEvent) so a
// dashboard can show success/error rates over time without opening
// the per-home ring buffer.

const PER_USER_CAP = 100;
const GLOBAL_UNATTRIBUTED_CAP = 1000;

export type AuthLogKind =
  | "setup"
  | "login"
  | "login-qr"
  | "login-token-create"
  | "logout"
  | "set-pin"
  | "select-user"
  | "quick-setup"
  | "pair-start"
  | "pair-check"
  | "pair-confirm";

export type AuthLogResult = "ok" | "error";

import type { Bindings } from "./env.ts";
import { recordAuthEvent } from "./observability.ts";

export const recordAuthLog = async (
  db: D1Database,
  homeId: string | null,
  userId: string | null,
  kind: AuthLogKind,
  identifier: string | null,
  result: AuthLogResult,
  errorMessage: string | null,
  startMs: number,
  env?: Bindings,
): Promise<void> => {
  const ts = Math.floor(Date.now() / 1000);
  const durationMs = Date.now() - startMs;
  if (env) {
    recordAuthEvent(env, kind, result, durationMs, errorMessage ?? undefined);
  }
  try {
    await db
      .prepare(
        `INSERT INTO auth_logs
         (home_id, user_id, ts, kind, identifier, result, error_message, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(homeId, userId, ts, kind, identifier, result, errorMessage, durationMs)
      .run();

    // Per-home cap; unattributed events get a higher global cap so
    // pre-auth probes don't drown a home's diagnostic surface.
    if (homeId) {
      await db
        .prepare(
          `DELETE FROM auth_logs WHERE home_id = ? AND id NOT IN (
             SELECT id FROM auth_logs WHERE home_id = ?
             ORDER BY ts DESC LIMIT ?
           )`,
        )
        .bind(homeId, homeId, PER_USER_CAP)
        .run();
    } else {
      await db
        .prepare(
          `DELETE FROM auth_logs WHERE home_id IS NULL AND id NOT IN (
             SELECT id FROM auth_logs WHERE home_id IS NULL
             ORDER BY ts DESC LIMIT ?
           )`,
        )
        .bind(GLOBAL_UNATTRIBUTED_CAP)
        .run();
    }
  } catch (e) {
    console.warn("[audit] failed to record auth log:", e);
  }
};
