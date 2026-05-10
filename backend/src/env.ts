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
  // Comma-separated home IDs allowed to admin-mutate
  // /api/firmware. Phase 6 OTA scaffolding (slice F1) — there's no
  // first-class admin concept yet, so we gate the upload + promote
  // endpoints on a hardcoded list. Empty string = nobody is admin
  // (the safer default for a misconfigured deploy). Read by
  // requireAdmin() in middleware/auth.ts.
  ADMIN_HOMES?: string;
}

export interface OccurrenceFireMessage {
  scheduleId: string;
  dueAt: number;
}
