-- Phase 2.6 (plumbing) — web push subscriptions.
--
-- One row per (user, browser) combo. The actual fanout from the
-- occurrence-fire queue consumer is Phase 2.6b — for now this
-- endpoint just persists subscriptions so the SPA can show
-- "notifications enabled" state.

CREATE TABLE push_subscriptions (
  id           TEXT PRIMARY KEY,
  home_id      TEXT NOT NULL REFERENCES homes(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  endpoint     TEXT NOT NULL,
  p256dh       TEXT NOT NULL,
  auth_secret  TEXT NOT NULL,
  user_agent   TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  is_deleted   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX push_user_idx ON push_subscriptions(user_id);
CREATE UNIQUE INDEX push_endpoint_idx ON push_subscriptions(endpoint);
