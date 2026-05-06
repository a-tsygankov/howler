import type { Context, MiddlewareHandler, Next } from "hono";
import { authFromHeaders, type AuthInfo } from "../auth.ts";
import type { Bindings } from "../env.ts";

export interface AuthVars {
  auth: AuthInfo;
}

export const requireAuth = (): MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AuthVars;
}> => {
  return async (c: Context<{ Bindings: Bindings; Variables: AuthVars }>, next: Next) => {
    const secret = c.env.AUTH_SECRET;
    if (!secret) {
      console.error("[auth] AUTH_SECRET not set; refusing request");
      return c.json({ error: "auth-not-configured" }, 500);
    }
    const info = await authFromHeaders(c.req.raw.headers, secret);
    if (!info) return c.json({ error: "unauthorized" }, 401);
    c.set("auth", info);
    await next();
    return undefined;
  };
};

export const requireUser = (): MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AuthVars;
}> => {
  return async (c, next) => {
    const info = c.get("auth");
    if (!info || info.type !== "user") {
      return c.json({ error: "user-token-required" }, 403);
    }
    await next();
    return undefined;
  };
};

export const requireDevice = (): MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AuthVars;
}> => {
  return async (c, next) => {
    const info = c.get("auth");
    if (!info || info.type !== "device") {
      return c.json({ error: "device-token-required" }, 403);
    }
    await next();
    return undefined;
  };
};
