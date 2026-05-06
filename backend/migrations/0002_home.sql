-- Phase 2.0 — home-centric model (plan §6 / §6.1).
--
-- DESTRUCTIVE rebuild. Pre-Phase-2 the deployed DB has only
-- smoke-test transparent users; no real data. Application-level
-- seeding of default labels + task_results happens in
-- /api/auth/{setup,quick-setup} when a home is created — not here.

DROP TABLE IF EXISTS device_outbox;
DROP TABLE IF EXISTS occurrences;
DROP TABLE IF EXISTS schedules;
DROP TABLE IF EXISTS pending_pairings;
DROP TABLE IF EXISTS login_qr_tokens;
DROP TABLE IF EXISTS auth_logs;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS users;

-- ── homes ─────────────────────────────────────────────────────────
CREATE TABLE homes (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  login         TEXT UNIQUE,
  pin_salt      TEXT,
  pin_hash      TEXT,
  tz            TEXT NOT NULL DEFAULT 'UTC',
  avatar_id     TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  is_deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX homes_login_idx ON homes(login);

-- ── users (now child of home) ─────────────────────────────────────
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  home_id       TEXT NOT NULL REFERENCES homes(id),
  display_name  TEXT NOT NULL,
  login         TEXT UNIQUE,
  pin_salt      TEXT,
  pin_hash      TEXT,
  avatar_id     TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  is_deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX users_home_idx ON users(home_id);

-- ── labels (per-home; default-seeded) ─────────────────────────────
CREATE TABLE labels (
  id            TEXT PRIMARY KEY,
  home_id       TEXT NOT NULL REFERENCES homes(id),
  display_name  TEXT NOT NULL,
  color         TEXT,
  system        INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  is_deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX labels_home_idx ON labels(home_id);

-- ── task_results (the type definitions) ───────────────────────────
CREATE TABLE task_results (
  id              TEXT PRIMARY KEY,
  home_id         TEXT NOT NULL REFERENCES homes(id),
  display_name    TEXT NOT NULL,
  unit_name       TEXT NOT NULL,
  min_value       REAL,
  max_value       REAL,
  step            REAL NOT NULL DEFAULT 1,
  default_value   REAL,
  use_last_value  INTEGER NOT NULL DEFAULT 1,
  system          INTEGER NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  is_deleted      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX task_results_home_idx ON task_results(home_id);

-- ── tasks (now home-scoped) ───────────────────────────────────────
CREATE TABLE tasks (
  id              TEXT PRIMARY KEY,
  home_id         TEXT NOT NULL REFERENCES homes(id),
  creator_user_id TEXT REFERENCES users(id),
  title           TEXT NOT NULL,
  description     TEXT,
  priority        INTEGER NOT NULL DEFAULT 1,
  kind            TEXT NOT NULL CHECK (kind IN ('DAILY','PERIODIC','ONESHOT')),
  deadline_hint   INTEGER,
  avatar_id       TEXT,
  label_id        TEXT REFERENCES labels(id),
  result_type_id  TEXT REFERENCES task_results(id),
  is_private      INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  is_deleted      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX tasks_home_idx    ON tasks(home_id);
CREATE INDEX tasks_label_idx   ON tasks(label_id);
CREATE INDEX tasks_updated_idx ON tasks(updated_at);

-- ── task_assignments (many-to-many) ───────────────────────────────
CREATE TABLE task_assignments (
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX task_assignments_user_idx ON task_assignments(user_id);

-- ── schedules ─────────────────────────────────────────────────────
CREATE TABLE schedules (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id),
  template_id   TEXT,
  rule_json     TEXT NOT NULL,
  tz            TEXT NOT NULL,
  next_fire_at  INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  is_deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX schedules_next_fire_idx ON schedules(next_fire_at);
CREATE INDEX schedules_task_idx      ON schedules(task_id);

-- ── occurrences (lifecycle table; mutates) ────────────────────────
CREATE TABLE occurrences (
  id                 TEXT PRIMARY KEY,
  task_id            TEXT NOT NULL REFERENCES tasks(id),
  due_at             INTEGER NOT NULL,
  fired_at           INTEGER,
  acked_at           INTEGER,
  status             TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING','ACKED','SKIPPED','MISSED')),
  acked_by_user_id   TEXT REFERENCES users(id),
  acked_by_device_id TEXT,
  execution_id       TEXT,
  idempotency_key    TEXT UNIQUE,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  is_deleted         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX occ_task_status_idx ON occurrences(task_id, status);
CREATE INDEX occ_due_idx         ON occurrences(due_at);

-- ── task_executions (append-only history) ─────────────────────────
CREATE TABLE task_executions (
  id              TEXT PRIMARY KEY,
  home_id         TEXT NOT NULL REFERENCES homes(id),
  task_id         TEXT NOT NULL REFERENCES tasks(id),
  occurrence_id   TEXT,
  user_id         TEXT REFERENCES users(id),
  device_id       TEXT,
  label_id        TEXT,
  result_type_id  TEXT,
  result_value    REAL,
  result_unit     TEXT,
  notes           TEXT,
  ts              INTEGER NOT NULL
);
CREATE INDEX task_executions_home_ts_idx     ON task_executions(home_id, ts DESC);
CREATE INDEX task_executions_task_ts_idx     ON task_executions(task_id, ts DESC);
CREATE INDEX task_executions_occurrence_idx  ON task_executions(occurrence_id);

-- ── devices (now home-scoped) ─────────────────────────────────────
CREATE TABLE devices (
  id           TEXT PRIMARY KEY,
  home_id      TEXT NOT NULL REFERENCES homes(id),
  serial       TEXT NOT NULL,
  fw_version   TEXT,
  hw_model     TEXT NOT NULL,
  tz           TEXT,
  last_seen_at INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  is_deleted   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX devices_home_idx ON devices(home_id);

-- ── pending_pairings (claims a home, not a user) ──────────────────
CREATE TABLE pending_pairings (
  device_id     TEXT PRIMARY KEY,
  pair_code     TEXT NOT NULL,
  serial        TEXT,
  hw_model      TEXT,
  requested_at  INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  cancelled_at  INTEGER,
  confirmed_at  INTEGER,
  home_id       TEXT,
  device_token  TEXT
);
CREATE INDEX pending_pairings_pair_code_idx ON pending_pairings(pair_code);
CREATE INDEX pending_pairings_expires_idx   ON pending_pairings(expires_at);

-- ── login_qr_tokens (binds home + device; user picked after) ──────
CREATE TABLE login_qr_tokens (
  token         TEXT PRIMARY KEY,
  device_id     TEXT NOT NULL,
  home_id       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  consumed_at   INTEGER
);
CREATE INDEX login_qr_device_idx  ON login_qr_tokens(device_id);
CREATE INDEX login_qr_expires_idx ON login_qr_tokens(expires_at);

-- ── auth_logs (per-home ring buffer) ──────────────────────────────
CREATE TABLE auth_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  home_id       TEXT,
  user_id       TEXT,
  ts            INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  identifier    TEXT,
  result        TEXT NOT NULL,
  error_message TEXT,
  duration_ms   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX auth_logs_home_ts_idx ON auth_logs(home_id, ts DESC);
CREATE INDEX auth_logs_ts_idx      ON auth_logs(ts DESC);

-- ── device outbox (REST polling) ──────────────────────────────────
CREATE TABLE device_outbox (
  id            TEXT PRIMARY KEY,
  device_id     TEXT NOT NULL REFERENCES devices(id),
  payload_json  TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  delivered_at  INTEGER
);
CREATE INDEX outbox_dev_undelivered_idx ON device_outbox(device_id, delivered_at);
