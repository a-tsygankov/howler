// Pages Functions middleware — runs on every request to the Pages
// project (including the static SPA HTML and the /api/* proxy).
// Adds the security headers we expect to keep through Phase 3 / 4.
//
// CSP notes:
//   - script-src 'self' — the SPA bundle is same-origin; we never
//     inline JS. The Vite-PWA-injected `/registerSW.js` is also
//     same-origin so it's covered.
//   - style-src 'self' 'unsafe-inline' — the current SPA uses inline
//     style={{...}} on most components. Phase 2.8 ports to Tailwind,
//     at which point we can drop 'unsafe-inline'.
//   - font-src adds fonts.gstatic.com so Phase 2.8 (Google Fonts:
//     Fraunces, Source Serif 4, Inter Tight, JetBrains Mono) works
//     without a follow-up CSP change.
//   - connect-src 'self' — /api/* is proxied through Pages Functions
//     so it's same-origin from the browser's view.
//   - img-src 'self' data: blob: — avatars come back through
//     /api/avatars/:id (same-origin via proxy); data:/blob: covers
//     client-side previews before upload.
//   - frame-ancestors 'none' — no embedding.

const CSP = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' lets the browser instantiate WebAssembly
  // modules (onnxruntime-web inside @imgly/background-removal). The
  // flag is not equivalent to 'unsafe-eval' — it allows ONLY
  // `WebAssembly.instantiate()` / `compile()` calls, not arbitrary
  // JS eval. Required for client-side ML; without it the avatar
  // editor's "remove background" toggle fails on first run.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' https://fonts.gstatic.com",
  // data:/blob: covers Worker-spawned model fetches that load via
  // ObjectURL. The avatar editor's bg-removal Web Worker also
  // creates blob: URLs for OffscreenCanvas → ImageBitmap handoffs.
  "img-src 'self' data: blob:",
  // staticimgly.com hosts the @imgly/background-removal model +
  // WASM runtime files. They're cached aggressively in the
  // browser HTTP cache after first download, so the third-party
  // hop is one-time per browser. If we self-host the models in
  // R2 later, this entry can drop back to 'self'.
  "connect-src 'self' https://staticimgly.com",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": CSP,
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

export const onRequest: PagesFunction = async ({ next }) => {
  const res = await next();
  // Don't override headers on responses that already set them
  // (the /api/* proxy passes through Worker responses; the Worker
  // does not currently set CSP, so this layers cleanly).
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!res.headers.has(k)) res.headers.set(k, v);
  }
  return res;
};
