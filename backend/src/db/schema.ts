import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";

// Plan §6 — home-centric model. Every syncable entity carries the
// LWW triplet (created_at, updated_at, is_deleted). 32-char
// lowercase-hex UUIDs as PKs.

export const homes = sqliteTable(
  "homes",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    login: text("login").unique(),
    pinSalt: text("pin_salt"),
    pinHash: text("pin_hash"),
    tz: text("tz").notNull().default("UTC"),
    avatarId: text("avatar_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    isDeleted: integer("is_deleted").notNull().default(0),
  },
  (t) => ({
    byLogin: index("homes_login_idx").on(t.login),
  }),
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    homeId: text("home_id").notNull().references(() => homes.id),
    displayName: text("display_name").notNull(),
    login: text("login").unique(),
    pinSalt: text("pin_salt"),
    pinHash: text("pin_hash"),
    avatarId: text("avatar_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    isDeleted: integer("is_deleted").notNull().default(0),
  },
  (t) => ({
    byHome: index("users_home_idx").on(t.homeId),
  }),
);

export const labels = sqliteTable(
  "labels",
  {
    id: text("id").primaryKey(),
    homeId: text("home_id").notNull().references(() => homes.id),
    displayName: text("display_name").notNull(),
    color: text("color"),
    system: integer("system").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    isDeleted: integer("is_deleted").notNull().default(0),
  },
  (t) => ({ byHome: index("labels_home_idx").on(t.homeId) }),
);

export const taskResults = sqliteTable(
  "task_results",
  {
    id: text("id").primaryKey(),
    homeId: text("home_id").notNull().references(() => homes.id),
    displayName: text("display_name").notNull(),
    unitName: text("unit_name").notNull(),
    minValue: real("min_value"),
    maxValue: real("max_value"),
    step: real("step").notNull().default(1),
    defaultValue: real("default_value"),
    useLastValue: integer("use_last_value").notNull().default(1),
    system: integer("system").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    isDeleted: integer("is_deleted").notNull().default(0),
  },
  (t) => ({ byHome: index("task_results_home_idx").on(t.homeId) }),
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    homeId: text("home_id").notNull().references(() => homes.id),
    creatorUserId: text("creator_user_id").references(() => users.id),
    title: text("title").notNull(),
    description: text("description"),
    priority: integer("priority").notNull().default(1),
    kind: text("kind", { enum: ["DAILY", "PERIODIC", "ONESHOT"] }).notNull(),
    deadlineHint: integer("deadline_hint"),
    avatarId: text("avatar_id"),
    labelId: text("label_id").references(() => labels.id),
    resultTypeId: text("result_type_id").references(() => taskResults.id),
    isPrivate: integer("is_private").notNull().default(0),
    active: integer("active").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    isDeleted: integer("is_deleted").notNull().default(0),
  },
  (t) => ({
    byHome: index("tasks_home_idx").on(t.homeId),
    byLabel: index("tasks_label_idx").on(t.labelId),
    byUpdated: index("tasks_updated_idx").on(t.updatedAt),
  }),
);

export const taskAssignments = sqliteTable(
  "task_assignments",
  {
    taskId: text("task_id").notNull().references(() => tasks.id),
    userId: text("user_id").notNull().references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.taskId, t.userId] }),
    byUser: index("task_assignments_user_idx").on(t.userId),
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
    byTask: index("schedules_task_idx").on(t.taskId),
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
    status: text("status", {
      enum: ["PENDING", "ACKED", "SKIPPED", "MISSED"],
    })
      .notNull()
      .default("PENDING"),
    ackedByUserId: text("acked_by_user_id").references(() => users.id),
    ackedByDeviceId: text("acked_by_device_id"),
    executionId: text("execution_id"),
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

export const scheduleTemplates = sqliteTable(
  "schedule_templates",
  {
    id: text("id").primaryKey(),
    homeId: text("home_id").references(() => homes.id),
    displayName: text("display_name").notNull(),
    description: text("description"),
    ruleJson: text("rule_json").notNull(),
    system: integer("system").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    isDeleted: integer("is_deleted").notNull().default(0),
  },
  (t) => ({ byHome: index("schedule_templates_home_idx").on(t.homeId) }),
);

export const taskExecutions = sqliteTable(
  "task_executions",
  {
    id: text("id").primaryKey(),
    homeId: text("home_id").notNull().references(() => homes.id),
    taskId: text("task_id").notNull().references(() => tasks.id),
    occurrenceId: text("occurrence_id"),
    userId: text("user_id").references(() => users.id),
    deviceId: text("device_id"),
    labelId: text("label_id"),
    resultTypeId: text("result_type_id"),
    resultValue: real("result_value"),
    resultUnit: text("result_unit"),
    notes: text("notes"),
    ts: integer("ts").notNull(),
  },
  (t) => ({
    byHomeTs: index("task_executions_home_ts_idx").on(t.homeId, t.ts),
    byTaskTs: index("task_executions_task_ts_idx").on(t.taskId, t.ts),
    byOccurrence: index("task_executions_occurrence_idx").on(t.occurrenceId),
  }),
);

export const devices = sqliteTable(
  "devices",
  {
    id: text("id").primaryKey(),
    homeId: text("home_id").notNull().references(() => homes.id),
    serial: text("serial").notNull(),
    fwVersion: text("fw_version"),
    hwModel: text("hw_model").notNull(),
    tz: text("tz"),
    lastSeenAt: integer("last_seen_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    isDeleted: integer("is_deleted").notNull().default(0),
  },
  (t) => ({ byHome: index("devices_home_idx").on(t.homeId) }),
);

export const pendingPairings = sqliteTable(
  "pending_pairings",
  {
    deviceId: text("device_id").primaryKey(),
    pairCode: text("pair_code").notNull(),
    serial: text("serial"),
    hwModel: text("hw_model"),
    requestedAt: integer("requested_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    cancelledAt: integer("cancelled_at"),
    confirmedAt: integer("confirmed_at"),
    homeId: text("home_id"),
    deviceToken: text("device_token"),
  },
  (t) => ({
    byPairCode: index("pending_pairings_pair_code_idx").on(t.pairCode),
    byExpires: index("pending_pairings_expires_idx").on(t.expiresAt),
  }),
);

export const loginQrTokens = sqliteTable(
  "login_qr_tokens",
  {
    token: text("token").primaryKey(),
    deviceId: text("device_id").notNull(),
    homeId: text("home_id").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
  },
  (t) => ({
    byDevice: index("login_qr_device_idx").on(t.deviceId),
    byExpires: index("login_qr_expires_idx").on(t.expiresAt),
  }),
);

export const authLogs = sqliteTable(
  "auth_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    homeId: text("home_id"),
    userId: text("user_id"),
    ts: integer("ts").notNull(),
    kind: text("kind").notNull(),
    identifier: text("identifier"),
    result: text("result").notNull(),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms").notNull().default(0),
  },
  (t) => ({
    byHomeTs: index("auth_logs_home_ts_idx").on(t.homeId, t.ts),
    byTs: index("auth_logs_ts_idx").on(t.ts),
  }),
);

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
