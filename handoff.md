# Howler — Session Handoff

> Single-page state-of-the-world. Updated at the end of any session that
> changes phase, adds/removes a tech-stack choice, resolves an open
> question in [`docs/plan.md`](docs/plan.md) §17, or discovers a new risk.
> If this grows past one page it's wrong — move detail into `docs/`.

**Last updated:** 2026-05-06 — Phase 1 step 1 (auth) on `dev-1`.

## Live URLs

| | |
| --- | --- |
| Worker | https://howler-api.atsyg-feedme.workers.dev (prod) |
| Pages  | https://howler-webapp.pages.dev (prod) · https://dev-1.howler-webapp.pages.dev (dev-1 preview) |
| D1     | `howler-db` (id `39b29c7a-28b2-4bdf-93cd-bdb9cb031488`) |
| R2     | `howler-firmware`, `howler-avatars` |
| Queue  | `occurrence-fire` (+ DLQ `occurrence-fire-dlq`) |
| Secrets | `AUTH_SECRET` (Worker), `WORKER_ORIGIN` (Pages) |

---

## Current phase + what's next

**Phase 1 step 1 — auth.** PIN + HMAC tokens, transparent accounts,
device pairing, and login-by-QR all landed on `dev-1`. End-to-end
chain (pair → quick-setup → device-token → login-token-create →
login-qr → fresh UserToken) verified against the deployed Worker.
Replay protection, expired tokens, deviceId mismatch, wrong PIN —
all rejected as expected.

Next: Phase 1 step 2 — Schedule + Occurrence repos + Cron + Queue
fan-out (plan §7).

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

- 2026-05-06 — Phase 0 scaffold: monorepo (`backend/`, `webapp/`,
  `firmware/`, `scripts/`); Hono Worker stub with `/api/health` and a
  thin `/api/tasks` end-to-end; drizzle-kit wired with one initial
  migration; Pages Functions `[[path]].ts` proxy; PlatformIO with
  `crowpanel`, `simulator`, `native` envs and a placeholder Unity test;
  CI workflow with path filters mirroring Feedme.
- 2026-05-06 — First deploy live. D1, R2, Queues provisioned;
  `0000_init.sql` applied to remote; Worker + Pages deployed;
  `AUTH_SECRET` set on Worker, `WORKER_ORIGIN` set on Pages.
  End-to-end smoke: `https://howler-webapp.pages.dev/api/health` →
  `{ok:true}` proves the Pages → Functions → Worker → D1 chain.
- 2026-05-06 — Phase 1 step 1 (auth) on `dev-1`. Migration `0001_auth.sql`
  applied to local + remote D1 (rebuilt `users` table to add
  `username` + relax `email/display_name` to nullable; added
  `pending_pairings`, `login_qr_tokens`, `auth_logs`). Auth primitives
  (PBKDF2 PIN + HMAC user/device tokens), Hono middleware, and
  routes for `/api/auth/{setup,login,me,logout,set-pin,quick-setup,
  login-token-create,login-qr}` + `/api/pair/{start,check,confirm}`.
  `/api/tasks` no longer accepts `X-User-Id`; Bearer token required.
  Webapp adds Quick-start / Log in / Sign up tabs and a `?token=&deviceId=`
  QR-landing path. 13/13 unit tests pass; full pair+QR chain verified
  against prod Worker.

## Open questions (synced with plan §17)

| # | Risk | Status |
| --- | --- | --- |
| 1 | Device ↔ server HIL strategy | **Decided.** HIL-1 + HIL-2 (Wokwi) on every PR; HIL-3 nightly + on `release/*`. |
| 2 | Dial flash budget for LVGL 9 + assets + dual OTA | **Open.** Profile during Phase 1 once firmware has real screens. |
| 3 | Schedule rule schema may calcify (JSON column) | **Open.** Mitigated by Zod + a `version` field on rules. |
| 4 | MQTT bridge is a non-Cloudflare component | **Deferred to Phase 3.** |
| 5 | AI bg-removal quality on user photos | **Deferred to Phase 5.** Ship Option B (round + ring) first. |
| 6 | DST edges on "every 3 days" tasks | **Open.** Test plan: store schedules in user TZ, materialize occurrences in UTC. |
| 7 | Lost vs duplicate ack | **Designed.** Idempotency key on every device write; `INSERT OR IGNORE`. |
| 8 | Bootloop after bad OTA | **Designed.** ESP-IDF pending-verify + auto-rollback (plan §14). |
| 9 | D1 write-throughput ceiling | **Accepted for now.** Migration path to Hyperdrive + Postgres documented. |
| 10 | Workers CPU-time on Cron fan-out | **Designed.** Cron enqueues immediately; per-occurrence work runs in Queue consumer. |

## Anything blocked

- _(none — Phase 0 is unblocked.)_

---

## Pointer to the plan

The architecture, data model, sequence diagrams, and phased roadmap all
live in [`docs/plan.md`](docs/plan.md). Treat this `handoff.md` as a
**state log**, not a spec — when you find yourself explaining *why*
something is the way it is for more than two lines, that explanation
belongs in `docs/plan.md`.
