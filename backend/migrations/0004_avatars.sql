-- Phase 2.5 — avatars (Option B: round photo + urgency ring at render time).
--
-- One R2 object per avatar (jpg/png, ≤ 2 MB validated server-side).
-- The avatars table only stores metadata — the bytes live in R2.
-- Avatar references already exist on homes.avatar_id, users.avatar_id,
-- tasks.avatar_id (added in 0002). This migration just adds the
-- registry.

CREATE TABLE avatars (
  id            TEXT PRIMARY KEY,
  home_id       TEXT NOT NULL REFERENCES homes(id),
  r2_key        TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  is_deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX avatars_home_idx ON avatars(home_id);
