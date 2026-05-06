# Howler

A general-purpose task tracker for regular, periodic, and one-time tasks.
Successor to **Feedme** (cat feeder controller). See [`docs/plan.md`](docs/plan.md)
for the full spec; [`handoff.md`](handoff.md) for current state.

## Repo layout

```
howler/
├── backend/     Hono + Drizzle Worker (HTTP, Cron, Queue consumer)
├── webapp/      React + Vite PWA (deployed to Cloudflare Pages)
├── firmware/    PlatformIO device firmware (ports & adapters)
├── scripts/     Workstation deploy helpers
├── docs/        Plan, design notes
└── handoff.md   Single-page state-of-the-world
```

## Stack — pinned in [`docs/plan.md`](docs/plan.md) §8

- **Server:** Cloudflare Workers + Hono + Drizzle ORM on D1, R2 for blobs,
  Workers Queues + Cron Triggers for scheduling.
- **Web:** React 18 + Vite + TanStack Query, deployed to Cloudflare Pages.
- **Firmware:** PlatformIO + Arduino-ESP32 + TFT_eSPI + LVGL 9 on the
  CrowPanel ESP32 Rotary Display 1.28".

## Getting started (Phase 0)

```bash
pnpm install
pnpm dev:backend          # in one terminal — wrangler dev (Miniflare)
pnpm dev:webapp           # in another     — vite dev
# firmware (separate toolchain):
cd firmware && pio run -e native        # host-side domain unit tests
cd firmware && pio run -e simulator     # Wokwi build
cd firmware && pio run -e crowpanel     # real-board build
```

D1 and R2 bindings need to be provisioned once before `wrangler dev` works
end-to-end — see [`backend/wrangler.toml`](backend/wrangler.toml) and
`pnpm db:migrate:local`.

## Phase status

Phase 0 — Scaffolding. See [`handoff.md`](handoff.md).
