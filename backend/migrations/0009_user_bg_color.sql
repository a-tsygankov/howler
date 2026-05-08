-- Per-user accent / background colour. Used by the webapp's
-- UserRow editor (and the device's mark-done flow) to make the
-- chip representing each user immediately recognisable in a
-- multi-user home.
--
-- Stored as a 7-char "#RRGGBB" hex string for direct CSS use; null
-- means "fall back to the seed-derived deterministic colour"
-- (current default — what HowlerAvatar generates from `id`).
ALTER TABLE users ADD COLUMN bg_color TEXT;
