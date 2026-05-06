/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect } from "vitest";
import {
  hashPin,
  verifyPin,
  issueUserToken,
  issueDeviceToken,
  verifyToken,
  isTransparentUser,
} from "../src/auth.ts";

const SECRET = "test-secret-do-not-ship";

describe("PIN hashing", () => {
  it("verifies the pin it derived from", async () => {
    const { salt, hash } = await hashPin("1234");
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyPin("1234", salt, hash)).toBe(true);
  });

  it("rejects the wrong pin", async () => {
    const { salt, hash } = await hashPin("1234");
    expect(await verifyPin("1235", salt, hash)).toBe(false);
  });

  it("rejects pin against the wrong salt", async () => {
    const a = await hashPin("1234");
    const b = await hashPin("1234");
    expect(a.salt).not.toEqual(b.salt);
    expect(await verifyPin("1234", b.salt, a.hash)).toBe(false);
  });
});

describe("transparent user sentinel", () => {
  it("flags null + null as transparent", () => {
    expect(isTransparentUser({ pinSalt: null, pinHash: null })).toBe(true);
  });
  it("flags empty strings as transparent (Feedme back-compat)", () => {
    expect(isTransparentUser({ pinSalt: "", pinHash: "" })).toBe(true);
  });
  it("flags half-set as transparent (defensive)", () => {
    expect(isTransparentUser({ pinSalt: "abc", pinHash: null })).toBe(true);
    expect(isTransparentUser({ pinSalt: null, pinHash: "abc" })).toBe(true);
  });
  it("does not flag a fully-populated row", () => {
    expect(isTransparentUser({ pinSalt: "x".repeat(32), pinHash: "y".repeat(64) })).toBe(
      false,
    );
  });
});

describe("token sign/verify", () => {
  const homeId = "f".repeat(32);
  const userId = "a".repeat(32);
  const deviceId = "b".repeat(32);

  it("round-trips a UserToken", async () => {
    const token = await issueUserToken(homeId, userId, SECRET);
    const payload = await verifyToken(token, SECRET);
    expect(payload?.type).toBe("user");
    expect(payload?.homeId).toBe(homeId);
    if (payload?.type === "user") expect(payload.userId).toBe(userId);
  });

  it("round-trips a DeviceToken with deviceId", async () => {
    const token = await issueDeviceToken(homeId, deviceId, SECRET);
    const payload = await verifyToken(token, SECRET);
    expect(payload?.type).toBe("device");
    expect(payload?.homeId).toBe(homeId);
    if (payload?.type === "device") expect(payload.deviceId).toBe(deviceId);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await issueUserToken(homeId, userId, SECRET);
    expect(await verifyToken(token, "other-secret")).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const token = await issueUserToken(homeId, userId, SECRET);
    const [, sig] = token.split(".");
    const tampered = `${btoa(JSON.stringify({ type: "user", homeId, userId: "evil", exp: Date.now() / 1000 + 100 })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.${sig}`;
    expect(await verifyToken(tampered, SECRET)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const enc = new TextEncoder();
    const payload = JSON.stringify({
      type: "user",
      homeId,
      userId,
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    const payloadEnc = btoa(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(payloadEnc));
    const sigBin = String.fromCharCode(...new Uint8Array(sigBuf));
    const sigEnc = btoa(sigBin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await verifyToken(`${payloadEnc}.${sigEnc}`, SECRET)).toBeNull();
  });
});
