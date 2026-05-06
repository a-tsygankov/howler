import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// Plan §6 — every syncable entity carries the LWW triplet
// (created_at, updated_at, is_deleted). 32-char lowercase-hex UUIDs as PKs.

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  pinHash: text("pin_hash"),
  pinSalt: text("pin_salt"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  isDeleted: integer("is_deleted").notNull().default(0),
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    title: text("title").notNull(),
    description: text("description"),
    priority: integer("priority").notNull().default(1),
    kind: text("kind", { enum: ["DAILY", "PERIODIC", "ONESHOT"] }).notNull(),
    deadlineHint: integer("deadline_hint"),
    avatarId: text("avatar_id"),
    active: integer("active").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    isDeleted: integer("is_deleted").notNull().default(0),
  },
  (t) => ({
    byUser: index("tasks_user_idx").on(t.userId),
    byUpdated: index("tasks_updated_idx").on(t.updatedAt),
  }),
);

export const schedules = sqliteTable(
  "schedules",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id),
    templateId: text("template_id"),
    ruleJson: text("rule_json").notNull(),
    tz: text("tz").notNull(),
    nextFireAt: integer("next_fire_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    isDeleted: integer("is_deleted").notNull().default(0),
  },
  (t) => ({
    byNextFire: index("schedules_next_fire_idx").on(t.nextFireAt),
  }),
);

export const occurrences = sqliteTable(
  "occurrences",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id),
    dueAt: integer("due_at").notNull(),
    firedAt: integer("fired_at"),
    ackedAt: integer("acked_at"),
    status: text("status", { enum: ["PENDING", "ACKED", "SKIPPED", "MISSED"] })
      .notNull()
      .default("PENDING"),
    ackedByDevice: text("acked_by_device"),
    idempotencyKey: text("idempotency_key").unique(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    isDeleted: integer("is_deleted").notNull().default(0),
  },
  (t) => ({
    byTaskStatus: index("occ_task_status_idx").on(t.taskId, t.status),
    byDue: index("occ_due_idx").on(t.dueAt),
  }),
);

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  serial: text("serial").notNull().unique(),
  fwVersion: text("fw_version"),
  hwModel: text("hw_model").notNull(),
  lastSeenAt: integer("last_seen_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  isDeleted: integer("is_deleted").notNull().default(0),
});

// Outbox for the REST-polling comms adapter (plan §10). When MQTT lands
// in Phase 3, this table stays — the MQTT adapter just doesn't write to it.
export const deviceOutbox = sqliteTable(
  "device_outbox",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id").notNull().references(() => devices.id),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at").notNull(),
    deliveredAt: integer("delivered_at"),
  },
  (t) => ({
    byDeviceUndelivered: index("outbox_dev_undelivered_idx").on(
      t.deviceId,
      t.deliveredAt,
    ),
  }),
);
