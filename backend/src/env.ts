export interface RateLimiter {
  limit: (input: { key: string }) => Promise<{ success: boolean }>;
}

export interface AnalyticsDataPoint {
  blobs?: string[];
  doubles?: number[];
  indexes?: string[];
}

export interface AnalyticsBinding {
  writeDataPoint: (point: AnalyticsDataPoint) => void;
}

export interface Bindings {
  DB: D1Database;
  FIRMWARE: R2Bucket;
  AVATARS: R2Bucket;
  OCCURRENCE_QUEUE: Queue<OccurrenceFireMessage>;
  RATE_LIMITER: RateLimiter;
  ANALYTICS?: AnalyticsBinding;
  ENVIRONMENT: "development" | "production";
  AUTH_SECRET?: string;
  PUSH_VAPID_PUBLIC_KEY?: string;
  PUSH_VAPID_PRIVATE_KEY?: string;
  VAPID_CONTACT?: string;
  // ADMIN_HOMES retired in migration 0014 — per-user admin via
  // users.is_admin replaced the per-home env-var gate. Field
  // kept here as `undefined` so a deploy with the old secret
  // still booted doesn't crash; requireAdmin() ignores it.
  // Phase 6 OTA slice F3 — R2 presigned-URL credentials. The
  // /api/firmware/check endpoint mints short-lived (5 min) GET
  // URLs for the firmware bytes; the dial follows them via direct
  // HTTPS, no token needed at R2's edge. All three vars must be
  // set as secrets:
  //   wrangler secret put R2_ACCOUNT_ID
  //   wrangler secret put R2_ACCESS_KEY_ID
  //   wrangler secret put R2_SECRET_ACCESS_KEY
  // Generate the access key in the Cloudflare dashboard under
  // R2 → Manage R2 API Tokens (scope: read-only on
  // howler-firmware bucket). When any of these are missing,
  // /firmware/check falls back to surfacing the raw r2Key — same
  // shape as F0, useful for staging without R2 API creds.
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}

export interface OccurrenceFireMessage {
  scheduleId: string;
  dueAt: number;
}
