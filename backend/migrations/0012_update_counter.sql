-- Slice A of the peek-then-merge sync optimisation (docs/sync-analysis.md).
--
-- Adds a per-home `update_counter` that's bumped by triggers on every
-- mutation of any home-scoped entity. Devices then call GET
-- /api/homes/peek to compare their cached counter against the server's
-- current value — equal means "no data has changed since you last
-- looked" and the device skips its four-fetch sync round entirely.
--
-- Backfilled to 1 so devices that boot post-migration with no cached
-- counter (cached=0) see a guaranteed mismatch and fall through to a
-- full sync on first peek. Subsequent peeks are cheap (~200 B response
-- vs ~5–15 KB for a full round) and ~10x cheaper on D1 reads.
--
-- The triggers are deliberately simple: every INSERT/UPDATE/DELETE on
-- a home-scoped table runs `UPDATE homes SET update_counter =
-- update_counter + 1`. SQLite executes each statement atomically and
-- the trigger fires within the same prepared-statement transaction as
-- the mutation, so concurrent writers can't race the increment.
--
-- Coverage — every table that contributes to a device sync payload:
--
--   tasks · schedules · task_assignments · occurrences ·
--   task_executions · users · labels · task_results · avatars
--
-- Skipped (intentionally, not synced):
--   pending_pairings, login_qr_tokens, auth_logs — transient auth state
--   device_outbox, devices.last_seen_at — per-device, doesn't change
--                                          the home's data view
--   schedule_templates, push_subscriptions — webapp-only paths
--   icons — global, not per-home

ALTER TABLE homes ADD COLUMN update_counter INTEGER NOT NULL DEFAULT 0;
UPDATE homes SET update_counter = 1 WHERE update_counter = 0;

-- ── Direct-home_id tables: tasks, users, labels, task_results,
--    task_executions, avatars ────────────────────────────────────

CREATE TRIGGER tasks_bump_counter_ins
AFTER INSERT ON tasks
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = NEW.home_id;
END;

CREATE TRIGGER tasks_bump_counter_upd
AFTER UPDATE ON tasks
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = NEW.home_id;
END;

-- DELETE on tasks isn't used (soft-delete via UPDATE), but cover it
-- for symmetry — a future hard-delete shouldn't silently miss the
-- bump.
CREATE TRIGGER tasks_bump_counter_del
AFTER DELETE ON tasks
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = OLD.home_id;
END;

CREATE TRIGGER users_bump_counter_ins
AFTER INSERT ON users
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = NEW.home_id;
END;

CREATE TRIGGER users_bump_counter_upd
AFTER UPDATE ON users
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = NEW.home_id;
END;

CREATE TRIGGER users_bump_counter_del
AFTER DELETE ON users
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = OLD.home_id;
END;

CREATE TRIGGER labels_bump_counter_ins
AFTER INSERT ON labels
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = NEW.home_id;
END;

CREATE TRIGGER labels_bump_counter_upd
AFTER UPDATE ON labels
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = NEW.home_id;
END;

CREATE TRIGGER labels_bump_counter_del
AFTER DELETE ON labels
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = OLD.home_id;
END;

CREATE TRIGGER task_results_bump_counter_ins
AFTER INSERT ON task_results
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = NEW.home_id;
END;

CREATE TRIGGER task_results_bump_counter_upd
AFTER UPDATE ON task_results
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = NEW.home_id;
END;

CREATE TRIGGER task_results_bump_counter_del
AFTER DELETE ON task_results
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = OLD.home_id;
END;

CREATE TRIGGER task_executions_bump_counter_ins
AFTER INSERT ON task_executions
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = NEW.home_id;
END;
-- task_executions is append-only; the schema doesn't UPDATE or
-- DELETE rows. Skip those triggers — cheaper writes on the hot
-- mark-done path.

CREATE TRIGGER avatars_bump_counter_ins
AFTER INSERT ON avatars
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = NEW.home_id;
END;

CREATE TRIGGER avatars_bump_counter_upd
AFTER UPDATE ON avatars
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = NEW.home_id;
END;

CREATE TRIGGER avatars_bump_counter_del
AFTER DELETE ON avatars
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = OLD.home_id;
END;

-- ── Indirect-home_id tables: schedules, task_assignments,
--    occurrences. The home_id derives via the related task. ────

-- schedules: bump only when the user-driven rule_modified_at
-- changes. The cron fanout in services/fanout.ts UPDATEs
-- next_fire_at + updated_at every time it advances a schedule;
-- bumping the counter on those would fire ~once a minute even
-- when nothing user-visible changed. The companion occurrence
-- INSERT (same fanout transaction) already bumps for the
-- materialised-occurrence case.
CREATE TRIGGER schedules_bump_counter_ins
AFTER INSERT ON schedules
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = (SELECT home_id FROM tasks WHERE id = NEW.task_id);
END;

CREATE TRIGGER schedules_bump_counter_upd
AFTER UPDATE OF rule_modified_at, is_deleted ON schedules
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = (SELECT home_id FROM tasks WHERE id = NEW.task_id);
END;

CREATE TRIGGER schedules_bump_counter_del
AFTER DELETE ON schedules
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = (SELECT home_id FROM tasks WHERE id = OLD.task_id);
END;

CREATE TRIGGER task_assignments_bump_counter_ins
AFTER INSERT ON task_assignments
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = (SELECT home_id FROM tasks WHERE id = NEW.task_id);
END;

CREATE TRIGGER task_assignments_bump_counter_del
AFTER DELETE ON task_assignments
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = (SELECT home_id FROM tasks WHERE id = OLD.task_id);
END;

-- occurrences: ack flow UPDATEs the row (status + acked_at);
-- both transitions are user-visible.
CREATE TRIGGER occurrences_bump_counter_ins
AFTER INSERT ON occurrences
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = (SELECT home_id FROM tasks WHERE id = NEW.task_id);
END;

CREATE TRIGGER occurrences_bump_counter_upd
AFTER UPDATE ON occurrences
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = (SELECT home_id FROM tasks WHERE id = NEW.task_id);
END;

CREATE TRIGGER occurrences_bump_counter_del
AFTER DELETE ON occurrences
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = (SELECT home_id FROM tasks WHERE id = OLD.task_id);
END;
