# scripts/

Workstation deploy helpers. CI auto-deploys on push to `main`
(see [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)) — these are
for one-offs.

| Command | What it does |
| --- | --- |
| `./scripts/deploy.sh --backend` / `deploy.ps1 -Backend` | Apply D1 migrations + `wrangler deploy` |
| `./scripts/deploy.sh --webapp`  / `deploy.ps1 -Webapp` | Build + `wrangler pages deploy` |
| `./scripts/deploy.sh --firmware` / `deploy.ps1 -Firmware` | `pio run -e crowpanel -t upload` (needs USB-connected board) |
| `./scripts/deploy.sh --all`     / `deploy.ps1 -All` | backend + webapp (no firmware — that's USB-only) |
