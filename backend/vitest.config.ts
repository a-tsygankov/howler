import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          compatibilityDate: "2025-01-01",
          compatibilityFlags: ["nodejs_compat"],
          bindings: {
            AUTH_SECRET: "integration-test-secret",
            // Phase 6 OTA — admin allow-list is a static binding;
            // tests that exercise the F1 write path mint a home
            // whose id matches this constant. Mutating env at
            // runtime doesn't propagate into the worker (the
            // request gets the binding object as-of-boot).
            ADMIN_HOMES: "a".repeat(32),
          },
        },
      },
    },
  },
});
