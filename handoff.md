# Howler — Session Handoff

> Single-page state-of-the-world. Updated at the end of any session that
> changes phase, adds/removes a tech-stack choice, resolves an open
> question in [`docs/plan.md`](docs/plan.md) §17, or discovers a new risk.
> If this grows past one page it's wrong — move detail into `docs/`.

**Last updated:** 2026-05-10 — through PR #46 (Phase 7 1-bit photo avatar variant). Two completed arcs this stretch: **OTA Phase 6** end-to-end except HIL-3 hardware verification, and **avatars** unified across all four entity surfaces (home / users / tasks / labels) on all three layers. Tests at backend 138 + firmware native 124. No open PRs.

**Phase 6 OTA — fully shipped except HIL-3 hardware verification.** Seven PRs across six slices: F0 (foundation, dev-22) ✅ · F1 admin write (#34) ✅ · F2 CI signed-build pipeline (#37) ✅ · F3 pre-signed R2 URL minting (#35) ✅ · F4 firmware self-update via `esp_https_ota` (#38) ✅ · F5 cancel-rollback hook (#38) + server-side observability + admin UI (#41) ✅. The dial polls `/api/firmware/check`, follows a 5-min pre-signed R2 URL with `esp_https_ota`, streams SHA-256 over the inactive partition, swaps slot only on digest match, then `markValid()`s on the first successful sync round so the bootloader cancels its pending-verify rollback. Admins operate releases from `/settings/firmware` (promote / yank / fleet health). Still pending: HIL-3 verification on a real CrowPanel; Workers Analytics Engine binding (commented in `wrangler.toml`, activates when CF account enables AE).

**Per-user admin model (#36).** Migration 0014 adds `users.is_admin`. The OTA admin gate is now per-user, not the F1 stub `ADMIN_HOMES` env-var. `/api/auth/me` surfaces `isAdmin` so the webapp gates the firmware admin tile.

**Avatars — fully unified across home / users / tasks / labels, on all three layers.** Five PRs in this arc:

- **#40** — activated photo upload in webapp for users + tasks + home; added `AvatarUploadButton`; rendered user avatars on the device's UserPicker via `RoundMenu` centre-slot badges. Added 15 backend integration tests + 5 firmware native tests for the unified `avatar_id` schema.
- **#42** — extended to labels via migration 0015 (`labels.avatar_id`, unified on `'icon:<name>'` / UUID format); added `GET /api/homes/me` so the device fetches home identity for the Settings → About title row.
- **#44** — closed three webapp surfaces that ignored user avatars: TaskDetail execution history, CompleteTaskSheet "Completed by" picker (now an avatar-chip row, not a `<select>`), Dashboard header (the user's avatar IS the logout button).
- **#45** — client-side avatar editor (Strategy C). All processing lives in the browser: decode → optional bg-removal via `@imgly/background-removal` (lazy-loaded WASM + ~24 MB ML model) → 512×512 WebP encode. The Worker just stores the small WebP. EXIF stripped as a side effect. PWA install footprint ~470 KB; the bg-removal bundle lazy-loads only when toggled.
- **#46** — **Phase 7**: 1-bit photo avatar variant for the device. Browser-side Floyd-Steinberg dither at 24×24 (~5 ms, no WASM) produces a 72-byte bitmap alongside the WebP. Migration 0016 adds `avatars.bitmap_1bit` columns; `GET /api/avatars/:id?format=1bit` serves the bytes; firmware's `iconKeyFromAvatar` (extracted to `domain/AvatarKey.h`) now returns 32-hex UUIDs verbatim, and `WifiNetwork::fetchIcon` routes UUID-shaped keys to the avatar endpoint instead of the icons endpoint. Photos uploaded by users now render as proper bitmaps on the dial — no more text-initials fallback. 10 new native tests lock the routing contract.

**PWA polish (#39, #43).** Generated favicon + apple-touch-icon + maskable PWA icons from `docs/assets/howler-icon-source.png`. Settings → "Install on your phone" tile catches `beforeinstallprompt` on Android Chrome / Edge for one-tap install; iOS gets a step-by-step "Share → Add to Home Screen" sheet with the inline Share glyph SVG. **#43** also extracted the SQL migration splitter into `test/helpers/migrations.ts` (was duplicated across 4 test files), tightened pre-upload validation in `AvatarUploadButton`, and replaced the right-click clear on `HomeAvatarTile` with a visible × button.

**PWA polish (#39).** Generated favicon + apple-touch-icon + maskable PWA icons from `docs/assets/howler-icon-source.png`. Settings → "Install on your phone" tile catches `beforeinstallprompt` on Android Chrome / Edge for one-tap install; iOS gets a step-by-step "Share → Add to Home Screen" sheet with the inline Share glyph SVG.

**Sync slice A (peek-then-fetch) + slice B (local urgency on device).** Shipped in #29 + #30. Migration `0012_update_counter.sql` adds `homes.update_counter` + 24 triggers; `GET /api/homes/peek` returns `{counter}`; idle rounds skip the four data fetches when the counter is unchanged. `firmware/src/domain/Urgency.h` is a header-only port of `services/urgency.ts`; `DashboardModel::refreshUrgency(nowSec)` recomputes urgency labels every ~30 s so they track the clock without re-fetching. `SyncService.fullRefreshMs_` is now 1 h — counter peek is authoritative on the hot path.

**Earlier dev-cycles** (full chronology in `git log`): dev-16 MVP. dev-21 LED ring + MarqueeLabel. dev-22 DrumScroller + icon storage. dev-23 icon-cache rendering polish. dev-24 detail card redesign. dev-25 offline degraded mode + CVD redundancy. dev-26 dashboard polish (3-card drum). dev-27 bottom bar + all-tasks index. dev-28 device-screen trust + sync slice A. dev-29 sync slice B. dev-31 N×N task lookup fix. dev-32 device-token auth fix on `/users` + `/task-results` (result picker was empty). dev-33 DrumScroller n=2 duplicate-rendering fix.

Phase 5 deferred items: HiveMQ MQTT broker + bridge service, MQTT adapter behind a feature flag (the `INetwork` abstraction makes the REST → MQTT swap a one-adapter change when ready).

## Live URLs

| | |
| --- | --- |
| Worker | https://howler-api.atsyg-feedme.workers.dev (prod) |
| Pages  | https://howler-webapp.pages.dev (prod) · https://dev-1.howler-webapp.pages.dev (dev-1) · https://dev-2.howler-webapp.pages.dev (dev-2) |
| D1     | `howler-db` (id `39b29c7a-28b2-4bdf-93cd-bdb9cb031488`) |
| R2     | `howler-firmware`, `howler-avatars` |
| Queue  | `occurrence-fire` (+ DLQ `occurrence-fire-dlq`) |
| Secrets | `AUTH_SECRET` (Worker), `WORKER_ORIGIN` (Pages) |

---

## Current phase + what's next

**Roadmap reordered (plan §1.1 / §18, 2026-05-06).** Phases 1–3 are
now server + webapp only; device firmware work is deferred to
Phase 4, which gates on the web stack being demo-ready and bug-quiet
for a week. The firmware skeleton stays in CI so architectural
breakage gets caught early; no active firmware development until
the gate is met.

**Data model pivot (plan §6, 2026-05-06).** Howler is now home-centric:
**HOME** is the auth realm and contains multiple **USER**s, **DEVICE**s,
**LABEL**s, and tasks. Each task can be assigned to one or more users
(via `task_assignments` join), can be private, can carry an optional
label, and can opt into a numeric **TASK_RESULT** type (Pushups,
Grams, Rating, …). Acking an occurrence writes a row to the new
**append-only `task_executions`** log with a denormalized snapshot of
label + unit, so dashboards can run aggregates (avg daily grams,
weekly pushups) without joins that break when types or labels change.
Migration `0002_home.sql` rebuilds the affected tables (no real prod
data yet) and seeds five default TaskResult types per home. Token
claims grow a `homeId`. Login + QR exchange add a user-picker step
(`/api/auth/select-user`). See §6.1 for the migration outline, §6.2
for the new auth flow, §6.3 for the **10** design defaults I'm ready
to commit to unless overridden, §6.4 for the seeded TaskResult
templates, §6.5 for append-only semantics.

**This rework is now Phase 2's first item** — everything else in
Phase 2 (templates, web push, observability, avatars) builds on the
new schema, so it ships before any of them.

---

**Phase 1 steps 1 + 2 landed on `dev-1`.**

Step 1 — auth: PIN + HMAC tokens (UserToken 30 d, DeviceToken 365 d),
transparent accounts, device pairing, login-by-QR. End-to-end chain
(pair → quick-setup → device-token → login-token-create → login-qr →
fresh UserToken) verified against the deployed Worker. Replay /
expired / wrong-secret / deviceId-mismatch / wrong-pin all rejected.

Step 2 — scheduler: Schedule + Occurrence repos filled (specs:
OwnedBy, ForTask, DueBefore, PendingForUser); pure
`computeNextFireAt` for DAILY / PERIODIC / ONESHOT; cron `* * * * *`
fans schedules onto `OCCURRENCE_QUEUE`; queue consumer materialises
`PENDING` occurrences and advances `next_fire_at`. Smoke-tested in
prod: ONESHOT task with `deadlineHint = now + 5s` → next cron tick →
`/api/occurrences/pending` returned the materialised row → `/ack`
flipped it to ACKED → replay was idempotent.

Webapp: full dashboard at https://dev-1.howler-webapp.pages.dev with
tabs for Quick-start / Log in / Sign up, the QR-landing path, a
pending-occurrences list with Done buttons, and a kind-aware
create-task form (DAILY times / PERIODIC interval / ONESHOT remind-in).

**Phase 2 status (per plan §18):**

- ✅ 2.0 home-centric model rework
- ✅ 2.1 users CRUD (add/rename/remove + private-task cleanup)
- ✅ 2.2 device list + revoke
- ✅ 2.3 rate-limiting on /setup, /login, /login-qr, /quick-setup, /pair/confirm
- ✅ 2.4 schedule templates (5 seeded per home; tasks accept templateId)
- ✅ 2.5 Option B avatars (R2 uploader + home avatar in dashboard)
- ✅ 2.6 web push **plumbing** — endpoints, table, SW, permission flow
- ✅ 2.6b web push **delivery** — VAPID JWT (RFC 8292, ES256) +
  AES128GCM payload encryption (RFC 8291) implemented in
  `services/push.ts` with `crypto.subtle`. `consumeFireQueue` calls
  `dispatchPushForOccurrence` which fans out per-subscription. Dead
  subscriptions tombstone on 404/410. VAPID keypair generated with
  `node scripts/gen-vapid.mjs`; public key in `wrangler.toml [vars]`,
  private uploaded as Worker secret.
- ✅ 2.7 Workers Analytics Engine — `observability.ts` instruments
  cron lag, ack latency, auth events, and push delivery; binding is
  commented out in `wrangler.toml` because the account doesn't have
  Analytics Engine enabled yet (one dashboard click + uncomment +
  redeploy and dashboards light up). SQL queries for the standard
  dashboards are documented in `docs/observability.md`.

**Phase 3 status:**

- ✅ 3.1 Playwright `webapp/e2e/happy-path.spec.ts` — 3 tests (API
  health, login screen, quick-setup → dashboard → create task);
  `pnpm --filter howler-webapp test:e2e` runs them; `E2E_BASE_URL`
  overrides target.
- ✅ 3.2 CSP + HSTS + X-Frame-Options + Referrer-Policy +
  Permissions-Policy on every Pages response via
  `webapp/functions/_middleware.ts`.
- ✅ 3.3 Structured JSON logs (`backend/src/logger.ts`) on every
  request, cron tick, queue error.
- ✅ 3.4 SLO targets + Logpush setup recipe in `docs/observability.md`.
- ✅ 3.5 CI runs Playwright on every webapp-touching PR
  (`.github/workflows/deploy.yml` `webapp-e2e` job).

**Phase 4 status (per plan §18):**

- ✅ domain + application + adapters layout (firmware/src/)
- ✅ real WifiNetwork over HTTPS (dashboard / users / result-types /
  occurrences/pending / occurrences/:id/ack / tasks/:id/complete /
  heartbeat) + WifiPairApi for the unauthenticated pair endpoints
- ✅ NVS-persisted device token; pick `WifiNetwork` vs `NoopNetwork`
  based on token presence at boot
- ✅ /api/pair/start flow runs on the dial — PairCoordinator owns
  the state machine, persists the token on confirm, swings the
  router to Dashboard
- ✅ Pending-list polling via SyncService (dashboard + users +
  result-types + legacy /occurrences/pending)
- ✅ Mark-done with optional result + user picker, offline-tolerant
  outbound queue persisted to NVS via TLV serialization, idempotent
  on the server's PRIMARY KEY for `task_executions`
- ✅ HIL-1 (native): 40 host-side Unity tests across `test_domain`
  (DashboardModel, MarkDoneQueue, Router, RotaryNav, ResultType,
  OccurrenceList) and `test_application` (SyncService, MarkDoneService,
  PairCoordinator, App boot routing + commit-pending-done + Wi-Fi)
- ✅ HIL-2 (Wokwi): `firmware-hil2` job in `deploy.yml` runs the
  simulator in wokwi-cli, asserts `[howler] boot ok` in serial.
  Gated on `WOKWI_CLI_TOKEN` secret being set; a missing secret
  emits a CI warning instead of failing.
- 🔵 HIL-3 (real CrowPanel) — deferred to release/* gating; needs
  attached hardware on a self-hosted runner

**Next:** the obvious open items, in rough priority order:

1. **Apply pending migrations to remote D1.** `0012_update_counter.sql` (slice A), `0013_firmware_releases.sql` (Phase 6), `0014_user_admin.sql` (per-user admin), `0015_label_avatars.sql` (labels), and `0016_avatar_1bit.sql` (Phase 7) all need `pnpm dlx wrangler d1 migrations apply howler-db --remote` from `backend/`. The `deploy.yml` workflow runs this on every main merge, so each migration applies the next time someone merges with the workflow green.
2. **HIL-3 hardware verification of OTA F4 + F5** — blocked on a physical CrowPanel + a self-hosted runner. Promote a known-bad build, confirm the dial flashes it, panics on first boot, and comes up on the previous slot after the bootloader's auto-rollback. Then promote a known-good build and confirm `markValid` clears `PENDING_VERIFY` on the next sync round.
3. **Workers Analytics Engine** — once enabled on the CF account, uncomment the `[[analytics_engine_datasets]]` block in `backend/wrangler.toml` and add heartbeat instrumentation. The current `/api/firmware/health` snapshot (joins `firmware_releases ⨝ devices` on `fw_version`) covers the basic ops view; AE adds time-series for "watch this rollout for the next 6 h".
4. **Self-host @imgly background-removal models in R2** — drops the third-party `staticimgly.com` CSP allowance from `webapp/functions/_middleware.ts`. The package supports a `publicPath` config option; ~50 lines of work (download the small variant's model files + WASM into webapp/public/imgly-models/, set publicPath, drop the CSP entry).
5. **MQTT bridge** (Phase 5 deferred). Non-Cloudflare component (HiveMQ Cloud / AWS IoT / self-hosted Mosquitto) — pick a broker, write the bridge service, swap in an `MqttNetwork` adapter behind a feature flag. The `INetwork` abstraction means the device side is a one-adapter change.
6. **Visual regression baselines** (deferred from Phase 2.8). The bottom-tab nav landed in dev-14, so the gate is met; needs a canonical Linux Chromium run to seed the snapshots.
7. **TaskDetail screen on device** (currently a stub at `firmware/src/screens/screen_task_list.cpp` — never reached, just satisfies the ScreenId enum). Either wire a tap-into-detail path or remove the enum entry. Open question: tap is currently the mark-done activator; adding tap-to-detail would shift the mark-done flow to long-press, which is a UX decision worth discussing before implementing.
8. **Avatar editor B&W + filters** (originally listed as "not now" by the user). The pipeline is structured for it — `resizeAndEncode()` already takes `{ grayscale: true }`; adding a checkbox + filter dropdown is ~30 lines.
9. **Avatar GC** — soft-deleted `avatars` rows leave their R2 blobs behind forever. A scheduled Workers cron task could `LIST` the bucket, intersect with `WHERE is_deleted = 0`, and delete the orphans.

**What's left in Phase 0:**

1. ~~Provision Cloudflare resources.~~ **Done** — D1, R2, Queues, Worker, Pages all live; see "Live URLs" above.
2. ~~Migrations applied.~~ **Done** — `0000_init.sql` applied locally and remotely; tables verified.
3. ~~Verify Wokwi simulator + native tests build.~~ **Done** — `pio test -e native` runs 3 domain tests green; `pio run -e simulator` produces `firmware-merged.bin` (384 KB) at the path `wokwi.toml` references. Pinned LVGL to 9.0.0 + added `scripts/strip_lvgl_simd.py` because PlatformIO's LDF unconditionally compiles LVGL's ARM-SIMD `.S` files on xtensa.
4. Set GitHub repo secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   so [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
   goes green on first push.
5. `AUTH_SECRET` is a 256-bit `openssl rand` value uploaded directly
   to the Worker secret store; only an 8-char prefix was visible in
   chat. Fine for dev. Rotate before real users / external sharing
   via `pnpm dlx wrangler secret put AUTH_SECRET` in `backend/`.

Then **Phase 1 — MVP** per plan §18.

---

## Settled C1–C7 conflicts (plan §20.1)

These were the gates on starting Phase 0. All resolved per the plan's
recommendations; if you disagree, raise it before Phase 1 starts.

| # | Decision | Notes |
| --- | --- | --- |
| C1 | **Hono** for routing | Skeleton in [`backend/src/index.ts`](backend/src/index.ts) — replaces Feedme's pathname chain. |
| C2 | **Drizzle ORM + Repository/UoW** | Schema in [`backend/src/db/schema.ts`](backend/src/db/schema.ts); UoW contracts in [`backend/src/repos/interfaces.ts`](backend/src/repos/interfaces.ts); D1 adapter in [`backend/src/repos/d1/`](backend/src/repos/d1). |
| C3 | **drizzle-kit** + `wrangler d1 migrations apply` | [`backend/drizzle.config.ts`](backend/drizzle.config.ts). No parallel `schema.sql`; no `continue-on-error` on migrations. |
| C4 | **CrowPanel ESP32 Rotary Display 1.28"** | Same hardware as Feedme. Pin map and TFT_eSPI flags inherited verbatim into [`firmware/platformio.ini`](firmware/platformio.ini). Confirm with user before ordering production units. |
| C5 | **LVGL 9** | `platformio.ini` pins `lvgl/lvgl@^9.2`. Encoder API differs from Feedme's 8.4 — adapter shims absorb the change. |
| C6 | **TFT_eSPI + custom adapters**, no M5Unified | M5Unified doesn't apply (not an M5Stack board). Adapter pattern inherited from Feedme. |
| C7 | **PIN + HMAC tokens** (UserToken 30 d, DeviceToken 365 d) | Inherited from Feedme `backend/src/auth.ts`. Implementation deferred to Phase 1. Passkeys remain a Phase 5 polish. |

---

## Recently completed

> Per `plan.md §19`, this is the last ~5 PRs. Older history is in
> `git log` and the plan's "Phase X status" sections.

- 2026-05-09 — **dev-31-result-picker** ([PR #32](https://github.com/a-tsygankov/howler/pull/32), in flight). Three concerns in one PR. (1) Device-token auth fix: `/api/task-results`, `/api/users`, `/api/tasks/:id/complete` all gated everything behind `requireUser()`, so the dial's GETs returned 403 and `resultTypes_` / `users_` stayed empty — making the result picker show "no result type (tap to skip)" and the user picker show only "skip / no attribution" for every type. Each router now uses the loose-at-router / strict-per-mutation pattern; mutations stay user-only. (2) Phase 6 OTA foundation (slice F0): migration `0013_firmware_releases.sql` + Drizzle entry, `GET /api/firmware/check`, `POST /api/devices/heartbeat` (was silently 404'ing — the dial's heartbeat call now lands and returns an `updateAvailable` advisory in the same round-trip), semver-aware version compare, rollout-rules support (`deviceIds` whitelist, `canaryPercent` slice). [`docs/ota.md`](docs/ota.md) tracks slices F1–F5. (3) Round-trip + propagation tests: every seeded result-type's UUID matches across `/api/dashboard` + `/api/task-results`; device-token completions advance the slice-A counter, drop the row from `/pending`, and surface on the webapp's `/api/tasks/:id/executions` view in one round-trip.
- 2026-05-09 — **dev-30-perf** ([PR #31](https://github.com/a-tsygankov/howler/pull/31), merged `54a064b`). Tiny follow-up to slice B — dropped an O(N²) `tasks.find()` inside `dashboard.ts`'s `oneshotDeadline` projection.
- 2026-05-09 — **dev-29** ([PR #30](https://github.com/a-tsygankov/howler/pull/30)). Sync slice B — device computes urgency locally each frame from rule + anchor inputs in the dashboard payload. `services/urgency.ts` ported line-by-line to `firmware/src/domain/Urgency.h`; 22 unit tests mirror the backend's. `DashboardModel::refreshUrgency(nowSec)` drives the per-frame override; `ScreenManager` rebuilds Dashboard / TaskList every ~30 s so labels track the clock. `SyncService.fullRefreshMs_` raised 5 min → 1 h. Tests: backend 70/70, firmware native 83/83 (was 61, +22 urgency).
- 2026-05-09 — **dev-28** ([PR #29](https://github.com/a-tsygankov/howler/pull/29), merged `533e4e2`). Two-theme cycle: device-screen trust polish (8 commits) + sync slice A (peek-then-fetch). About becomes a 1 Hz live diagnostic readout (sync age / RAM / queue / Wi-Fi RSSI + IP); brightness number tracks the arc; OFFLINE / STALE badge on empty paths; sync row gains `err` suffix; "Sync now" toast follows through with synced/failed/offline; Pair screen rebuilds on phase transitions; WifiConnect actually shows "connecting…" while the 12 s blocking call runs. Slice A: migration `0012_update_counter.sql` (column + 24 triggers covering every home-scoped table); `GET /api/homes/peek`; firmware `runRoundIfNeeded()` skips the four fetches on counter equality.
- 2026-05-08 — **dev-27** ([PR #28](https://github.com/a-tsygankov/howler/pull/28), merged `6cafe2d`). Dashboard bottom-bar redesign (left red dots / centre count / right yellow dots; `+` overflow chip). All-tasks `X / N` cursor index. Three-layer dark-theme rim-border fix. About card → 9-row diagnostic readout (`net / wifi / sync / ram / up / queue / theme / dev`).
- 2026-05-08 — **dev-26** ([PR #27](https://github.com/a-tsygankov/howler/pull/27), merged `1a6580d`). Dashboard + TaskList polish: 3-card drum (centre + ±1, dropped ±2 silhouettes), less-contrast minis, bottom-dot tier indicator, tab-strip fit, all-tasks count chip.
- 2026-05-08 — **dev-25** ([PR #26](https://github.com/a-tsygankov/howler/pull/26), merged `2870446`). Phase 5 offline degraded mode (`App::networkHealth()` Fresh / Stale / Offline; OFFLINE / STALE pill on Dashboard + TaskList; cool-blue LED breath when offline; "queued offline" toast on done-animation). CVD redundancy (status-arc avatar ring stroke width per urgency tier — addresses design handoff §13).

## Open questions (synced with plan §17)

| # | Risk | Status |
| --- | --- | --- |
| 1 | Device ↔ server HIL strategy | **Decided.** HIL-1 + HIL-2 (Wokwi) on every PR; HIL-3 nightly + on `release/*`. |
| 2 | Dial flash budget for LVGL 9 + assets + dual OTA | **Open.** Profile during Phase 1 once firmware has real screens. |
| 3 | Schedule rule schema may calcify (JSON column) | **Open.** Mitigated by Zod + a `version` field on rules. |
| 4 | MQTT bridge is a non-Cloudflare component | **Deferred to Phase 5.** Picked up next per the §"Next" pointer. |
| 5 | AI bg-removal quality on user photos | **Deferred to Phase 5.** Ship Option B (round + ring) first. |
| 6 | DST edges on "every 3 days" tasks | **Open.** Test plan: store schedules in user TZ, materialize occurrences in UTC. |
| 7 | Lost vs duplicate ack | **Designed.** Idempotency key on every device write; `INSERT OR IGNORE`. |
| 8 | Bootloop after bad OTA | **Designed.** ESP-IDF pending-verify + auto-rollback (plan §14). |
| 9 | D1 write-throughput ceiling | **Accepted for now.** Migration path to Hyperdrive + Postgres documented. |
| 10 | Workers CPU-time on Cron fan-out | **Designed.** Cron enqueues immediately; per-occurrence work runs in Queue consumer. |

## Anything blocked

- **PR #30 (slice B) merge** is gated on the user applying
  migration `0012_update_counter.sql` to remote D1. The migration
  itself is in `main` (PR #29 merged); the apply was sandbox-denied
  during the slice A session. Run from `backend/`:

  ```bash
  pnpm dlx wrangler d1 migrations apply howler-db --remote
  ```

  Slice B's response shape is additive on top — order is forgiving
  (older device falls back to the snapshot when slice-A fields
  aren't present), but the worker shouldn't deploy slice B without
  slice A's column having landed first.

---

## Pointer to the plan

The architecture, data model, sequence diagrams, and phased roadmap all
live in [`docs/plan.md`](docs/plan.md). Treat this `handoff.md` as a
**state log**, not a spec — when you find yourself explaining *why*
something is the way it is for more than two lines, that explanation
belongs in `docs/plan.md`.
