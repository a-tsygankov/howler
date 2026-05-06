// Structured JSON logger. Cloudflare Logpush ingests `console.log`
// output line-by-line; emitting JSON-shaped lines lets the consumer
// (Logpush → R2 → query tool) treat each line as a structured event.
//
// Plan §18 Phase 3.3. Pairs with Workers Analytics Engine
// (observability.ts) — analytics is the metrics pane (counts,
// histograms), logs is the event detail pane (request, error, trace).

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  // Common fields surfaced as top-level for cheap filtering.
  reqId?: string;
  path?: string;
  method?: string;
  status?: number;
  homeId?: string;
  userId?: string;
  [k: string]: unknown;
}

const fmt = (level: LogLevel, msg: string, ctx?: LogContext): string =>
  JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...ctx,
  });

export const log = {
  debug: (msg: string, ctx?: LogContext): void => {
    console.log(fmt("debug", msg, ctx));
  },
  info: (msg: string, ctx?: LogContext): void => {
    console.log(fmt("info", msg, ctx));
  },
  warn: (msg: string, ctx?: LogContext): void => {
    console.warn(fmt("warn", msg, ctx));
  },
  error: (msg: string, ctx?: LogContext): void => {
    console.error(fmt("error", msg, ctx));
  },
};

/** Per-request id helper. Cloudflare adds `cf-ray` automatically;
 *  we include it in our own logs so a single request can be traced
 *  across structured logs + analytics events. */
export const reqIdFor = (req: Request): string =>
  req.headers.get("cf-ray") ??
  // local dev / tests fall back to a synthesised id
  `local-${Math.random().toString(36).slice(2, 10)}`;
