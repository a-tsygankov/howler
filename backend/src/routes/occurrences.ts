import { clock } from "../clock.ts";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings } from "../env.ts";
import { D1UnitOfWork } from "../repos/d1/unit-of-work.ts";
import {
  ackOccurrence,
  listPendingForHome,
} from "../services/occurrence-service.ts";
import { asDeviceId, asHomeId } from "../domain/ids.ts";
import { markDeviceAlive, requireAuth, type AuthVars } from "../middleware/auth.ts";
import { AckOccurrenceSchema } from "../shared/schemas.ts";

export const occurrencesRouter = new Hono<{
  Bindings: Bindings;
  Variables: AuthVars;
}>()
  .use("*", requireAuth(), markDeviceAlive())

  .get("/pending", async (c) => {
    const info = c.get("auth");
    const uow = new D1UnitOfWork(c.env.DB);
    const items = await listPendingForHome(uow, asHomeId(info.homeId));
    return c.json({ occurrences: items });
  })

  .post("/:id/ack", zValidator("json", AckOccurrenceSchema), async (c) => {
    const info = c.get("auth");
    const occId = c.req.param("id");
    const { resultValue, notes } = c.req.valid("json");
    const ackedByDevice =
      info.type === "device" ? asDeviceId(info.deviceId) : null;
    const callerUserId = info.type === "user" ? info.userId : null;
    const uow = new D1UnitOfWork(c.env.DB);
    const result = await ackOccurrence(c.env.DB, uow, occId, {
      callerHomeId: info.homeId,
      callerUserId,
      ackedByDevice,
      resultValue: resultValue ?? null,
      notes: notes ?? null,
    });
    if (!result.ok) {
      const status = result.error === "not-found" ? 404 : 409;
      return c.json({ error: result.error }, status);
    }
    return c.json(result.value);
  });
