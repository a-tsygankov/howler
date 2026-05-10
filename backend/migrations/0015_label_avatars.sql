-- Phase: avatars sweep — labels join the unified avatar_id world.
--
-- Pre-migration state: labels.icon held a bare icon name (e.g. "paw")
-- pulled from webapp/src/components/Icon.tsx. Tasks would inherit by
-- prefixing "icon:" at INSERT time — see backend/src/routes/tasks.ts
-- around line 172. Two surfaces, two formats.
--
-- Post-migration: labels.avatar_id holds the unified avatar_id form
-- ("icon:<name>" for icon presets, 32-hex UUID for uploaded photos)
-- — same shape as homes.avatar_id, users.avatar_id, tasks.avatar_id.
-- Task inheritance becomes a verbatim copy.
--
-- The legacy `icon` column is retained (NOT dropped) to keep older
-- Worker deploys functional during a rollback window. New writes go
-- to avatar_id only; the route falls back to `icon:<icon>` on read
-- when avatar_id is null.

ALTER TABLE labels ADD COLUMN avatar_id TEXT;

-- Backfill existing icon values into the unified format. Empty /
-- null icons stay null (rendered as fallback initials).
UPDATE labels SET avatar_id = 'icon:' || icon
  WHERE icon IS NOT NULL AND icon != '' AND avatar_id IS NULL;
