# Howler — Session Handoff

> Single-page state-of-the-world. Updated at the end of any session that
> changes phase, adds/removes a tech-stack choice, resolves an open
> question in [`docs/plan.md`](docs/plan.md) §17, or discovers a new risk.
> If this grows past one page it's wrong — move detail into `docs/`.

**Last updated:** 2026-05-06 — initial Phase 0 scaffold.

---

## Current phase + what's next

**Phase 0 — Scaffolding.** Goal: green CI on a monorepo skeleton with
all bindings declared, the Pages → Worker proxy wired, drizzle-kit
migrations producing real SQL, and the firmware `domain/application/adapters`
layout ready to take its first port.

**What's left in Phase 0:**

1. Provision Cloudflare resources (`wrangler d1 create howler-db`,
   `wrangler r2 bucket create howler-firmware` and `howler-avatars`,
   `wrangler queues create occurrence-fire`). Paste IDs into
   [`backend/wrangler.toml`](backend/wrangler.toml).
2. Install deps and run a real `pnpm db:migrate:local` to confirm the
   drizzle-kit pipeline works end-to-end.
3. Verify Wokwi simulator boots the firmware skeleton and the native
   env runs the placeholder Unity test.
4. Set GitHub repo secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   so [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
   goes green on first push.

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

- **Cloudflare account provisioning.** Until `wrangler d1 create howler-db`
  is run and the database id is pasted into `backend/wrangler.toml`,
  `pnpm dev:backend` will not bind D1. Owner: user.
- **GitHub Actions secrets.** `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` must be set on the repo before main-branch
  pushes auto-deploy. Owner: user.

---

## Pointer to the plan

The architecture, data model, sequence diagrams, and phased roadmap all
live in [`docs/plan.md`](docs/plan.md). Treat this `handoff.md` as a
**state log**, not a spec — when you find yourself explaining *why*
something is the way it is for more than two lines, that explanation
belongs in `docs/plan.md`.
