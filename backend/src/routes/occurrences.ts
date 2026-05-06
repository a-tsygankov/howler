import { Hono } from "hono";
import type { Bindings } from "../env.ts";
import { D1UnitOfWork } from "../repos/d1/unit-of-work.ts";
import {
  ackOccurrence,
  listPendingForUser,
} from "../services/occurrence-service.ts";
import { asDeviceId, asUserId } from "../domain/ids.ts";
import { requireAuth, type AuthVars } from "../middleware/auth.ts";

export const occurrencesRouter = new Hono<{
  Bindings: Bindings;
  Variables: AuthVars;
}>()
  .use("*", requireAuth())

  // GET /api/occurrences/pending — pending list for the caller's user.
  // Both UserToken and DeviceToken pass — devices fetch their owner's
  // tasks, phones fetch their own.
  .get("/pending", async (c) => {
    const info = c.get("auth");
    const uow = new D1UnitOfWork(c.env.DB);
    const items = await listPendingForUser(uow, asUserId(info.userId));
    return c.json({ occurrences: items });
  })

  // POST /api/occurrences/:id/ack — mark acked. Idempotent (re-ack
  // returns the same DTO). DeviceToken records ackedByDevice.
  .post("/:id/ack", async (c) => {
    const info = c.get("auth");
    const occId = c.req.param("id");
    const ackedByDevice =
      info.type === "device" ? asDeviceId(info.deviceId) : null;
    const uow = new D1UnitOfWork(c.env.DB);
    const result = await ackOccurrence(uow, occId, info.userId, ackedByDevice);
    if (!result.ok) {
      const status = result.error === "not-found" ? 404 : 409;
      return c.json({ error: result.error }, status);
    }
    return c.json(result.value);
  });
