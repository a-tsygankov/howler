import { clock } from "./clock.ts";
import { Hono } from "hono";
import type { Bindings, OccurrenceFireMessage } from "./env.ts";
import { tasksRouter } from "./routes/tasks.ts";
import { authRouter } from "./routes/auth.ts";
import { pairRouter } from "./routes/pair.ts";
import { occurrencesRouter } from "./routes/occurrences.ts";
import { labelsRouter } from "./routes/labels.ts";
import { taskResultsRouter } from "./routes/task-results.ts";
import { usersRouter } from "./routes/users.ts";
import { devicesRouter } from "./routes/devices.ts";
import { scheduleTemplatesRouter } from "./routes/schedule-templates.ts";
import { avatarsRouter } from "./routes/avatars.ts";
import { homesRouter } from "./routes/homes.ts";
import { pushRouter } from "./routes/push.ts";
import type { AuthVars } from "./middleware/auth.ts";
import { consumeFireQueue, scheduledFanout } from "./services/fanout.ts";
import { log, reqIdFor } from "./logger.ts";

const app = new Hono<{ Bindings: Bindings; Variables: AuthVars }>();

// One JSON line per request (Logpush ingests these). Skip the noisy
// /api/health probe; everything else logs method+path+status.
app.use("*", async (c, next) => {
  const reqId = reqIdFor(c.req.raw);
  const start = clock().nowMs();
  await next();
  const path = new URL(c.req.url).pathname;
  if (path === "/api/health") return;
  log.info("request", {
    reqId,
    method: c.req.method,
    path,
    status: c.res.status,
    durationMs: clock().nowMs() - start,
  });
});

app.get("/api/health", (c) =>
  c.json({ ok: true, env: c.env.ENVIRONMENT, ts: clock().nowMs() }),
);

app.route("/api/auth", authRouter);
app.route("/api/pair", pairRouter);
app.route("/api/tasks", tasksRouter);
app.route("/api/occurrences", occurrencesRouter);
app.route("/api/labels", labelsRouter);
app.route("/api/task-results", taskResultsRouter);
app.route("/api/users", usersRouter);
app.route("/api/devices", devicesRouter);
app.route("/api/schedule-templates", scheduleTemplatesRouter);
app.route("/api/avatars", avatarsRouter);
app.route("/api/homes", homesRouter);
app.route("/api/push", pushRouter);

app.notFound((c) => c.json({ error: "not-found" }, 404));

app.onError((err, c) => {
  log.error("unhandled", {
    reqId: reqIdFor(c.req.raw),
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    error: err.message,
    stack: err.stack,
  });
  return c.json({ error: "internal", message: err.message }, 500);
});

// One Worker, three entry points (plan §5.2).
export default {
  fetch: app.fetch,

  async scheduled(
    _event: ScheduledEvent,
    env: Bindings,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      scheduledFanout(env)
        .then((n) => {
          if (n > 0) log.info("cron-fanout", { enqueued: n });
        })
        .catch((e) => log.error("cron-fanout-failed", { error: String(e) })),
    );
  },

  async queue(
    batch: MessageBatch<OccurrenceFireMessage>,
    env: Bindings,
    _ctx: ExecutionContext,
  ): Promise<void> {
    await consumeFireQueue(env, batch);
  },
};
