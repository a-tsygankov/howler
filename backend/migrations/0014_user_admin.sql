-- Phase 6 OTA — promote per-user admin from a placeholder env var
-- (`ADMIN_HOMES`) to a real schema field. The earlier model gated
-- F1's admin endpoints on `homeId ∈ ADMIN_HOMES` — every member of
-- a listed home automatically had admin. That was the F1 stub
-- per docs/ota.md §"slice gates"; this migration lands the proper
-- per-user model that doc anticipated for Phase 7.
--
-- Backfill rule: the earliest-created user of each home becomes
-- that home's admin. This matches the natural "household owner"
-- pattern — quick-setup creates one user, who's then the admin.
-- Subsequent users added through the user manager are NOT admin
-- by default; the existing admin can grant them admin via the
-- (forthcoming) ops UI, or directly via:
--   UPDATE users SET is_admin = 1 WHERE id = ?
--
-- Ties (two users with the same created_at in the same home)
-- both become admin — fine, that's a deliberate choice rather
-- than picking one arbitrarily by id ordering.

ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

UPDATE users
SET is_admin = 1
WHERE is_deleted = 0
  AND created_at = (
    SELECT MIN(created_at)
    FROM users u2
    WHERE u2.home_id = users.home_id
      AND u2.is_deleted = 0
  );
