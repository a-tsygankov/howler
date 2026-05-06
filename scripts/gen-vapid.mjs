#!/usr/bin/env node
// One-shot — generate a VAPID keypair (P-256 ECDSA).
// Outputs base64url-encoded public + private keys, ready to paste
// into wrangler.toml [vars] PUSH_VAPID_PUBLIC_KEY and
// `wrangler secret put PUSH_VAPID_PRIVATE_KEY` respectively.
//
// The public key is application-server-key for the browser
// PushManager.subscribe() call (uncompressed point, 65 bytes).
// The private key is the d scalar (32 bytes).

import { webcrypto } from "node:crypto";

const b64url = (buf) =>
  Buffer.from(buf)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

const { publicKey, privateKey } = await webcrypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);

const pubRaw = await webcrypto.subtle.exportKey("raw", publicKey); // 65 bytes
const privJwk = await webcrypto.subtle.exportKey("jwk", privateKey);

const privD = Buffer.from(privJwk.d, "base64url");

console.log("PUSH_VAPID_PUBLIC_KEY  =", b64url(pubRaw));
console.log("PUSH_VAPID_PRIVATE_KEY =", b64url(privD));
