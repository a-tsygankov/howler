import { z } from "zod";

const Hex32 = z.string().regex(/^[0-9a-f]{32}$/);
const Username = z.string().min(3).max(40).regex(/^[a-z0-9_-]+$/i);
const Pin = z.string().min(4).max(64);

export const SetupSchema = z.object({ username: Username, pin: Pin });
export const LoginSchema = z.object({ username: Username, pin: Pin });
export const SetPinSchema = z.object({ pin: Pin });

export const QuickSetupSchema = z.object({
  pairCode: z.string().min(4).max(16).optional(),
  displayName: z.string().min(1).max(80).optional(),
});

export const LoginQrSchema = z.object({
  deviceId: Hex32,
  token: z.string().min(8).max(64),
});

export const PairStartSchema = z.object({
  deviceId: Hex32,
  serial: z.string().max(80).optional(),
  hwModel: z.string().max(40).optional(),
});
export const PairCheckSchema = z.object({ deviceId: Hex32 });
export const PairConfirmSchema = z.object({
  pairCode: z.string().min(4).max(16),
});

export const AuthMeDtoSchema = z.object({
  userId: Hex32,
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  hasPin: z.boolean(),
});
export type AuthMeDto = z.infer<typeof AuthMeDtoSchema>;


// Plan §17 risk #3 — schedule rule shapes are versioned. Bump `version`
// and add a new variant rather than mutating an existing one.
export const ScheduleRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    version: z.literal(1),
    kind: z.literal("DAILY"),
    times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1),
  }),
  z.object({
    version: z.literal(1),
    kind: z.literal("PERIODIC"),
    intervalDays: z.number().int().positive(),
  }),
  z.object({
    version: z.literal(1),
    kind: z.literal("ONESHOT"),
  }),
]);
export type ScheduleRule = z.infer<typeof ScheduleRuleSchema>;

export const TaskKindSchema = z.enum(["DAILY", "PERIODIC", "ONESHOT"]);

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  priority: z.number().int().min(0).max(3).default(1),
  kind: TaskKindSchema,
  deadlineHint: z.number().int().nullish(),
});
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

export const TaskDtoSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{32}$/),
  userId: z.string().regex(/^[0-9a-f]{32}$/),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.number().int().min(0).max(3),
  kind: TaskKindSchema,
  deadlineHint: z.number().int().nullable(),
  avatarId: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type TaskDto = z.infer<typeof TaskDtoSchema>;
