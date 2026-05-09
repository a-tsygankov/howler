import { clock } from "../clock.ts";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Bindings } from "../env.ts";
import { markDeviceAlive, requireAuth, requireUser, type AuthVars } from "../middleware/auth.ts";

const Hex32 = z.string().regex(/^[0-9a-f]{32}$/);

const UpdateHome = z.object({
  displayName: z.string().min(1).max(80).optional(),
  tz: z.string().min(1).max(64).optional(),
  avatarId: Hex32.nullable().optional(),
});

// Public router: GET /peek accepts BOTH user and device tokens; the
// device firmware uses it to gate the four-fetch sync round, and a
// future webapp client could too. Mounted before the user-only
// `.use(requireUser)` chain below.
const peekRouter = new Hono<{ Bindings: Bindings; Variables: AuthVars }>()
  .use("*", requireAuth(), markDeviceAlive())
  // GET /api/homes/peek → { counter }. The device caches the value
  // returned and only fires the four sync fetches when the next
  // peek's counter differs. Counter is bumped server-side by the
  // 0012 migration's triggers on every mutation of any home-scoped
  // entity (tasks, schedules, occurrences, users, labels,
  // task_results, task_executions, avatars, task_assignments).
  // Cost: a single SELECT against the `homes` row vs. ~7 D1 reads
  // for a full sync round. ~10x fewer reads on idle rounds.
  .get("/", async (c) => {
    const homeId = c.get("auth").homeId;
    const row = await c.env.DB
      .prepare("SELECT update_counter FROM homes WHERE id = ?")
      .bind(homeId)
      .first<{ update_counter: number }>();
    if (!row) return c.json({ error: "not-found" }, 404);
    return c.json({ counter: row.update_counter });
  });

export const homesRouter = new Hono<{
  Bindings: Bindings;
  Variables: AuthVars;
}>()
  .route("/peek", peekRouter)

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
