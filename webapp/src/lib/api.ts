import { z } from "zod";

// Phase 0 — duplicates the backend TaskDto schema. Once we bring up
// the shared types package (Phase 1), import from there instead.
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

const PHASE0_USER_ID = "00000000000000000000000000000001";

const baseHeaders = (): HeadersInit => ({
  "Content-Type": "application/json",
  "X-User-Id": PHASE0_USER_ID,
});

export const fetchTasks = async (): Promise<Task[]> => {
  const res = await fetch("/api/tasks", { headers: baseHeaders() });
  if (!res.ok) throw new Error(`tasks: HTTP ${res.status}`);
  return TasksResponseSchema.parse(await res.json()).tasks;
};

export const fetchHealth = async (): Promise<{ ok: boolean }> => {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`health: HTTP ${res.status}`);
  return res.json() as Promise<{ ok: boolean }>;
};
