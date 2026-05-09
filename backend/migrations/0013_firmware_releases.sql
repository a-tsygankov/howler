-- Phase 6 OTA — firmware release manifest table.
--
-- Each row is one signed firmware build, ready to roll out. The
-- bytes themselves live in R2 (`howler-firmware`) — not in D1 —
-- because D1 has a 100 KB row size limit and a typical Howler
-- firmware-merged.bin is ~1.4 MB. The table stores only the
-- pointer + cryptographic identity + rollout-control metadata.
--
-- Wire shape (per docs/plan.md §14):
--   1. CI builds + signs (RSA-3072) → uploads to R2.
--   2. CI POSTs /api/firmware (admin path, NYI in this PR) which
--      INSERTs a firmware_releases row.
--   3. Device hits GET /api/firmware/check?fwVersion=X with its
--      DeviceToken. Worker selects the highest-versioned active
--      release whose rollout rules match this device, mints a
--      pre-signed R2 URL with a short TTL, and returns the manifest.
--   4. Device verifies signature + sha256, swaps boot partition,
--      reboots, heartbeats with the new version on first boot.
--
-- This migration carries the table only — endpoints + signing
-- pipeline land separately. See docs/ota.md for the work checklist.

CREATE TABLE firmware_releases (
  -- Semver string ("1.4.2"). Validated server-side before INSERT.
  -- Used for `>` comparison on the device's reported version, so
  -- the canonical sort order MUST be a pure-numeric component-
  -- wise compare; the API enforces that on write.
  version       TEXT PRIMARY KEY,

  -- SHA-256 of the unsigned firmware-merged.bin (lowercase hex,
  -- 64 chars). Device verifies this against the bytes it
  -- downloaded BEFORE flashing.
  sha256        TEXT NOT NULL,

  -- R2 object key, e.g. "firmware/firmware-1.4.2.bin". The
  -- Worker reads this to mint a pre-signed URL on /firmware/check.
  -- Bucket is `howler-firmware`, provisioned in Phase 0.
  r2_key        TEXT NOT NULL,

  -- File size in bytes — the device pre-allocates the OTA
  -- partition slot up to this size and rejects on mismatch.
  size_bytes    INTEGER NOT NULL,

  -- Rollout control. NULL = "ship to everyone" (the default for
  -- now). Future: a JSON object like `{"deviceIds": [...]}`,
  -- `{"homeIds": [...]}`, or `{"canaryPercent": 5}` so the same
  -- table backs both per-device pinning + canary deployment
  -- without a schema change. The check endpoint parses + applies
  -- it; the column type stays opaque text.
  rollout_rules TEXT,

  -- 1 = available to devices via /firmware/check. 0 = uploaded
  -- but not yet promoted (or yanked because of a bad rollout).
  -- Lets CI publish a manifest behind a flag and ship it later.
  active        INTEGER NOT NULL DEFAULT 0,

  -- Operations metadata. created_at = first INSERT;
  -- promoted_at = when active flipped to 1 (NULL while inactive).
  -- yanked_at = when active flipped 1→0 (NULL otherwise). The
  -- triple gives a clean audit trail without a separate log table.
  created_at    INTEGER NOT NULL,
  promoted_at   INTEGER,
  yanked_at     INTEGER
);

-- Hot path: /firmware/check looks up "highest active version >
-- device's current version". The (active, version) index serves
-- both the active-only filter and the version sort.
CREATE INDEX firmware_releases_active_version_idx
  ON firmware_releases(active, version);
