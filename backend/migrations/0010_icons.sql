-- Icon storage for the device-side renderer. The webapp uses inline
-- SVG paths (webapp/src/components/Icon.tsx); the device can't easily
-- render SVG, so we pre-rasterize each icon to a 24×24 1-bit bitmap
-- and serve the bytes through GET /api/icons/:name. The device caches
-- the response keyed by name + content_hash, refetches when the hash
-- changes, and renders the bitmap as the inner content of the
-- status-arc avatar.
--
-- bitmap layout: 24 rows of 3 bytes each (24 bits / row, MSB-first
-- per byte) = 72 bytes total. White pixel = 1 (fg, painted in the
-- device's ink colour), black pixel = 0 (transparent).
--
-- format_version is bumped when the byte layout changes so devices
-- can reject incompatible data without parsing it.

CREATE TABLE IF NOT EXISTS icons (
  name           TEXT PRIMARY KEY,            -- lowercase, kebab if any
  format_version INTEGER NOT NULL DEFAULT 1,  -- 1 = 24x24 1-bit bitmap
  width          INTEGER NOT NULL DEFAULT 24,
  height         INTEGER NOT NULL DEFAULT 24,
  bitmap         BLOB NOT NULL,
  content_hash   TEXT NOT NULL,               -- hex SHA-1 of bitmap
  updated_at     INTEGER NOT NULL             -- epoch seconds
);

-- One-shot index: the device's only lookup is by name; no listing
-- query is on the hot path so a primary-key-only index suffices.
