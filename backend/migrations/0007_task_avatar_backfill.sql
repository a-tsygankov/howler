-- Phase C / m-2026-05-06: backfill task avatars from their label's
-- icon so existing rows immediately get a visual on the dashboard
-- under the new "icon:<name>" prefix scheme. Tasks without a label
-- stay null (the renderer falls back to initials).

UPDATE tasks
SET avatar_id = 'icon:' || (
    SELECT icon FROM labels
    WHERE labels.id = tasks.label_id
      AND labels.is_deleted = 0
      AND labels.icon IS NOT NULL
)
WHERE tasks.avatar_id IS NULL
  AND tasks.label_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM labels
    WHERE labels.id = tasks.label_id
      AND labels.is_deleted = 0
      AND labels.icon IS NOT NULL
  );
