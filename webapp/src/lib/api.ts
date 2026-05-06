import { z } from "zod";
import { getToken, clearSession } from "./session.ts";

const TaskSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.number().int(),
  kind: z.enum(["DAILY", "PERIODIC", "ONESHOT"]),
  deadlineHint: z.number().int().nullable(),
  avatarId: z.string().nullable(),
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
    // Token rejected — clear local session so the UI re-prompts.
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

const api = {
  get: async (path: string): Promise<unknown> =>
    handle(
      await fetch(`/api${path}`, {
        method: "GET",
        headers: baseHeaders(),
        credentials: "include",
      }),
    ),
  post: async (path: string, body: unknown): Promise<unknown> =>
    handle(
      await fetch(`/api${path}`, {
        method: "POST",
        headers: baseHeaders(),
        credentials: "include",
        body: JSON.stringify(body),
      }),
    ),
};

// ── Auth ────────────────────────────────────────────────────────────

const AuthResponseSchema = z.object({
  token: z.string(),
  userId: z.string(),
  username: z.string().nullable(),
  deviceClaimed: z.boolean().optional(),
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const apiSetup = async (
  username: string,
  pin: string,
): Promise<AuthResponse> =>
  AuthResponseSchema.parse(await api.post("/auth/setup", { username, pin }));

export const apiLogin = async (
  username: string,
  pin: string,
): Promise<AuthResponse> =>
  AuthResponseSchema.parse(await api.post("/auth/login", { username, pin }));

export const apiQuickSetup = async (input?: {
  pairCode?: string;
  displayName?: string;
}): Promise<AuthResponse> =>
  AuthResponseSchema.parse(await api.post("/auth/quick-setup", input ?? {}));

export const apiLoginQr = async (
  deviceId: string,
  token: string,
): Promise<AuthResponse> =>
  AuthResponseSchema.parse(
    await api.post("/auth/login-qr", { deviceId, token }),
  );

export const apiLogout = async (): Promise<void> => {
  await api.post("/auth/logout", {});
  clearSession();
};

// ── Tasks ──────────────────────────────────────────────────────────

export const fetchTasks = async (): Promise<Task[]> =>
  TasksResponseSchema.parse(await api.get("/tasks")).tasks;

export type TaskKind = "DAILY" | "PERIODIC" | "ONESHOT";

export interface CreateTaskInput {
  title: string;
  kind: TaskKind;
  priority?: number;
  description?: string;
  times?: string[];
  intervalDays?: number;
  deadlineHint?: number;
}

export const createTask = async (input: CreateTaskInput): Promise<Task> =>
  TaskSchema.parse(await api.post("/tasks", input));

// ── Occurrences ────────────────────────────────────────────────────

const OccurrenceSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  dueAt: z.number().int(),
  status: z.enum(["PENDING", "ACKED", "SKIPPED", "MISSED"]),
  ackedAt: z.number().int().nullable(),
});
export type Occurrence = z.infer<typeof OccurrenceSchema>;

const OccurrencesResponseSchema = z.object({
  occurrences: z.array(OccurrenceSchema),
});

export const fetchPending = async (): Promise<Occurrence[]> =>
  OccurrencesResponseSchema.parse(await api.get("/occurrences/pending"))
    .occurrences;

export const ackOccurrence = async (id: string): Promise<Occurrence> =>
  OccurrenceSchema.parse(await api.post(`/occurrences/${id}/ack`, {}));

export const fetchHealth = async (): Promise<{ ok: boolean }> => {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`health: HTTP ${res.status}`);
  return res.json() as Promise<{ ok: boolean }>;
};
