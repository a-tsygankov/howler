import type { Context, MiddlewareHandler, Next } from "hono";
import { authFromHeaders, type AuthInfo } from "../auth.ts";
import type { Bindings } from "../env.ts";

export interface AuthVars {
  auth: AuthInfo;
  // Narrowed view of `auth` set by requireUser; saves the inline
  // discriminant check in every user-only handler.
  user: { homeId: string; userId: string };
  device: { homeId: string; deviceId: string };
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
    c.set("user", { homeId: info.homeId, userId: info.userId });
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
    c.set("device", { homeId: info.homeId, deviceId: info.deviceId });
    await next();
    return undefined;
  };
};

/// Phase 6 OTA admin gate. Requires a user token whose home_id
/// appears in the comma-separated `ADMIN_HOMES` env var. There's
/// no first-class admin concept yet — this is the F1 placeholder
/// per docs/ota.md. When a real role / permission system lands,
/// swap the body to consult that instead; the call sites stay the
/// same. Returns 403 for missing or non-matching auth (deliberately
/// indistinguishable so a hostile caller can't probe the list).
export const requireAdmin = (): MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AuthVars;
}> => {
  return async (c, next) => {
    const info = c.get("auth");
    if (!info || info.type !== "user") {
      return c.json({ error: "admin-only" }, 403);
    }
    const list = (c.env.ADMIN_HOMES ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (list.length === 0 || !list.includes(info.homeId)) {
      return c.json({ error: "admin-only" }, 403);
    }
    c.set("user", { homeId: info.homeId, userId: info.userId });
    await next();
    return undefined;
  };
};

/// Tiny middleware that bumps `devices.last_seen_at = now()` for any
/// authenticated request bearing a device token. Fire-and-forget via
/// executionCtx.waitUntil so we don't block the response — a one-row
/// UPDATE on the devices table is cheap, but a request can hit the
/// dashboard endpoint dozens of times an hour and we want zero
/// latency cost. Webapp Settings reads `last_seen_at` to render the
/// "device alive ___ ago" indicator.
import { clock } from "../clock.ts";
export const markDeviceAlive = (): MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AuthVars;
}> => {
  return async (c, next) => {
    const info = c.get("auth");
    if (info && info.type === "device") {
      const deviceId = info.deviceId;
      const nowSec = clock().nowSec();
      const p = c.env.DB
        .prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?")
        .bind(nowSec, deviceId)
        .run();
      if (c.executionCtx && typeof c.executionCtx.waitUntil === "function") {
        c.executionCtx.waitUntil(p);
      } else {
        // Tests don't have executionCtx; await is fine in that path.
        await p.catch(() => {});
      }
    }
    await next();
    return undefined;
  };
};
