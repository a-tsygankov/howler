-- Phase 1 step 1 — auth.
--
-- Adds:
--   • users.username (UNIQUE, nullable) so PIN login can look up by
--     a human-typeable handle; relaxes email/display_name to nullable
--     so transparent accounts (no PIN, auto-generated handle) don't
--     have to fake one.
--   • pending_pairings — 3-minute device-to-user handshake window.
--   • login_qr_tokens — 60-second one-shot phone-login from a
--     paired device.
--   • auth_logs — ring buffer of pair / login / setup events for
--     diagnostics. Capped per user in code (audit.ts).
--
-- Rebuild of `users` is safe at this point: the `users` table has no
-- rows in either the local Miniflare D1 or remote D1 (Phase 0 only
-- exercised /api/health and /api/tasks against an empty table). In
-- production we'd use expand-contract; we're not there yet.

CREATE TABLE users_new (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE,
  email         TEXT,
  display_name  TEXT,
  pin_hash      TEXT,
  pin_salt      TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  is_deleted    INTEGER NOT NULL DEFAULT 0
);

INSERT INTO users_new
  (id, username, email, display_name, pin_hash, pin_salt,
   created_at, updated_at, is_deleted)
SELECT id, NULL, email, display_name, pin_hash, pin_salt,
       created_at, updated_at, is_deleted
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE TABLE pending_pairings (
  device_id     TEXT PRIMARY KEY,
  pair_code     TEXT NOT NULL,
  serial        TEXT,
  hw_model      TEXT,
  requested_at  INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  cancelled_at  INTEGER,
  confirmed_at  INTEGER,
  user_id       TEXT,
  device_token  TEXT
);
CREATE INDEX pending_pairings_pair_code_idx ON pending_pairings(pair_code);
CREATE INDEX pending_pairings_expires_idx   ON pending_pairings(expires_at);

CREATE TABLE login_qr_tokens (
  token         TEXT PRIMARY KEY,
  device_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  consumed_at   INTEGER
);
CREATE INDEX login_qr_device_idx  ON login_qr_tokens(device_id);
CREATE INDEX login_qr_expires_idx ON login_qr_tokens(expires_at);

CREATE TABLE auth_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT,
  ts            INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  identifier    TEXT,
  result        TEXT NOT NULL,
  error_message TEXT,
  duration_ms   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX auth_logs_user_ts_idx ON auth_logs(user_id, ts DESC);
CREATE INDEX auth_logs_ts_idx      ON auth_logs(ts DESC);
