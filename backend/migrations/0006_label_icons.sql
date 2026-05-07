-- Phase B / m-2026-05-06: labels gain an icon name pulled from the
-- frontend's Icon Set A barrel (paw / broom / heart / briefcase /
-- plant / pill / bowl / bell / clock / etc — see
-- webapp/src/components/Icon.tsx for the full enum).
--
-- The default labels seeded on home creation get an opinionated
-- icon mapping; custom labels can pick any name from the set or
-- leave it null (UI will then fall back to initials).

ALTER TABLE labels ADD COLUMN icon TEXT;

-- Backfill the four default labels (system=1) on every existing
-- home. Custom labels stay as-is — null icon, fallback initials.
UPDATE labels SET icon = 'paw'       WHERE system = 1 AND display_name = 'Pets';
UPDATE labels SET icon = 'broom'     WHERE system = 1 AND display_name = 'Chores';
UPDATE labels SET icon = 'heart'     WHERE system = 1 AND display_name = 'Personal';
UPDATE labels SET icon = 'briefcase' WHERE system = 1 AND display_name = 'Work';
