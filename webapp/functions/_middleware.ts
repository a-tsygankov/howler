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
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
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
