import { defineConfig, devices } from "@playwright/test";

// E2E target. Defaults to the production webapp; override via
// E2E_BASE_URL=http://localhost:5173 (with `pnpm dev` running) for
// local iteration.
const baseURL = process.env["E2E_BASE_URL"] ?? "https://howler-webapp.pages.dev";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // serialise — tests share the prod D1
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: 1,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    actionTimeout: 10_000,
  },
  // Two projects:
  //   chromium  — behavioural happy-path tests; run on every PR.
  //   visual    — pixel-fidelity screenshots; opt-in via
  //               `pnpm test:e2e:visual`. Excluded from default
  //               `pnpm test:e2e` (and from CI) because baselines
  //               are OS-sensitive and need to be seeded from a
  //               single canonical Linux Chromium. Regenerate via
  //               `pnpm test:e2e:visual --update-snapshots` from
  //               that environment, commit, then the project goes
  //               green for everyone.
  projects: [
    {
      name: "chromium",
      testIgnore: /visual\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "visual",
      testMatch: /visual\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
