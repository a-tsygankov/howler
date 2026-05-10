# OTA — design + work checklist

Phase 6 per [`plan.md §14`](plan.md#14-ota-updates). End state: signed
firmware images on R2, dual-app OTA partition layout on the dial,
`esp_https_ota` self-update with pending-verify + auto-rollback,
manifests served by the Worker.

This doc tracks both the **target design** and the **slice-by-slice
implementation plan**. The `dev-31-result-picker` PR lays the
backend read path; everything below it is still to do.

---

## Status — slices F0 + F1 + F2 + F3 (foundation + admin + signed-build CI + presigning)

| | |
| --- | --- |
| Migration `0013_firmware_releases.sql` | ✅ F0 |
| Drizzle schema (`firmwareReleases`) | ✅ F0 |
| `GET /api/firmware/check?fwVersion=X` | ✅ F0 + F3 (now returns `downloadUrl`) |
| `POST /api/devices/heartbeat {fwVersion}` | ✅ F0 |
| Semver-aware version compare | ✅ F0 |
| Rollout rules (`deviceIds` + `canaryPercent`) | ✅ F0 |
| `requireAdmin()` middleware + `ADMIN_HOMES` env | ✅ F1 |
| `POST /api/firmware` (admin upload-manifest) | ✅ F1 |
| `PATCH /api/firmware/:version` | ✅ F1 |
| `GET /api/firmware` (admin listing) | ✅ F1 |
| SigV4 R2 presigner (`backend/src/services/r2-presign.ts`) | ✅ F3 — manual `crypto.subtle`, no AWS SDK in the Worker bundle |
| `firmware-release.yml` workflow + signing scripts | ✅ F2 — RSA-3072 detached signature, R2 upload, manifest register on `release/v*` push |
| Tests | ✅ — backend 104/104 (across F0 + F1 + F3); firmware 91/91 |

The shape is intentionally additive — old clients ignore the new
endpoints; `firmware_releases` is empty until something INSERTs a
release row, so deploying these slices has zero behavioural change
for production until a build is uploaded + promoted.

**Operational gate.** The admin allow-list is the comma-separated
`ADMIN_HOMES` env var. Empty string = nobody is admin (the safe
default). Set in production via `wrangler secret put ADMIN_HOMES`
with the home id of whoever runs the OTA console — there's no
first-class admin role yet, so this is the F1 placeholder per the
"slice gates" pattern from earlier in this doc.

---

## Sequence diagram (target end-state)

Mirrors `plan.md §14`'s mermaid diagram; pinned here so the next
slices can refer to it without sprawling the plan doc.

```mermaid
sequenceDiagram
  autonumber
  participant CI as CI
  participant R2 as R2 (howler-firmware)
  participant W as Worker
  participant DB as D1
  participant D as Dial
  participant BL as Bootloader

  Note over CI: F2 — signed build pipeline
  CI->>CI: build firmware-X.Y.Z.bin + RSA-3072 sign
  CI->>R2: PUT firmware-X.Y.Z.bin + .sig
  CI->>W: POST /api/firmware (admin) — INSERT row, active=0

  Note over W,DB: F3 — promote (manual, gated)
  W->>DB: UPDATE firmware_releases SET active=1, promoted_at=now

  Note over D,W: F0 — landed in this PR
  D->>W: POST /devices/heartbeat {fwVersion: 0.3.0}
  W->>DB: SELECT highest active release > 0.3.0
  W-->>D: { ok, updateAvailable: true, version, sha256, sizeBytes }

  Note over D,R2: F4 — device flash (esp_https_ota)
  D->>W: GET /firmware/check?fwVersion=0.3.0
  W->>R2: createPresignedUrl(r2Key, ttl=5m)
  W-->>D: { downloadUrl, sha256 }
  D->>R2: GET <pre-signed URL>
  R2-->>D: bytes
  D->>D: verify RSA + sha256 → swap boot partition → reboot

  Note over D,W: F5 — pending-verify
  D->>W: POST /devices/heartbeat {fwVersion: X.Y.Z}
  W-->>D: 200
  D->>BL: esp_ota_mark_app_valid_cancel_rollback()
  Note over D,BL: no heartbeat before next reset → bootloader rolls back
```

---

## Remaining work — slice F1…F5

Each slice is a separate PR. They can land in order; later slices
gate on earlier ones being live in production.

### F1 — admin POST `/api/firmware` ✅ (landed in dev-33-ota-f1-admin)

Implemented per the original plan; see the status table above.
Three handlers under one router:

- `POST /api/firmware` — zod-validated body, version regex
  rejects `"1.4.0; DROP TABLE …"`, idempotent on duplicate
  version (409), lands `active=0`.
- `PATCH /api/firmware/:version` — promote (sets `promoted_at`
  on first promotion, preserves it across re-promotes), yank
  (sets `yanked_at`), or update `rolloutRules` in place.
- `GET /api/firmware` — admin-only listing for the ops UI.

`requireAdmin()` consults `ADMIN_HOMES` (comma-separated home
IDs, env var). Empty list = nobody is admin (fail-closed).

### F2 — CI signed-build pipeline ✅ (landed in dev-35-ota-f2-signed-build)

[`.github/workflows/firmware-release.yml`](../.github/workflows/firmware-release.yml)
runs on push to `release/v*` or via manual `workflow_dispatch`.
Six steps in one job:

1. Resolve version from branch name (`release/v0.4.0` → `0.4.0`)
   or workflow_dispatch input. Validates against the same regex
   `POST /api/firmware` enforces.
2. Materialise `OTA_SIGNING_KEY` secret into a temp PEM.
3. Embed the public key into the firmware build via
   [`firmware/scripts/embed-pubkey.py`](../firmware/scripts/embed-pubkey.py).
4. `pio run -e crowpanel` → `firmware-merged.bin`.
5. Sign with RSA-3072 / SHA-256 / PKCS#1 v1.5 via
   [`firmware/scripts/sign-firmware.sh`](../firmware/scripts/sign-firmware.sh) —
   produces `<bin>.sha256` + `<bin>.sig`.
6. Upload `.bin` + `.sig` + `.sha256` to R2 via wrangler.
7. Register the manifest via
   [`firmware/scripts/register-firmware.sh`](../firmware/scripts/register-firmware.sh) →
   `POST /api/firmware` with `OTA_ADMIN_USER_TOKEN`. Lands as
   `active = 0`.

Promotion is **not** part of the workflow — a half-baked build
that survives CI tests can still be yanked before any device sees
it. The release-engineer manually:

```bash
curl -X PATCH https://howler-api.atsyg-feedme.workers.dev/api/firmware/$VERSION \
  -H "Authorization: Bearer $OTA_ADMIN_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"active":true}'
```

#### Bootstrap — operator one-shot setup

```bash
# 1. Generate the RSA-3072 keypair (locally, NOT in CI)
bash firmware/scripts/generate-signing-key.sh

# 2. Push the private key to GitHub Actions secrets
gh secret set OTA_SIGNING_KEY < firmware/scripts/secrets/signing-key.pem

# 3. Mint an admin UserToken (any user with users.is_admin = 1
#    after migration 0014). Easiest path: call
#    /api/auth/me from the webapp, copy the JWT.
gh secret set OTA_ADMIN_USER_TOKEN

# 4. (CLOUDFLARE_API_KEY + CLOUDFLARE_ACCOUNT_ID already exist
#    from the regular deploy.yml — reused here for R2 uploads.)
```

Required GitHub secrets summary:

| Secret | Source | Used in |
| --- | --- | --- |
| `OTA_SIGNING_KEY` | local `generate-signing-key.sh` | sign step |
| `OTA_ADMIN_USER_TOKEN` | webapp `/api/auth/me` | register step |
| `CLOUDFLARE_API_KEY` | already exists | R2 upload |
| `CLOUDFLARE_ACCOUNT_ID` | already exists | R2 upload |

#### Releasing v0.4.0 (typical flow)

```bash
git checkout -b release/v0.4.0
# bump kFirmwareVersion in firmware/src/application/Version.h
# write release notes if applicable
git push origin release/v0.4.0
# CI builds + signs + uploads + registers as active=0
# Inspect via GET /api/firmware (admin token), then PATCH active=true
```

#### Why detached signature, not full Secure Boot v2?

ESP-IDF's `CONFIG_SECURE_SIGNED_APPS_RSA_SCHEME` (plan §14) is the
end-state target — bootloader-level signature verification with
hardware fuse-locked public keys. F2 ships the simpler shape:
detached `.sig` file alongside the bin, app-level verification on
download in F4. Same RSA-3072 keypair works for both; tightening
to bootloader-level verification later doesn't require a key
rotation. The transition path is documented in
[`firmware/scripts/sign-firmware.sh`](../firmware/scripts/sign-firmware.sh).

### F3 — Pre-signed URL minting ✅ (landed in dev-34-ota-f3-presigned)

Manual SigV4 implementation in
[`backend/src/services/r2-presign.ts`](../backend/src/services/r2-presign.ts) —
`crypto.subtle` HMAC-SHA256 chain, ~150 lines, no AWS SDK
dependency. Same pattern `services/push.ts` uses for VAPID JWT
signing — keeps the Worker bundle small.

`/api/firmware/check` now returns a 5-min `downloadUrl`
alongside the existing `r2Key`. URL shape:
`https://<account>.r2.cloudflarestorage.com/howler-firmware/<key>?X-Amz-…`.
The dial follows the URL directly — no Cloudflare auth at the R2
edge, the V4 signature carries read-permission for the duration.

Falls back to `downloadUrl: null` (with `r2Key` still present) when
any of the three R2 secrets are missing — staging without R2 API
creds keeps working, just no direct download.

Operator setup:

```bash
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

Generate the access key in the Cloudflare dashboard under
R2 → Manage R2 API Tokens, scoped read-only on `howler-firmware`.

### F4 — Firmware self-update (large, ~1 week, hardware required)

- New PlatformIO env or build flag for `esp_https_ota`-based update
  flow. ESP-IDF component already vendored as part of Arduino-ESP32.
- Partition table: `factory + ota_0 + ota_1 + otadata` (8 MB flash
  has room — current `partitions/default_16MB.csv` already specs
  this; no migration needed).
- New `IOtaPort` / `EspOtaAdapter` pair in
  `firmware/src/{application,adapters}/`. Exposed methods:
  - `checkForUpdate(currentVersion) → optional<UpdateAdvisory>`
  - `downloadAndFlash(advisory) → bool` (verifies signature + sha256
    before swapping boot partition).
- Driven from the heartbeat callback when `updateAvailable: true`
  lands. Settings → "Check for updates" tile triggers the same path
  on demand.
- Hardware-only test: HIL-3 on a real CrowPanel — flash a v0.3.x,
  promote v0.3.x+1, observe the swap + first-boot heartbeat.

### F5 — Pending-verify + auto-rollback (small once F4 lands)

- After flash, mark new image `pending_verify`
  (`esp_ota_mark_app_valid_cancel_rollback` deferred).
- On first successful sync round (or heartbeat 200 — whichever the
  device sees first), call `cancel_rollback`.
- If the dial reboots before that lands, the bootloader auto-falls-
  back to the previous slot.
- Server-side observability: log heartbeat events with their
  `fwVersion` and dashboard the per-version success rate. If a
  release shows <90 % success across the first 100 devices, an
  on-call human flips `active = 0` (the F1 endpoint already
  supports this).

---

## Things explicitly NOT in scope

- **Mandatory updates / forced reboots** — every install path
  here is opportunistic. The dial picks up the new build on next
  natural boot or via Settings → "Check for updates"; we never
  reboot the user out from under their workflow.
- **Delta updates** — full image only. Howler firmware is
  ≤ 2 MB; the bandwidth saving doesn't justify the binary-diff
  toolchain complexity. Revisit if the image grows past ~8 MB.
- **A/B blue-green at the dial** — the dual-partition layout IS A/B,
  but there's no "live both copies in parallel" idea. Slot 0 is
  active, slot 1 is staging until promoted by reboot.

---

## Operational notes (post-F2)

**Releasing.** `git tag v1.4.2 && git push --tags` triggers the F2
job. The release lands `active = 0`. Promote via:

```bash
curl -X PATCH https://howler-api.atsyg-feedme.workers.dev/api/firmware/1.4.2 \
  -H "Authorization: Bearer <admin-user-token>" \
  -H "Content-Type: application/json" \
  -d '{"active": true, "rolloutRules": {"canaryPercent": 5}}'
```

5 % canary → watch heartbeat success → promote to 100 % by
PATCHing `rolloutRules: null`. **Yank** by PATCHing `active: false`
(the `yanked_at` column gives a clean audit trail).

**Rollback.** If a yanked build is already on a device, that
device keeps it (the bootloader has no concept of "the server
yanked this version"). To force a downgrade, ship a new build with
a higher version number that contains the old code. Don't try to
rewind versions in `firmware_releases` — version is the primary key.
