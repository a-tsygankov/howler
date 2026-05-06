export interface Bindings {
  DB: D1Database;
  FIRMWARE: R2Bucket;
  AVATARS: R2Bucket;
  OCCURRENCE_QUEUE: Queue<OccurrenceFireMessage>;
  ENVIRONMENT: "development" | "production";
  AUTH_SECRET?: string;
}

export interface OccurrenceFireMessage {
  scheduleId: string;
  dueAt: number;
}
