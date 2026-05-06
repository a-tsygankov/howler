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
}

export interface OccurrenceFireMessage {
  scheduleId: string;
  dueAt: number;
}
