import { Hono } from "hono";
import type { Bindings, OccurrenceFireMessage } from "./env.ts";
import { tasksRouter } from "./routes/tasks.ts";
import { authRouter } from "./routes/auth.ts";
import { pairRouter } from "./routes/pair.ts";
import type { AuthVars } from "./middleware/auth.ts";

const app = new Hono<{ Bindings: Bindings; Variables: AuthVars }>();

app.get("/api/health", (c) =>
  c.json({ ok: true, env: c.env.ENVIRONMENT, ts: Date.now() }),
);

app.route("/api/auth", authRouter);
app.route("/api/pair", pairRouter);
app.route("/api/tasks", tasksRouter);

app.notFound((c) => c.json({ error: "not-found" }, 404));

app.onError((err, c) => {
  console.error("[howler-api]", err);
  return c.json({ error: "internal", message: err.message }, 500);
});

// One Worker, three entry points (plan §5.2).
export default {
  fetch: app.fetch,

  // Cron: enqueue due schedules onto the queue and return.
  // Per-occurrence work runs in queue() below — keeps fan-out off the
  // CPU-time budget of the cron tick.
  async scheduled(
    _event: ScheduledEvent,
    _env: Bindings,
    _ctx: ExecutionContext,
  ): Promise<void> {
    // Phase 1 step 2: SELECT schedules WHERE next_fire_at <= now LIMIT 100;
    // for each, env.OCCURRENCE_QUEUE.send({scheduleId, dueAt}).
  },

  async queue(
    _batch: MessageBatch<OccurrenceFireMessage>,
    _env: Bindings,
    _ctx: ExecutionContext,
  ): Promise<void> {
    // Phase 1 step 2: per-message INSERT occurrence(PENDING) + advance schedule.next_fire_at.
  },
};
