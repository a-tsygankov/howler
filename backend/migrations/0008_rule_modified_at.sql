-- Add a separate "rule_modified_at" anchor to schedules so the
-- urgency calc has a stable reset point.
--
-- Background: `schedules.updated_at` was bumped by the cron's
-- queue consumer every time it advanced `next_fire_at` (see
-- backend/src/services/fanout.ts). The dashboard's urgency rule
-- (backend/src/services/urgency.ts) treats updated_at as
-- "scheduleModifiedAt" — the anchor that says "the user reset
-- the rhythm here". With the cron also bumping it, modifiedAt
-- raced forward past every prev_deadline, so isMissed was
-- always false and the fraction-of-period was always > 0.5,
-- which pushed every task into the HIDDEN tier and the
-- dashboard returned `tasks: []` even when occurrences were
-- being materialised normally.
--
-- Fix: a dedicated column that the cron leaves alone. Only
-- user-driven mutations (schedule creation, rule edit) bump it.
-- Backfill from updated_at so the value is well-defined for
-- pre-existing rows; this is wrong for rows that the cron has
-- already touched (the anchor lands on the most recent fire),
-- but it self-corrects on the next user edit and isn't worth a
-- per-row recovery script.

ALTER TABLE schedules ADD COLUMN rule_modified_at INTEGER NOT NULL DEFAULT 0;
UPDATE schedules SET rule_modified_at = updated_at WHERE rule_modified_at = 0;
