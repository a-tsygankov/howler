import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../env.ts";
import { D1UnitOfWork } from "../repos/d1/unit-of-work.ts";
import { CreateTaskSchema } from "../shared/schemas.ts";
import { createTask, getTask, listTasks } from "../services/task-service.ts";
import { asTaskId, asUserId } from "../domain/ids.ts";
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
  })
  .delete("/:id", async (c) => {
    const callerId = c.get("auth").userId;
    const id = c.req.param("id");
    const uow = new D1UnitOfWork(c.env.DB);
    const result = await getTask(uow, id);
    if (!result.ok) return c.json({ error: result.error }, 404);
    if (result.value.userId !== callerId) {
      return c.json({ error: "not-found" }, 404);
    }
    // Soft delete; cron's DueBefore + tasks.OwnedBy specs already
    // filter on is_deleted=0, so a deleted task immediately drops
    // out of every list. Schedule rows are tombstoned alongside
    // when they next fire (Phase 2 will add an explicit cascade).
    await uow.run(async (tx) => {
      await tx.tasks.remove(asTaskId(result.value.id));
    });
    return c.body(null, 204);
  });
