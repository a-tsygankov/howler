import { z } from "zod";
import { clearSession, getToken } from "./session.ts";

const Hex32 = z.string().regex(/^[0-9a-f]{32}$/);

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
  tz: z.string(),
  hasPin: z.boolean(),
  userId: Hex32,
  userDisplayName: z.string(),
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

// ── Health ─────────────────────────────────────────────────────────

export const fetchHealth = async (): Promise<{ ok: boolean }> => {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`health: HTTP ${res.status}`);
  return res.json() as Promise<{ ok: boolean }>;
};
