import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings } from "../env.ts";
import { newUuid } from "../domain/ids.ts";
import { requireAuth, requireUser, type AuthVars } from "../middleware/auth.ts";

const SubscribeInput = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(8),
  authSecret: z.string().min(8),
  userAgent: z.string().max(200).optional(),
});

export const pushRouter = new Hono<{
  Bindings: Bindings;
  Variables: AuthVars;
}>()
  .get("/vapid-public-key", (c) => {
    const key = (c.env as unknown as { PUSH_VAPID_PUBLIC_KEY?: string })
      .PUSH_VAPID_PUBLIC_KEY;
    if (!key) return c.json({ error: "vapid-not-configured" }, 503);
    return c.json({ key });
  })

  .use("*", requireAuth(), requireUser())

  // Idempotent on endpoint — if the same browser re-subscribes we
  // overwrite the row in place (matching its updated p256dh/auth).
  .post("/subscribe", zValidator("json", SubscribeInput), async (c) => {
    const u = c.get("user");
    const body = c.req.valid("json");
    const nowSec = Math.floor(Date.now() / 1000);
    const id = newUuid();
    await c.env.DB.prepare(
      `INSERT INTO push_subscriptions (id, home_id, user_id, endpoint, p256dh, auth_secret, user_agent, created_at, updated_at, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(endpoint) DO UPDATE SET
         home_id = excluded.home_id,
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth_secret = excluded.auth_secret,
         user_agent = excluded.user_agent,
         updated_at = excluded.updated_at,
         is_deleted = 0`,
    )
      .bind(
        id,
        u.homeId,
        u.userId,
        body.endpoint,
        body.p256dh,
        body.authSecret,
        body.userAgent ?? null,
        nowSec,
        nowSec,
      )
      .run();
    return c.json({ ok: true });
  })

  .delete("/subscribe", zValidator("json", z.object({ endpoint: z.string().url() })), async (c) => {
    const u = c.get("user");
    const { endpoint } = c.req.valid("json");
    const nowSec = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(
      `UPDATE push_subscriptions SET is_deleted = 1, updated_at = ?
       WHERE endpoint = ? AND user_id = ?`,
    )
      .bind(nowSec, endpoint, u.userId)
      .run();
    return c.body(null, 204);
  });
