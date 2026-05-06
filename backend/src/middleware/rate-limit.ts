import type { Context, MiddlewareHandler, Next } from "hono";
import type { Bindings } from "../env.ts";

// Cloudflare's RateLimiter binding ignores keys longer than ~96 chars
// poorly; we keep our composed keys well under that. The fallback to
// "anon" + cf-connecting-ip handles unauthenticated paths.
const ipFromHeaders = (c: Context): string =>
  c.req.header("cf-connecting-ip") ??
  c.req.header("x-forwarded-for") ??
  "unknown";

/**
 * Rate-limit middleware. `keyFn` returns either a string (per-request
 * unique enough to bucket attackers separately from honest users) or
 * null to skip the check entirely (e.g. /quick-setup without a
 * pairCode is benign).
 */
export const rateLimit = (
  scope: string,
  keyFn?: (c: Context<{ Bindings: Bindings }>) => string | null | Promise<string | null>,
): MiddlewareHandler<{ Bindings: Bindings }> => {
  return async (c, next: Next) => {
    // In tests / local dev the binding isn't wired; skip silently.
    if (!c.env.RATE_LIMITER) {
      await next();
      return undefined;
    }
    const id = keyFn ? await keyFn(c) : ipFromHeaders(c);
    if (id === null) {
      await next();
      return undefined;
    }
    const key = `${scope}:${id}`;
    const { success } = await c.env.RATE_LIMITER.limit({ key });
    if (!success) {
      c.header("Retry-After", "60");
      return c.json({ error: "rate-limited" }, 429);
    }
    await next();
    return undefined;
  };
};
