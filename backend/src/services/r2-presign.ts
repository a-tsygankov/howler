// Cloudflare R2 presigned-URL minter.
//
// Phase 6 OTA slice F3. The dial calls /api/firmware/check with
// its current fwVersion; when there's a newer eligible release,
// the Worker mints a SigV4-presigned GET URL against R2's S3
// endpoint and hands it back. The dial then GETs the URL
// directly — no Cloudflare auth on the R2 edge, signature carries
// the right to read for the duration we set.
//
// We implement SigV4 manually with crypto.subtle to avoid pulling
// the @aws-sdk/* tree into the Worker bundle. Same pattern
// services/push.ts uses for VAPID JWT signing — keeps the bundle
// small and avoids node-only deps.
//
// Reference: AWS Signature Version 4 query-string auth
// https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
// R2-specific notes:
//   - endpoint: https://<account-id>.r2.cloudflarestorage.com
//   - region:   "auto"
//   - service:  "s3"
//   - payload:  UNSIGNED-PAYLOAD (presigned GETs don't sign body)

import type { Bindings } from "../env.ts";

const ALGORITHM = "AWS4-HMAC-SHA256";
const REGION = "auto";
const SERVICE = "s3";

export interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/// Pull R2 creds from env. Returns null if any of the three
/// secrets are missing — callers fall back to the raw r2Key in
/// that case (staging without R2 API creds still works, just no
/// downloadUrl).
export const r2CredentialsFromEnv = (env: Bindings): R2Credentials | null => {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    return null;
  }
  return {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  };
};

/// Mint a presigned GET URL for `bucket/key`. `expiresInSec` is
/// the URL's TTL — minimum 1 s, maximum 7 days (S3 hard cap).
/// `nowMs` lets tests pin the request time so the resulting
/// signature is deterministic across runs; production passes
/// `Date.now()` (or relies on the default).
export const presignR2GetUrl = async (
  creds: R2Credentials,
  bucket: string,
  key: string,
  expiresInSec: number,
  nowMs: number = Date.now(),
): Promise<string> => {
  if (expiresInSec < 1) expiresInSec = 1;
  if (expiresInSec > 604800) expiresInSec = 604800; // 7-day S3 cap

  const host = `${creds.accountId}.r2.cloudflarestorage.com`;
  // R2 honours both path-style and virtual-host style. We use
  // path-style (`/<bucket>/<key>`) because it's what the
  // dashboard's pre-signed URLs default to and avoids any
  // CNAME / subdomain assumptions.
  const canonicalUri =
    "/" + encodeRfc3986(bucket) + "/" + encodeKey(key);

  const { amzDate, dateStamp } = formatTimestamp(nowMs);
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;

  // Required query params per the V4 query-string spec. Sorted
  // alphabetically by key — the canonical query string demands it.
  const queryPairs: Array<[string, string]> = [
    ["X-Amz-Algorithm", ALGORITHM],
    ["X-Amz-Credential", `${creds.accessKeyId}/${credentialScope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresInSec)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  queryPairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalQuery = queryPairs
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .join("&");

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = "host";
  // Presigned GETs use UNSIGNED-PAYLOAD — the device fetches the
  // bytes via the signature alone, body isn't part of the hash.
  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await deriveSigningKey(
    creds.secretAccessKey,
    dateStamp,
  );
  const signature = await hmacHex(signingKey, stringToSign);

  return (
    `https://${host}${canonicalUri}?${canonicalQuery}` +
    `&X-Amz-Signature=${signature}`
  );
};

// ── crypto.subtle plumbing ──────────────────────────────────────

const enc = new TextEncoder();

const hex = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
};

const sha256Hex = async (s: string): Promise<string> => {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return hex(buf);
};

const hmac = async (
  key: ArrayBuffer | Uint8Array,
  msg: string,
): Promise<ArrayBuffer> => {
  const k = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
};

const hmacHex = async (
  key: ArrayBuffer,
  msg: string,
): Promise<string> => hex(await hmac(key, msg));

const deriveSigningKey = async (
  secretAccessKey: string,
  dateStamp: string,
): Promise<ArrayBuffer> => {
  const kSecret = enc.encode("AWS4" + secretAccessKey);
  const kDate = await hmac(kSecret, dateStamp);
  const kRegion = await hmac(kDate, REGION);
  const kService = await hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
};

// ── encoding helpers ────────────────────────────────────────────

/// RFC 3986 unreserved set per the SigV4 spec. encodeURIComponent
/// is close but escapes too many chars (e.g. `~`); we follow the
/// canonical AWS list: A-Z a-z 0-9 - _ . ~
const encodeRfc3986 = (s: string): string =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );

/// Object keys are encoded path-style — every segment encoded
/// separately so '/' stays literal but spaces / '+' / etc. encode
/// to %20 / %2B.
const encodeKey = (key: string): string =>
  key
    .split("/")
    .map((seg) => encodeRfc3986(seg))
    .join("/");

/// "20260510T044212Z" + "20260510" — both required by V4.
interface Timestamp {
  amzDate: string;
  dateStamp: string;
}
const formatTimestamp = (nowMs: number): Timestamp => {
  const d = new Date(nowMs);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const Y = d.getUTCFullYear().toString();
  const M = pad(d.getUTCMonth() + 1);
  const D = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const m = pad(d.getUTCMinutes());
  const s = pad(d.getUTCSeconds());
  return {
    amzDate: `${Y}${M}${D}T${h}${m}${s}Z`,
    dateStamp: `${Y}${M}${D}`,
  };
};
