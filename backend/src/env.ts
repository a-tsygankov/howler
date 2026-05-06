export interface RateLimiter {
  limit: (input: { key: string }) => Promise<{ success: boolean }>;
}

export interface Bindings {
  DB: D1Database;
  FIRMWARE: R2Bucket;
  AVATARS: R2Bucket;
  OCCURRENCE_QUEUE: Queue<OccurrenceFireMessage>;
  RATE_LIMITER: RateLimiter;
  ENVIRONMENT: "development" | "production";
  AUTH_SECRET?: string;
}

export interface OccurrenceFireMessage {
  scheduleId: string;
  dueAt: number;
}
