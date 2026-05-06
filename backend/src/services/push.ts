import { clock } from "../clock.ts";
// Web Push delivery — RFC 8030 (HTTP push), RFC 8291 (aes128gcm
// encryption), RFC 8292 (VAPID auth). Implemented with crypto.subtle
// so it runs natively in Workers.
//
// Phase 2.6b. The queue consumer calls `dispatchPushForOccurrence`
// after an occurrence is materialised; this module finds active
// subscriptions for the home and POSTs an encrypted payload to each
// subscription's endpoint with a fresh VAPID JWT.

import type { Bindings } from "../env.ts";
import { recordPushDelivery } from "../observability.ts";

// ── Base64url ────────────────────────────────────────────────────────

const b64urlEncode = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
};

const b64urlDecode = (s: string): Uint8Array => {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

// ── HKDF helpers (RFC 5869) — crypto.subtle exposes HKDF directly ────

const hkdfDerive = async (
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
};

// ── VAPID JWT (RFC 8292) — ES256 over P-256 ──────────────────────────

const importVapidPrivateKey = async (
  privateKeyB64Url: string,
  publicKeyB64Url: string,
): Promise<CryptoKey> => {
  const dBytes = b64urlDecode(privateKeyB64Url);
  const pubBytes = b64urlDecode(publicKeyB64Url);
  // Uncompressed point: 0x04 || X (32) || Y (32)
  if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) {
    throw new Error("PUSH_VAPID_PUBLIC_KEY must be 65-byte uncompressed P-256 point");
  }
  const x = b64urlEncode(pubBytes.subarray(1, 33));
  const y = b64urlEncode(pubBytes.subarray(33, 65));
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    d: b64urlEncode(dBytes),
    x,
    y,
    ext: true,
  };
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
};

const buildVapidJwt = async (
  endpoint: string,
  privateKey: CryptoKey,
  contact: string,
): Promise<string> => {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const header = b64urlEncode(
    new TextEncoder().encode(JSON.stringify({ alg: "ES256", typ: "JWT" })),
  );
  const payload = b64urlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        aud: audience,
        exp: clock().nowSec() + 12 * 60 * 60,
        sub: contact,
      }),
    ),
  );
  const signingInput = new TextEncoder().encode(`${header}.${payload}`);
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    signingInput,
  );
  return `${header}.${payload}.${b64urlEncode(sig)}`;
};

// ── Payload encryption (RFC 8291 § 3, "aes128gcm") ───────────────────

const KEY_INFO = new TextEncoder().encode("WebPush: info\0");
const CEK_INFO = new TextEncoder().encode("Content-Encoding: aes128gcm\0");
const NONCE_INFO = new TextEncoder().encode("Content-Encoding: nonce\0");
const RECORD_SIZE = 4096;

const concatBytes = (...arrs: Uint8Array[]): Uint8Array => {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrs) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
};

const encryptPayload = async (
  clientPubKeyB64: string,
  authSecretB64: string,
  payload: Uint8Array,
): Promise<{ body: Uint8Array; serverPub: Uint8Array }> => {
  const clientPub = b64urlDecode(clientPubKeyB64); // 65 bytes uncompressed
  const authSecret = b64urlDecode(authSecretB64); // 16 bytes

  // 1. Generate ephemeral server keypair.
  const ephemeral = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const serverPub = new Uint8Array(
    (await crypto.subtle.exportKey("raw", ephemeral.publicKey)) as ArrayBuffer,
  );

  // 2. Import client public for ECDH.
  const clientPubKey = await crypto.subtle.importKey(
    "raw",
    clientPub,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  // 3. Shared secret (raw ECDH output). The workers-types expose
  // ECDH's public-key field as `$public`; alias it for typecheck
  // while staying spec-compliant at runtime (workerd accepts both).
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", $public: clientPubKey, public: clientPubKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
    ephemeral.privateKey,
    256,
  );
  const shared = new Uint8Array(sharedBits);

  // 4. PRK_key = HKDF(salt=auth_secret, ikm=shared, info="WebPush: info\0|ua_pub|server_pub", length=32)
  const keyInfo = concatBytes(KEY_INFO, clientPub, serverPub);
  const ikm = await hkdfDerive(authSecret, shared, keyInfo, 32);

  // 5. salt = random(16)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // 6. cek = HKDF(salt, ikm, "Content-Encoding: aes128gcm\0", 16)
  const cek = await hkdfDerive(salt, ikm, CEK_INFO, 16);

  // 7. nonce = HKDF(salt, ikm, "Content-Encoding: nonce\0", 12)
  const nonce = await hkdfDerive(salt, ikm, NONCE_INFO, 12);

  // 8. plaintext + 0x02 padding delimiter.
  const padded = concatBytes(payload, new Uint8Array([0x02]));

  // 9. AES-128-GCM encrypt.
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded),
  );

  // 10. Header: salt(16) || rs(4 BE) || idlen(1) || keyid (server_pub, 65 bytes)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, RECORD_SIZE);
  const header = concatBytes(salt, rs, new Uint8Array([serverPub.length]), serverPub);

  return { body: concatBytes(header, ciphertext), serverPub };
};

// ── Top-level: send one push ─────────────────────────────────────────

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  authSecret: string;
}

export interface PushPayload {
  title: string;
  body: string;
  taskId?: string;
  occurrenceId?: string;
}

export interface PushResult {
  ok: boolean;
  status: number;
  /** 404/410 mean the subscription is dead — caller should soft-delete. */
  gone: boolean;
}

export const sendPush = async (
  env: Bindings,
  target: PushTarget,
  payload: PushPayload,
): Promise<PushResult> => {
  if (!env.PUSH_VAPID_PRIVATE_KEY || !env.PUSH_VAPID_PUBLIC_KEY) {
    return { ok: false, status: 0, gone: false };
  }
  const privateKey = await importVapidPrivateKey(
    env.PUSH_VAPID_PRIVATE_KEY,
    env.PUSH_VAPID_PUBLIC_KEY,
  );
  const jwt = await buildVapidJwt(
    target.endpoint,
    privateKey,
    env.VAPID_CONTACT ?? "mailto:noreply@howler.local",
  );

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const { body } = await encryptPayload(target.p256dh, target.authSecret, payloadBytes);

  const res = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: "86400",
      authorization: `vapid t=${jwt}, k=${env.PUSH_VAPID_PUBLIC_KEY}`,
    },
    body,
  });

  recordPushDelivery(env, target.endpoint, res.status, res.ok);
  return {
    ok: res.ok,
    status: res.status,
    gone: res.status === 404 || res.status === 410,
  };
};

// ── Fanout from queue consumer ────────────────────────────────────────

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  user_id: string;
}

interface TaskInfo {
  title: string;
  home_id: string;
}

/**
 * Find active subscriptions for the home that owns this task and
 * send each a push. Subscriptions that report 404/410 are
 * tombstoned. Errors on individual subscriptions don't abort the
 * fanout — we log and move on.
 */
export const dispatchPushForOccurrence = async (
  env: Bindings,
  taskId: string,
  occurrenceId: string,
): Promise<void> => {
  if (!env.PUSH_VAPID_PRIVATE_KEY) return;

  const task = await env.DB
    .prepare("SELECT title, home_id FROM tasks WHERE id = ? AND is_deleted = 0")
    .bind(taskId)
    .first<TaskInfo>();
  if (!task) return;

  const { results: subs } = await env.DB
    .prepare(
      `SELECT id, endpoint, p256dh, auth_secret, user_id
       FROM push_subscriptions
       WHERE home_id = ? AND is_deleted = 0`,
    )
    .bind(task.home_id)
    .all<SubscriptionRow>();
  if (subs.length === 0) return;

  const payload: PushPayload = {
    title: task.title,
    body: "Reminder",
    taskId,
    occurrenceId,
  };

  const dead: string[] = [];
  for (const s of subs) {
    try {
      const r = await sendPush(env, {
        endpoint: s.endpoint,
        p256dh: s.p256dh,
        authSecret: s.auth_secret,
      }, payload);
      if (r.gone) dead.push(s.id);
      else if (!r.ok) {
        console.warn(`[push] ${s.id} failed status=${r.status}`);
      }
    } catch (e) {
      console.warn(`[push] ${s.id} threw:`, e);
    }
  }
  if (dead.length > 0) {
    const placeholders = dead.map(() => "?").join(",");
    await env.DB
      .prepare(
        `UPDATE push_subscriptions SET is_deleted = 1, updated_at = ?
         WHERE id IN (${placeholders})`,
      )
      .bind(clock().nowSec(), ...dead)
      .run();
  }
};
