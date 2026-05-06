-- Phase 2.4 — schedule templates.
--
-- The 0002 schema didn't include this table; we add it now alongside
-- the routes that expose it. system rows are seeded by the
-- application on home creation (services/home-seed.ts).

CREATE TABLE schedule_templates (
  id            TEXT PRIMARY KEY,
  home_id       TEXT REFERENCES homes(id),
  display_name  TEXT NOT NULL,
  description   TEXT,
  rule_json     TEXT NOT NULL,
  system        INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  is_deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX schedule_templates_home_idx ON schedule_templates(home_id);
