import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../env.ts";
import { D1UnitOfWork } from "../repos/d1/unit-of-work.ts";
import { CreateTaskSchema } from "../shared/schemas.ts";
import { createTask, getTask, listTasks } from "../services/task-service.ts";
import { asUserId } from "../domain/ids.ts";

// Phase 0: auth is stubbed — userId comes from the X-User-Id header.
// Phase 1 replaces this with the PIN + HMAC token middleware (plan §20.1 C7).
const requireUser = (c: { req: { header: (k: string) => string | undefined } }) => {
  const raw = c.req.header("X-User-Id");
  if (!raw) throw new Error("missing X-User-Id (Phase 0 auth stub)");
  return asUserId(raw);
};

export const tasksRouter = new Hono<{ Bindings: Bindings }>()
  .get("/", async (c) => {
    const userId = requireUser(c);
    const uow = new D1UnitOfWork(c.env.DB);
    const tasks = await listTasks(uow, userId);
    return c.json({ tasks });
  })
  .get("/:id", async (c) => {
    const uow = new D1UnitOfWork(c.env.DB);
    const result = await getTask(uow, c.req.param("id"));
    if (!result.ok) return c.json({ error: result.error }, 404);
    return c.json(result.value);
  })
  .post("/", zValidator("json", CreateTaskSchema), async (c) => {
    const userId = requireUser(c);
    const uow = new D1UnitOfWork(c.env.DB);
    const dto = await createTask(uow, userId, c.req.valid("json"));
    return c.json(dto, 201);
  });
