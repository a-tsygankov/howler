import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../env.ts";
import { D1UnitOfWork } from "../repos/d1/unit-of-work.ts";
import { CreateTaskSchema } from "../shared/schemas.ts";
import { createTask, getTask, listTasks } from "../services/task-service.ts";
import { asUserId } from "../domain/ids.ts";
import { requireAuth, requireUser, type AuthVars } from "../middleware/auth.ts";

export const tasksRouter = new Hono<{ Bindings: Bindings; Variables: AuthVars }>()
  .use("*", requireAuth(), requireUser())
  .get("/", async (c) => {
    const userId = asUserId(c.get("auth").userId);
    const uow = new D1UnitOfWork(c.env.DB);
    const tasks = await listTasks(uow, userId);
    return c.json({ tasks });
  })
  .get("/:id", async (c) => {
    const uow = new D1UnitOfWork(c.env.DB);
    const result = await getTask(uow, c.req.param("id"));
    if (!result.ok) return c.json({ error: result.error }, 404);
    // Defence-in-depth: don't leak someone else's task even if its id is guessed.
    if (result.value.userId !== c.get("auth").userId) {
      return c.json({ error: "not-found" }, 404);
    }
    return c.json(result.value);
  })
  .post("/", zValidator("json", CreateTaskSchema), async (c) => {
    const userId = c.get("auth").userId;
    const uow = new D1UnitOfWork(c.env.DB);
    const dto = await createTask(uow, userId, c.req.valid("json"));
    return c.json(dto, 201);
  });
