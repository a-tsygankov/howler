-- Device rename + task → device assignment (docs/superpowers/specs/
-- 2026-06-02-device-rename-task-targeting-design.md).
--
-- Two additions:
--   1. `devices.name` — a user-editable display name for a paired
--      dial. NULL falls back to hw_model / serial in the UI.
--   2. `task_device_assignments` — a join table mirroring
--      `task_assignments` (the user-assignment join), letting a task
--      be pinned to one or more devices. A device-assigned task is
--      *shared* (visible to every user in the home) and shows on the
--      targeted device(s)' Today screen. A task is in exactly one
--      mode — user-targeted (private) OR device-targeted (shared) —
--      enforced in the task service, not by a DB constraint.
--
-- Counter triggers extend migration 0012's set so every change here
-- bumps the home update_counter and the dial picks it up on its next
-- peek:
--   * task_device_assignments INSERT/DELETE — assignment changed.
--   * devices INSERT — a newly paired dial is now home-visible and
--     assignable; the home list/picker must refresh.
--   * devices UPDATE OF name — a rename. Scoped to the `name` column
--     so the frequent last_seen_at writes (markDeviceAlive on every
--     device request) do NOT churn the counter — same care 0012
--     takes for schedules' next_fire_at.

ALTER TABLE devices ADD COLUMN name TEXT;

CREATE TABLE task_device_assignments (
  task_id    TEXT NOT NULL,
  device_id  TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, device_id)
);

CREATE INDEX task_device_assignments_device_idx
  ON task_device_assignments(device_id);

-- ── Counter triggers ────────────────────────────────────────────────

-- task_device_assignments: home_id derives via the related task,
-- mirroring task_assignments' triggers in 0012. No UPDATE trigger —
-- the join carries no mutable columns (a reassignment is DELETE +
-- INSERT).
CREATE TRIGGER task_device_assignments_bump_counter_ins
AFTER INSERT ON task_device_assignments
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = (SELECT home_id FROM tasks WHERE id = NEW.task_id);
END;

CREATE TRIGGER task_device_assignments_bump_counter_del
AFTER DELETE ON task_device_assignments
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = (SELECT home_id FROM tasks WHERE id = OLD.task_id);
END;

-- devices: 0012 deliberately left devices OUT of the trigger set
-- because last_seen_at churns on every request. Now that a device
-- carries an assignable identity + a user-editable name, two narrow
-- triggers cover the home-visible changes without reintroducing the
-- last_seen_at churn:
--   * INSERT — a new pairing.
--   * UPDATE OF name — a rename (column-scoped).
CREATE TRIGGER devices_bump_counter_ins
AFTER INSERT ON devices
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = NEW.home_id;
END;

CREATE TRIGGER devices_bump_counter_name_upd
AFTER UPDATE OF name ON devices
BEGIN
  UPDATE homes SET update_counter = update_counter + 1
  WHERE id = NEW.home_id;
END;
