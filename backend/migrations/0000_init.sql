-- Generated baseline. Replace by running `pnpm db:generate` once the
-- Drizzle schema settles; drizzle-kit will emit a fresh 0000_* file
-- from src/db/schema.ts. Hand-keeping this in sync with schema.ts
-- defeats the purpose of drizzle-kit (plan §16 / §20.1 C3).

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  pin_hash      TEXT,
  pin_salt      TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  is_deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  title         TEXT NOT NULL,
  description   TEXT,
  priority      INTEGER NOT NULL DEFAULT 1,
  kind          TEXT NOT NULL CHECK (kind IN ('DAILY','PERIODIC','ONESHOT')),
  deadline_hint INTEGER,
  avatar_id     TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  is_deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tasks_user_idx    ON tasks(user_id);
CREATE INDEX IF NOT EXISTS tasks_updated_idx ON tasks(updated_at);

CREATE TABLE IF NOT EXISTS schedules (
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
CREATE INDEX IF NOT EXISTS schedules_next_fire_idx ON schedules(next_fire_at);

CREATE TABLE IF NOT EXISTS occurrences (
  id               TEXT PRIMARY KEY,
  task_id          TEXT NOT NULL REFERENCES tasks(id),
  due_at           INTEGER NOT NULL,
  fired_at         INTEGER,
  acked_at         INTEGER,
  status           TEXT NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','ACKED','SKIPPED','MISSED')),
  acked_by_device  TEXT,
  idempotency_key  TEXT UNIQUE,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  is_deleted       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS occ_task_status_idx ON occurrences(task_id, status);
CREATE INDEX IF NOT EXISTS occ_due_idx         ON occurrences(due_at);

CREATE TABLE IF NOT EXISTS devices (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  serial       TEXT NOT NULL UNIQUE,
  fw_version   TEXT,
  hw_model     TEXT NOT NULL,
  last_seen_at INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  is_deleted   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS device_outbox (
  id            TEXT PRIMARY KEY,
  device_id     TEXT NOT NULL REFERENCES devices(id),
  payload_json  TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  delivered_at  INTEGER
);
CREATE INDEX IF NOT EXISTS outbox_dev_undelivered_idx
  ON device_outbox(device_id, delivered_at);
