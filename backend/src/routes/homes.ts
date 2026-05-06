import { clock } from "../clock.ts";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings } from "../env.ts";
import { requireAuth, requireUser, type AuthVars } from "../middleware/auth.ts";

const Hex32 = z.string().regex(/^[0-9a-f]{32}$/);

const UpdateHome = z.object({
  displayName: z.string().min(1).max(80).optional(),
  tz: z.string().min(1).max(64).optional(),
  avatarId: Hex32.nullable().optional(),
});

export const homesRouter = new Hono<{
  Bindings: Bindings;
  Variables: AuthVars;
}>()
  .use("*", requireAuth(), requireUser())

  .patch("/me", zValidator("json", UpdateHome), async (c) => {
    const u = c.get("user");
    const patch = c.req.valid("json");
    const sets: string[] = [];
    const binds: unknown[] = [];
    if (patch.displayName !== undefined) {
      sets.push("display_name = ?");
      binds.push(patch.displayName);
    }
    if (patch.tz !== undefined) {
      sets.push("tz = ?");
      binds.push(patch.tz);
    }
    if (patch.avatarId !== undefined) {
      sets.push("avatar_id = ?");
      binds.push(patch.avatarId);
    }
    if (sets.length === 0) return c.body(null, 204);
    sets.push("updated_at = ?");
    binds.push(clock().nowSec());
    binds.push(u.homeId);
    await c.env.DB.prepare(`UPDATE homes SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...binds)
      .run();
    return c.body(null, 204);
  });
