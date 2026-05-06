// Auth audit log — ring buffer capped at 100 rows per user (and 1000
// total for un-attributed events). Same shape as Feedme's `audit.ts`.
// Diagnostic surface: lets the user inspect *why* a pair / login flow
// failed without grepping Worker logs. Phase 1 only — we'll consider
// promoting/demoting this to Workers Analytics Engine in a later phase.

const PER_USER_CAP = 100;
const GLOBAL_UNATTRIBUTED_CAP = 1000;

export type AuthLogKind =
  | "setup"
  | "login"
  | "login-qr"
  | "login-token-create"
  | "logout"
  | "set-pin"
  | "quick-setup"
  | "pair-start"
  | "pair-check"
  | "pair-confirm";

export type AuthLogResult = "ok" | "error";

export const recordAuthLog = async (
  db: D1Database,
  userId: string | null,
  kind: AuthLogKind,
  identifier: string | null,
  result: AuthLogResult,
  errorMessage: string | null,
  startMs: number,
): Promise<void> => {
  const ts = Math.floor(Date.now() / 1000);
  const durationMs = Date.now() - startMs;
  try {
    await db
      .prepare(
        `INSERT INTO auth_logs
         (user_id, ts, kind, identifier, result, error_message, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(userId, ts, kind, identifier, result, errorMessage, durationMs)
      .run();

    // Prune older rows past the cap. One DELETE per insert; cheap on
    // an indexed table with hundreds of rows. The unattributed case
    // (userId IS NULL) can balloon under attack, so it gets a higher
    // cap but still gets pruned.
    if (userId) {
      await db
        .prepare(
          `DELETE FROM auth_logs WHERE user_id = ? AND id NOT IN (
             SELECT id FROM auth_logs WHERE user_id = ?
             ORDER BY ts DESC LIMIT ?
           )`,
        )
        .bind(userId, userId, PER_USER_CAP)
        .run();
    } else {
      await db
        .prepare(
          `DELETE FROM auth_logs WHERE user_id IS NULL AND id NOT IN (
             SELECT id FROM auth_logs WHERE user_id IS NULL
             ORDER BY ts DESC LIMIT ?
           )`,
        )
        .bind(GLOBAL_UNATTRIBUTED_CAP)
        .run();
    }
  } catch (e) {
    // Never let audit failures break the auth flow itself.
    console.warn("[audit] failed to record auth log:", e);
  }
};
