// Task visibility / access control (docs/superpowers/specs/
// 2026-06-02-device-rename-task-targeting-design.md).
//
// A task is in one of three assignment modes:
//   * Everyone  — no assignment rows; shared with all users.
//   * Devices   — task_device_assignments rows; shared with all users,
//                 shown on the targeted devices' Today screen.
//   * Users     — task_assignments rows; private to those users, the
//                 task's creator, and any admin.
//
// This module is the single source of truth for "who can see / edit /
// complete a task", expressed as a reusable SQL predicate plus a
// single-row check, so every task-reading and task-mutating endpoint
// enforces the same rule.

import type { AuthInfo } from "../auth.ts";

export type Principal =
  | { type: "user"; userId: string; homeId: string; isAdmin: boolean }
  | { type: "device"; deviceId: string; homeId: string };

/// Resolve the request's auth into a Principal, fetching `is_admin`
/// for user tokens (device tokens have no admin concept).
export const resolvePrincipal = async (
  db: D1Database,
  auth: AuthInfo,
): Promise<Principal> => {
  if (auth.type === "device") {
    return { type: "device", deviceId: auth.deviceId, homeId: auth.homeId };
  }
  const row = await db
    .prepare("SELECT is_admin FROM users WHERE id = ? AND is_deleted = 0")
    .bind(auth.userId)
    .first<{ is_admin: number }>();
  return {
    type: "user",
    userId: auth.userId,
    homeId: auth.homeId,
    isAdmin: row?.is_admin === 1,
  };
};

export interface SqlPredicate {
  sql: string; // boolean SQL expression over `${alias}.id` + `.creator_user_id`
  binds: unknown[];
}

/// A SQL boolean expression selecting the tasks `principal` may see.
/// `alias` is the `tasks` table alias in the surrounding query.
///   * device — only shared tasks (no user assignees).
///   * admin  — everything (1 = 1).
///   * user   — shared OR you're an assignee OR you're the creator.
export const visibleTasksPredicate = (
  principal: Principal,
  alias = "tasks",
): SqlPredicate => {
  const noUserTargets =
    `NOT EXISTS (SELECT 1 FROM task_assignments ta WHERE ta.task_id = ${alias}.id)`;
  if (principal.type === "device") {
    return { sql: noUserTargets, binds: [] };
  }
  if (principal.isAdmin) {
    return { sql: "1 = 1", binds: [] };
  }
  const sql =
    `(${noUserTargets}` +
    ` OR EXISTS (SELECT 1 FROM task_assignments ta WHERE ta.task_id = ${alias}.id AND ta.user_id = ?)` +
    ` OR ${alias}.creator_user_id = ?)`;
  return { sql, binds: [principal.userId, principal.userId] };
};

/// In-memory access check for callers that already hold the task's
/// creator + user-assignee set (avoids a round-trip). Mirrors
/// `visibleTasksPredicate` exactly.
export const principalCanAccessTask = (
  principal: Principal,
  task: { creatorUserId: string | null; userAssigneeIds: string[] },
): boolean => {
  const shared = task.userAssigneeIds.length === 0;
  if (principal.type === "device") return shared;
  if (principal.isAdmin) return true;
  return (
    shared ||
    task.userAssigneeIds.includes(principal.userId) ||
    task.creatorUserId === principal.userId
  );
};

/// True iff `principal` may see / edit / complete the given task.
/// Home-scoped via `principal.homeId` so a shared task in another home
/// is never accessible.
export const isTaskAccessible = async (
  db: D1Database,
  taskId: string,
  principal: Principal,
): Promise<boolean> => {
  const { sql, binds } = visibleTasksPredicate(principal, "t");
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM tasks t
       WHERE t.id = ? AND t.home_id = ? AND t.is_deleted = 0 AND ${sql}`,
    )
    .bind(taskId, principal.homeId, ...binds)
    .first<{ ok: number }>();
  return !!row;
};

/// Narrow a list of task ids to those `principal` may see. Used by the
/// pending-occurrence feed, which joins through to tasks.
export const visibleTaskIdSubset = async (
  db: D1Database,
  taskIds: string[],
  principal: Principal,
): Promise<Set<string>> => {
  if (taskIds.length === 0) return new Set();
  const { sql, binds } = visibleTasksPredicate(principal, "t");
  const placeholders = taskIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT t.id FROM tasks t
       WHERE t.id IN (${placeholders}) AND t.home_id = ? AND t.is_deleted = 0 AND ${sql}`,
    )
    .bind(...taskIds, principal.homeId, ...binds)
    .all<{ id: string }>();
  return new Set(results.map((r) => r.id));
};
