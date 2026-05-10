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
            // F3 R2 presigning — synthetic creds so the test
            // suite exercises the full SigV4 code path without
            // talking to a real R2 endpoint. The signature is
            // deterministic for fixed inputs; tests assert URL
            // shape + signature length rather than going to net.
            R2_ACCOUNT_ID: "test-account",
            R2_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
            R2_SECRET_ACCESS_KEY:
              "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
          },
        },
      },
    },
  },
});
