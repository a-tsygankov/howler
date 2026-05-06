# Howler — Session Handoff

> Single-page state-of-the-world. Updated at the end of any session that
> changes phase, adds/removes a tech-stack choice, resolves an open
> question in [`docs/plan.md`](docs/plan.md) §17, or discovers a new risk.
> If this grows past one page it's wrong — move detail into `docs/`.

**Last updated:** 2026-05-06 — Phase 1 step 2 (scheduler + ack) on `dev-1`.

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

Next: **Phase 2 (server + web hardening)** per the reordered §18.
Top of the punchlist:
- Schedule templates (preset rules + user-defined).
- Web push notifications via the PWA service worker.
- Device list + revoke from the SPA.
- Workers Analytics Engine dashboards (cron lag, ack latency).
- Rate-limit the auth endpoints.
- Option B avatars (round photo + urgency ring).

After Phase 2 → **Phase 3** (Playwright happy paths + observability +
the 7-day stability gate). Only then does device firmware (Phase 4+)
become an active surface again.

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
- 2026-05-06 — Phase 1 step 2 (scheduler) on `dev-1`. D1 repos for
  Schedule + Occurrence; pure `computeNextFireAt` (7 unit tests);
  cron-driven fan-out + Queue consumer materialise PENDING rows and
  advance `next_fire_at`. `POST /api/tasks` creates Task + Schedule
  atomically with kind-default rules. New routes `/api/occurrences/
  {pending,/:id/ack}` (idempotent re-ack). Webapp dashboard surfaces
  pending list + create-task form with kind-aware fields.
  20/20 backend tests green. Cron + queue path verified end-to-end
  in prod (ONESHOT now+5 → cron tick → pending → ack).
- 2026-05-06 — Integration tests via `@cloudflare/vitest-pool-workers`.
  9 tests exercise the live Worker (auth, pair+QR end-to-end with
  replay rejection + deviceId mismatch, task RBAC across two users,
  ack idempotency). Migrations applied to in-memory D1 via
  `?raw` SQL imports. **29/29 backend tests green.**
- 2026-05-06 — Webapp CRUD complete-the-loop. `DELETE /api/tasks/:id`
  (soft delete, owner-checked) + Delete buttons on every task; a
  Pair-a-device tile on the dashboard that POSTs `/api/pair/confirm`
  so the SPA can drive the full pair flow without leaving the page.
- 2026-05-06 — Task EDIT. `PATCH /api/tasks/:id` for
  `{title, description, priority, active}` (kind changes still go via
  delete-and-recreate — schedule rebuild is non-trivial). Inline-
  edit row in the dashboard. **30/30 backend tests green** (added
  the PATCH happy-path + non-owner 403).

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
