import { z } from "zod";
import { clearSession, getToken } from "./session.ts";

const Hex32 = z.string().regex(/^[0-9a-f]{32}$/);

const ScheduleRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    version: z.literal(1),
    kind: z.literal("DAILY"),
    times: z.array(z.string()),
  }),
  z.object({
    version: z.literal(1),
    kind: z.literal("PERIODIC"),
    intervalDays: z.number().int().positive(),
  }),
  z.object({ version: z.literal(1), kind: z.literal("ONESHOT") }),
]);
export type ScheduleRule = z.infer<typeof ScheduleRuleSchema>;

const TaskSchema = z.object({
  id: Hex32,
  homeId: Hex32,
  creatorUserId: Hex32.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.number().int(),
  kind: z.enum(["DAILY", "PERIODIC", "ONESHOT"]),
  deadlineHint: z.number().int().nullable(),
  avatarId: z.string().nullable(),
  labelId: z.string().nullable(),
  resultTypeId: z.string().nullable(),
  isPrivate: z.boolean(),
  active: z.boolean(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  rule: ScheduleRuleSchema.nullable().optional(),
});
export type Task = z.infer<typeof TaskSchema>;

const TasksResponseSchema = z.object({ tasks: z.array(TaskSchema) });

const baseHeaders = (init?: HeadersInit): HeadersInit => {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init as Record<string, string> | undefined),
  };
  const token = getToken();
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
};

const handle = async (res: Response): Promise<unknown> => {
  if (res.status === 401) {
    clearSession();
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
};

const callJson = async (
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<unknown> => {
  const init: RequestInit = {
    method,
    headers: baseHeaders(),
    credentials: "include",
  };
  if (method !== "GET" && method !== "DELETE") {
    init.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(`/api${path}`, init);
  if (method === "DELETE" && res.status === 204) return undefined;
  return handle(res);
};

// ── Auth (home-centric) ─────────────────────────────────────────────

const UserPick = z.object({ id: Hex32, displayName: z.string() });
const SelectorResponse = z.object({
  selectorToken: z.string(),
  homeId: Hex32,
  users: z.array(UserPick),
});
const DirectAuth = z.object({
  token: z.string(),
  homeId: Hex32,
  userId: Hex32,
  homeLogin: z.string().optional(),
  deviceClaimed: z.boolean().optional(),
});
const SetupResponse = DirectAuth;
const QuickSetupResponse = DirectAuth;
const LoginResponse = z.union([SelectorResponse, DirectAuth]);
const LoginQrResponse = z.union([SelectorResponse, DirectAuth]);

export type LoginOutcome =
  | { kind: "direct"; token: string; homeId: string; userId: string }
  | { kind: "selector"; selectorToken: string; homeId: string; users: { id: string; displayName: string }[] };

const toOutcome = (parsed: z.infer<typeof LoginResponse>): LoginOutcome => {
  if ("token" in parsed) {
    return {
      kind: "direct",
      token: parsed.token,
      homeId: parsed.homeId,
      userId: parsed.userId,
    };
  }
  return {
    kind: "selector",
    selectorToken: parsed.selectorToken,
    homeId: parsed.homeId,
    users: parsed.users,
  };
};

const tzGuess = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export const apiSetup = async (
  login: string,
  pin: string,
): Promise<LoginOutcome> =>
  toOutcome(
    SetupResponse.parse(
      await callJson("POST", "/auth/setup", { login, pin, tz: tzGuess() }),
    ),
  );

export const apiLogin = async (
  login: string,
  pin: string,
): Promise<LoginOutcome> =>
  toOutcome(LoginResponse.parse(await callJson("POST", "/auth/login", { login, pin })));

export const apiQuickSetup = async (input?: {
  pairCode?: string;
  displayName?: string;
}): Promise<LoginOutcome> =>
  toOutcome(
    QuickSetupResponse.parse(
      await callJson("POST", "/auth/quick-setup", { ...(input ?? {}), tz: tzGuess() }),
    ),
  );

export const apiLoginQr = async (
  deviceId: string,
  token: string,
): Promise<LoginOutcome> =>
  toOutcome(
    LoginQrResponse.parse(
      await callJson("POST", "/auth/login-qr", { deviceId, token }),
    ),
  );

export const apiSelectUser = async (
  selectorToken: string,
  userId: string,
): Promise<{ token: string; homeId: string; userId: string }> =>
  DirectAuth.parse(
    await callJson("POST", "/auth/select-user", { selectorToken, userId }),
  );

const MeResponse = z.object({
  homeId: Hex32,
  homeDisplayName: z.string(),
  homeLogin: z.string().nullable(),
  homeAvatarId: z.string().nullable().optional(),
  tz: z.string(),
  hasPin: z.boolean(),
  userId: Hex32,
  userDisplayName: z.string(),
  userAvatarId: z.string().nullable().optional(),
});
export type Me = z.infer<typeof MeResponse>;

export const apiMe = async (): Promise<Me> =>
  MeResponse.parse(await callJson("POST", "/auth/me"));

export const apiLogout = async (): Promise<void> => {
  await callJson("POST", "/auth/logout").catch(() => undefined);
  clearSession();
};

export const apiPairConfirm = async (pairCode: string): Promise<void> => {
  await callJson("POST", "/pair/confirm", { pairCode });
};

// ── Tasks ──────────────────────────────────────────────────────────

export type TaskKind = "DAILY" | "PERIODIC" | "ONESHOT";

export interface CreateTaskInput {
  title: string;
  kind: TaskKind;
  priority?: number;
  description?: string;
  times?: string[];
  intervalDays?: number;
  deadlineHint?: number;
  templateId?: string;
  labelId?: string | null;
  resultTypeId?: string | null;
  isPrivate?: boolean;
  assignees?: string[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  priority?: number;
  active?: boolean;
  labelId?: string | null;
  resultTypeId?: string | null;
  isPrivate?: boolean;
  assignees?: string[];
  // Schedule rule edits — server expects UTC times; the SPA must
  // localToUTC() before passing them in. Only the field matching
  // the task's kind has effect; the others are ignored.
  times?: string[];
  intervalDays?: number;
  deadlineHint?: number | null;
}

export const fetchTasks = async (): Promise<Task[]> =>
  TasksResponseSchema.parse(await callJson("GET", "/tasks")).tasks;

export const createTask = async (input: CreateTaskInput): Promise<Task> =>
  TaskSchema.parse(await callJson("POST", "/tasks", input));

export const updateTask = async (
  id: string,
  patch: UpdateTaskInput,
): Promise<Task> => TaskSchema.parse(await callJson("PATCH", `/tasks/${id}`, patch));

export const deleteTask = async (id: string): Promise<void> => {
  await callJson("DELETE", `/tasks/${id}`);
};

// ── Occurrences ────────────────────────────────────────────────────

const OccurrenceSchema = z.object({
  id: Hex32,
  taskId: Hex32,
  dueAt: z.number().int(),
  status: z.enum(["PENDING", "ACKED", "SKIPPED", "MISSED"]),
  ackedAt: z.number().int().nullable(),
  ackedByUserId: Hex32.nullable(),
  executionId: Hex32.nullable(),
});
export type Occurrence = z.infer<typeof OccurrenceSchema>;

const OccurrencesResponseSchema = z.object({
  occurrences: z.array(OccurrenceSchema),
});

export const fetchPending = async (): Promise<Occurrence[]> =>
  OccurrencesResponseSchema.parse(await callJson("GET", "/occurrences/pending"))
    .occurrences;

export const ackOccurrence = async (
  id: string,
  body?: { resultValue?: number | null; notes?: string | null },
): Promise<Occurrence> =>
  OccurrenceSchema.parse(
    await callJson("POST", `/occurrences/${id}/ack`, body ?? {}),
  );

// ── Labels ─────────────────────────────────────────────────────────

const LabelSchema = z.object({
  id: Hex32,
  homeId: Hex32,
  displayName: z.string(),
  color: z.string().nullable(),
  system: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Label = z.infer<typeof LabelSchema>;

export const fetchLabels = async (): Promise<Label[]> =>
  z
    .object({ labels: z.array(LabelSchema) })
    .parse(await callJson("GET", "/labels"))
    .labels;

// ── TaskResults ────────────────────────────────────────────────────

const TaskResultSchema = z.object({
  id: Hex32,
  homeId: Hex32,
  displayName: z.string(),
  unitName: z.string(),
  minValue: z.number().nullable(),
  maxValue: z.number().nullable(),
  step: z.number(),
  defaultValue: z.number().nullable(),
  useLastValue: z.boolean(),
  system: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type TaskResultDef = z.infer<typeof TaskResultSchema>;

export const fetchTaskResults = async (): Promise<TaskResultDef[]> =>
  z
    .object({ taskResults: z.array(TaskResultSchema) })
    .parse(await callJson("GET", "/task-results"))
    .taskResults;

export interface CreateTaskResultInput {
  displayName: string;
  unitName: string;
  minValue?: number | null;
  maxValue?: number | null;
  step: number;
  defaultValue?: number | null;
  useLastValue?: boolean;
  sortOrder?: number;
}

export const createTaskResult = async (
  input: CreateTaskResultInput,
): Promise<TaskResultDef> =>
  TaskResultSchema.parse(await callJson("POST", "/task-results", input));

export const updateTaskResult = async (
  id: string,
  patch: Partial<CreateTaskResultInput>,
): Promise<void> => {
  await callJson("PATCH", `/task-results/${id}`, patch);
};

export const deleteTaskResult = async (
  id: string,
): Promise<{ ok: boolean; tasksAffected: number }> =>
  z
    .object({ ok: z.boolean(), tasksAffected: z.number().int() })
    .parse(await callJson("DELETE", `/task-results/${id}`));

// ── Task executions (history for sparkline / detail view) ─────────

const ExecutionSchema = z.object({
  id: Hex32,
  taskId: Hex32,
  occurrenceId: z.string().nullable(),
  userId: z.string().nullable(),
  labelId: z.string().nullable(),
  resultTypeId: z.string().nullable(),
  resultValue: z.number().nullable(),
  resultUnit: z.string().nullable(),
  notes: z.string().nullable(),
  ts: z.number().int(),
});
export type TaskExecution = z.infer<typeof ExecutionSchema>;

export const fetchTaskExecutions = async (
  taskId: string,
  limit = 30,
): Promise<TaskExecution[]> =>
  z
    .object({ executions: z.array(ExecutionSchema) })
    .parse(await callJson("GET", `/tasks/${taskId}/executions?limit=${limit}`))
    .executions;

// ── Schedule (per-task) ────────────────────────────────────────────

const TaskScheduleSchema = z.object({
  id: Hex32,
  taskId: Hex32,
  rule: ScheduleRuleSchema,
  tz: z.string(),
  nextFireAt: z.number().int().nullable(),
});
export type TaskSchedule = z.infer<typeof TaskScheduleSchema>;

export const fetchTaskSchedule = async (taskId: string): Promise<TaskSchedule> =>
  TaskScheduleSchema.parse(await callJson("GET", `/tasks/${taskId}/schedule`));

export const fetchTask = async (id: string): Promise<Task & { assignees: string[] }> => {
  const data = (await callJson("GET", `/tasks/${id}`)) as unknown;
  return TaskSchema.extend({ assignees: z.array(Hex32) })
    .parse(data) as Task & { assignees: string[] };
};

// ── Users (within the caller's home) ────────────────────────────────

const UserSchema = z.object({
  id: Hex32,
  homeId: Hex32,
  displayName: z.string(),
  login: z.string().nullable(),
  avatarId: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type User = z.infer<typeof UserSchema>;

export const fetchUsers = async (): Promise<User[]> =>
  z
    .object({ users: z.array(UserSchema) })
    .parse(await callJson("GET", "/users"))
    .users;

export const createUser = async (input: {
  displayName: string;
  login?: string;
}): Promise<User> => UserSchema.parse(await callJson("POST", "/users", input));

export const renameUser = async (id: string, displayName: string): Promise<void> => {
  await callJson("PATCH", `/users/${id}`, { displayName });
};

export const deleteUser = async (
  id: string,
): Promise<{ ok: boolean; orphanedTasksTombstoned: number }> =>
  z
    .object({ ok: z.boolean(), orphanedTasksTombstoned: z.number().int() })
    .parse(await callJson("DELETE", `/users/${id}`));

// ── Devices ────────────────────────────────────────────────────────

const DeviceSchema = z.object({
  id: Hex32,
  homeId: Hex32,
  serial: z.string(),
  fwVersion: z.string().nullable(),
  hwModel: z.string(),
  tz: z.string().nullable(),
  lastSeenAt: z.number().int().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Device = z.infer<typeof DeviceSchema>;

export const fetchDevices = async (): Promise<Device[]> =>
  z
    .object({ devices: z.array(DeviceSchema) })
    .parse(await callJson("GET", "/devices"))
    .devices;

export const revokeDevice = async (id: string): Promise<void> => {
  await callJson("DELETE", `/devices/${id}`);
};

// ── Schedule templates ─────────────────────────────────────────────

const ScheduleTemplateSchema = z.object({
  id: Hex32,
  homeId: z.string().nullable(),
  displayName: z.string(),
  description: z.string().nullable(),
  rule: ScheduleRuleSchema,
  system: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type ScheduleTemplate = z.infer<typeof ScheduleTemplateSchema>;

export const fetchScheduleTemplates = async (): Promise<ScheduleTemplate[]> =>
  z
    .object({ templates: z.array(ScheduleTemplateSchema) })
    .parse(await callJson("GET", "/schedule-templates"))
    .templates;

// ── Avatars ────────────────────────────────────────────────────────

export const uploadAvatar = async (
  file: File,
): Promise<{ id: string; url: string }> => {
  const fd = new FormData();
  fd.append("file", file);
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch("/api/avatars", {
    method: "POST",
    headers,
    credentials: "include",
    body: fd,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as { id: string; url: string };
};

export const avatarUrl = (avatarId: string | null | undefined): string | null =>
  avatarId ? `/api/avatars/${avatarId}` : null;

export const updateHome = async (patch: {
  displayName?: string;
  tz?: string;
  avatarId?: string | null;
}): Promise<void> => {
  await callJson("PATCH", "/homes/me", patch);
};

export const updateUserAvatar = async (
  userId: string,
  avatarId: string | null,
): Promise<void> => {
  await callJson("PATCH", `/users/${userId}`, { avatarId });
};

// ── Web push (plumbing only — encryption is Phase 2.6b) ─────────────

export const fetchVapidKey = async (): Promise<string | null> => {
  try {
    const r = await callJson("GET", "/push/vapid-public-key");
    return (r as { key: string }).key;
  } catch {
    return null;
  }
};

interface SubscribeBody {
  endpoint: string;
  p256dh: string;
  authSecret: string;
  userAgent?: string;
}

export const apiPushSubscribe = async (body: SubscribeBody): Promise<void> => {
  await callJson("POST", "/push/subscribe", body);
};

export const apiPushUnsubscribe = async (endpoint: string): Promise<void> => {
  await callJson("DELETE", "/push/subscribe", { endpoint });
};

// ── Health ─────────────────────────────────────────────────────────

export const fetchHealth = async (): Promise<{ ok: boolean }> => {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`health: HTTP ${res.status}`);
  return res.json() as Promise<{ ok: boolean }>;
};
