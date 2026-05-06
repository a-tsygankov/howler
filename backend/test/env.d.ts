/// <reference types="@cloudflare/vitest-pool-workers" />

declare module "*.sql?raw" {
  const sql: string;
  export default sql;
}

declare module "cloudflare:test" {
  // Make our worker bindings visible on `env` in tests.
  interface ProvidedEnv {
    DB: D1Database;
    FIRMWARE: R2Bucket;
    AVATARS: R2Bucket;
    OCCURRENCE_QUEUE: Queue<unknown>;
    AUTH_SECRET: string;
    ENVIRONMENT: string;
  }
}
