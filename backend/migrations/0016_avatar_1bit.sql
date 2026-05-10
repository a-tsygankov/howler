-- Phase 7: 1-bit avatar variant for the device renderer.
--
-- The device's IconCache renders 24×24 1-bit bitmaps from the
-- `icons` table for preset glyphs (icon:paw, icon:broom, …). For
-- uploaded photos we currently fall back to two-letter initials —
-- coherent but visually less rich. With PR #45's client-side
-- processing pipeline the cost of generating a per-photo 1-bit
-- variant is one Floyd-Steinberg dither pass + 72 bytes uploaded
-- alongside the WebP.
--
-- Schema additions:
--   bitmap_1bit              72 bytes (24×24 / 8). MSB-first per
--                            byte, white = 1 (foreground), black = 0
--                            (transparent). Identical layout to the
--                            `icons` table — see migration 0010.
--   bitmap_1bit_hash         hex SHA-1 of the bytes. Powers ETag
--                            on /api/avatars/:id?format=1bit so the
--                            device can short to 304 when its cache
--                            is current.
--   bitmap_1bit_format_ver   bumps when the byte layout changes so
--                            devices reject incompatible data.

ALTER TABLE avatars ADD COLUMN bitmap_1bit BLOB;
ALTER TABLE avatars ADD COLUMN bitmap_1bit_hash TEXT;
ALTER TABLE avatars ADD COLUMN bitmap_1bit_format_version INTEGER;
