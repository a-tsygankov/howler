/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, expect, it } from "vitest";
import { presignR2GetUrl, r2CredentialsFromEnv } from "../src/services/r2-presign.ts";
import type { Bindings } from "../src/env.ts";

// Pure-unit tests for the SigV4 query-string presigner. No
// network — we don't actually fetch the URL, only verify it has
// the right shape + that the signature is deterministic for fixed
// inputs (so a future refactor of the signing math fails the test
// instead of going silently wrong against R2).

const exampleCreds = {
  accountId: "test-account",
  // Standard AWS V4 example creds — same pair AWS uses in their
  // signing-spec walkthroughs. Keeps the math reproducible if you
  // hand-cross-check against the AWS docs.
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

// Pinned timestamp so the signature is deterministic. 2026-05-10
// 04:42:12 UTC.
const FIXED_NOW_MS = Date.UTC(2026, 4, 10, 4, 42, 12);

describe("r2-presign — SigV4 URL minter", () => {
  it("produces a URL with all required query params + a signature", async () => {
    const url = await presignR2GetUrl(
      exampleCreds,
      "howler-firmware",
      "firmware/firmware-1.4.2.bin",
      300,
      FIXED_NOW_MS,
    );

    const u = new URL(url);
    expect(u.protocol).toBe("https:");
    expect(u.host).toBe("test-account.r2.cloudflarestorage.com");
    expect(u.pathname).toBe("/howler-firmware/firmware/firmware-1.4.2.bin");

    const q = u.searchParams;
    expect(q.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(q.get("X-Amz-Credential")).toMatch(
      /^AKIAIOSFODNN7EXAMPLE\/\d{8}\/auto\/s3\/aws4_request$/,
    );
    expect(q.get("X-Amz-Date")).toMatch(/^\d{8}T\d{6}Z$/);
    expect(q.get("X-Amz-Expires")).toBe("300");
    expect(q.get("X-Amz-SignedHeaders")).toBe("host");
    // Signature: lowercase 64-hex (SHA-256 HMAC output).
    expect(q.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("signature is deterministic for fixed creds + key + timestamp", async () => {
    const url1 = await presignR2GetUrl(
      exampleCreds, "howler-firmware",
      "firmware/firmware-1.4.2.bin", 300, FIXED_NOW_MS,
    );
    const url2 = await presignR2GetUrl(
      exampleCreds, "howler-firmware",
      "firmware/firmware-1.4.2.bin", 300, FIXED_NOW_MS,
    );
    expect(url1).toBe(url2);
  });

  it("signature changes when ANY input changes (key, ttl, time)", async () => {
    const base = await presignR2GetUrl(
      exampleCreds, "howler-firmware",
      "firmware/firmware-1.4.2.bin", 300, FIXED_NOW_MS,
    );
    const sigOf = (u: string) =>
      new URL(u).searchParams.get("X-Amz-Signature");

    // Different key
    const otherKey = await presignR2GetUrl(
      exampleCreds, "howler-firmware",
      "firmware/firmware-1.5.0.bin", 300, FIXED_NOW_MS,
    );
    expect(sigOf(otherKey)).not.toBe(sigOf(base));

    // Different ttl
    const otherTtl = await presignR2GetUrl(
      exampleCreds, "howler-firmware",
      "firmware/firmware-1.4.2.bin", 600, FIXED_NOW_MS,
    );
    expect(sigOf(otherTtl)).not.toBe(sigOf(base));

    // Different time (one minute later)
    const otherTime = await presignR2GetUrl(
      exampleCreds, "howler-firmware",
      "firmware/firmware-1.4.2.bin", 300, FIXED_NOW_MS + 60_000,
    );
    expect(sigOf(otherTime)).not.toBe(sigOf(base));
  });

  it("clamps TTL to S3's [1, 7d] range", async () => {
    const tooShort = await presignR2GetUrl(
      exampleCreds, "howler-firmware", "x.bin", 0, FIXED_NOW_MS,
    );
    expect(new URL(tooShort).searchParams.get("X-Amz-Expires")).toBe("1");

    const tooLong = await presignR2GetUrl(
      exampleCreds, "howler-firmware", "x.bin", 999_999, FIXED_NOW_MS,
    );
    expect(new URL(tooLong).searchParams.get("X-Amz-Expires")).toBe("604800");
  });

  it("encodes object keys path-style (slashes literal, special chars escaped)", async () => {
    const url = await presignR2GetUrl(
      exampleCreds,
      "howler-firmware",
      "firmware/v 2.0+rc1/build.bin", // spaces + plus
      300,
      FIXED_NOW_MS,
    );
    const u = new URL(url);
    // Slashes between path segments stay literal.
    expect(u.pathname).toContain("/firmware/");
    // Spaces become %20, plus becomes %2B (RFC 3986).
    expect(u.pathname).toContain("v%202.0%2Brc1");
    expect(u.pathname).toContain("build.bin");
  });
});

describe("r2-presign — credential env loader", () => {
  it("returns null when any of the three vars are missing", () => {
    const partial = {
      R2_ACCOUNT_ID: "x",
      R2_ACCESS_KEY_ID: "y",
      // R2_SECRET_ACCESS_KEY missing
    } as Bindings;
    expect(r2CredentialsFromEnv(partial)).toBeNull();
  });

  it("returns the creds object when all three are set", () => {
    const full = {
      R2_ACCOUNT_ID: "acct-123",
      R2_ACCESS_KEY_ID: "AK...",
      R2_SECRET_ACCESS_KEY: "SK...",
    } as Bindings;
    expect(r2CredentialsFromEnv(full)).toEqual({
      accountId: "acct-123",
      accessKeyId: "AK...",
      secretAccessKey: "SK...",
    });
  });

  it("treats empty strings as missing (a misconfigured deploy doesn't accidentally sign with '')", () => {
    const empty = {
      R2_ACCOUNT_ID: "",
      R2_ACCESS_KEY_ID: "y",
      R2_SECRET_ACCESS_KEY: "z",
    } as Bindings;
    expect(r2CredentialsFromEnv(empty)).toBeNull();
  });
});
