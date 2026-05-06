import { clock } from "./clock.ts";
// PIN-based account auth + dual-token issuance.
//
// Ported from Feedme `backend/src/auth.ts`. Differences:
//   - Subject is `userId` (32-hex), not Feedme's `hid`.
//   - `username` is the human-typeable handle for /login lookups.
//     `userId` lives only in tokens.
//   - Transparent users have NULL pin_salt + pin_hash (in Feedme they
//     were empty strings — both flavours are accepted by isTransparent
//     so the check never disagrees with future migrations).
//
// PBKDF2-SHA256, 100k iterations, 32-byte derived key, 16-byte salt
// (matches Feedme so password DBs can be migrated 1:1 if needed).
//
// Tokens are `base64url(payload).base64url(hmacSha256(payload))` with
// AUTH_SECRET. UserToken TTL = 30 d; DeviceToken TTL = 365 d.

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_BITS = 256;
const SALT_BYTES = 16;

const USER_TOKEN_TTL_SEC = 30 * 24 * 60 * 60;
const DEVICE_TOKEN_TTL_SEC = 365 * 24 * 60 * 60;
// Selector token bridges PIN/QR-validated → user-picked. Short
// lifetime; only valid for /api/auth/select-user.
const SELECTOR_TOKEN_TTL_SEC = 5 * 60;

const enc = new TextEncoder();

const toHex = (buf: ArrayBuffer | Uint8Array): string =>
  Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

const fromHex = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
};

const b64urlEncode = (s: string): string =>
  btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const b64urlDecode = (s: string): string => {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return atob(t);
};

const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

// ── Transparent-user sentinel ────────────────────────────────────────
export interface PinFields {
  pinSalt: string | null;
  pinHash: string | null;
}

/**
 * A user is "transparent" (no PIN required) when EITHER salt or hash
 * is missing. Treating half-set as transparent means a partial-write
 * recovery path goes through `/api/auth/set-pin` instead of locking
 * the account. PIN-protected users always have both populated.
 */
export const isTransparentUser = (row: PinFields | null | undefined): boolean => {
  if (!row) return false;
  const noSalt = !row.pinSalt || row.pinSalt.length === 0;
  const noHash = !row.pinHash || row.pinHash.length === 0;
  return noSalt || noHash;
};

// ── PIN hashing ─────────────────────────────────────────────────────

export const hashPin = async (
  pin: string,
): Promise<{ salt: string; hash: string }> => {
  const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const salt = toHex(saltBytes);
  const hash = await derivePin(pin, salt);
  return { salt, hash };
};

export const verifyPin = async (
  pin: string,
  salt: string,
  expected: string,
): Promise<boolean> => {
  const got = await derivePin(pin, salt);
  return constantTimeEqual(got, expected);
};

const derivePin = async (pin: string, saltHex: string): Promise<string> => {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: fromHex(saltHex),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    PBKDF2_KEY_BITS,
  );
  return toHex(bits);
};

// ── Tokens ──────────────────────────────────────────────────────────

export type TokenType = "user" | "device" | "selector";

export interface UserTokenPayload {
  type: "user";
  homeId: string;
  userId: string;
  exp: number; // epoch seconds
}

export interface DeviceTokenPayload {
  type: "device";
  homeId: string;
  deviceId: string;
  exp: number;
}

export interface SelectorTokenPayload {
  type: "selector";
  homeId: string;
  exp: number;
}

export type TokenPayload =
  | UserTokenPayload
  | DeviceTokenPayload
  | SelectorTokenPayload;

export type AuthInfo =
  | { type: "user"; homeId: string; userId: string }
  | { type: "device"; homeId: string; deviceId: string };

const hmacKey = (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

const signPayload = async (
  payload: TokenPayload,
  secret: string,
): Promise<string> => {
  const payloadEnc = b64urlEncode(JSON.stringify(payload));
  const key = await hmacKey(secret);
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(payloadEnc));
  const sigBin = String.fromCharCode(...new Uint8Array(sigBuf));
  return `${payloadEnc}.${b64urlEncode(sigBin)}`;
};

export const issueUserToken = (
  homeId: string,
  userId: string,
  secret: string,
): Promise<string> =>
  signPayload(
    {
      type: "user",
      homeId,
      userId,
      exp: clock().nowSec() + USER_TOKEN_TTL_SEC,
    },
    secret,
  );

export const issueDeviceToken = (
  homeId: string,
  deviceId: string,
  secret: string,
): Promise<string> =>
  signPayload(
    {
      type: "device",
      homeId,
      deviceId,
      exp: clock().nowSec() + DEVICE_TOKEN_TTL_SEC,
    },
    secret,
  );

export const issueSelectorToken = (
  homeId: string,
  secret: string,
): Promise<string> =>
  signPayload(
    {
      type: "selector",
      homeId,
      exp: clock().nowSec() + SELECTOR_TOKEN_TTL_SEC,
    },
    secret,
  );

export const verifySelectorToken = async (
  token: string,
  secret: string,
): Promise<SelectorTokenPayload | null> => {
  const p = await verifyToken(token, secret);
  return p && p.type === "selector" ? p : null;
};

export const verifyToken = async (
  token: string,
  secret: string,
): Promise<TokenPayload | null> => {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadEnc, sigEnc] = parts as [string, string];

  const key = await hmacKey(secret);
  const sigBin = b64urlDecode(sigEnc);
  const sigBuf = new Uint8Array(sigBin.length);
  for (let i = 0; i < sigBin.length; i++) sigBuf[i] = sigBin.charCodeAt(i);
  const ok = await crypto.subtle.verify("HMAC", key, sigBuf, enc.encode(payloadEnc));
  if (!ok) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(b64urlDecode(payloadEnc));
  } catch {
    return null;
  }
  if (!isTokenPayload(payload)) return null;
  if (payload.exp < clock().nowSec()) return null;
  return payload;
};

const isTokenPayload = (x: unknown): x is TokenPayload => {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  if (typeof o["exp"] !== "number") return false;
  if (typeof o["homeId"] !== "string") return false;
  if (o["type"] === "user") return typeof o["userId"] === "string";
  if (o["type"] === "device") return typeof o["deviceId"] === "string";
  if (o["type"] === "selector") return true;
  return false;
};

// ── Session cookie ──────────────────────────────────────────────────
// Same shape as Feedme. Set on every successful auth response so
// browsers don't have to remember the Bearer token; the Authorization
// header path remains canonical for the firmware + curl + tests.

const SESSION_COOKIE_NAME = "howler.session";

export const readSessionCookie = (cookieHeader: string | null): string | null => {
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(";")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    return pair.slice(eq + 1).trim();
  }
  return null;
};

export const buildSessionCookie = (token: string): string =>
  `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${USER_TOKEN_TTL_SEC}`;

export const buildClearSessionCookie = (): string =>
  `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

// ── Helpers used by middleware ─────────────────────────────────────

export const authFromHeaders = async (
  headers: Headers,
  secret: string,
): Promise<AuthInfo | null> => {
  const auth = headers.get("authorization") ?? "";
  let token = "";
  if (auth.startsWith("Bearer ")) token = auth.slice("Bearer ".length).trim();
  if (!token) token = readSessionCookie(headers.get("cookie")) ?? "";
  if (!token) return null;
  const payload = await verifyToken(token, secret);
  if (!payload) return null;
  if (payload.type === "device") {
    return {
      type: "device",
      homeId: payload.homeId,
      deviceId: payload.deviceId,
    };
  }
  if (payload.type === "user") {
    return { type: "user", homeId: payload.homeId, userId: payload.userId };
  }
  // selector tokens never authenticate normal routes.
  return null;
};
