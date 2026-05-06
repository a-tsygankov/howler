// Web push subscribe/unsubscribe helpers (Phase 2.6 plumbing).
// The actual delivery from the server is Phase 2.6b — until then,
// browsers will silently drop pushes (proper VAPID encryption is
// required by the Push API spec).

import {
  apiPushSubscribe,
  apiPushUnsubscribe,
  fetchVapidKey,
} from "./api.ts";

const SW_PATH = "/push-sw.js";

const urlBase64ToUint8Array = (b64: string): Uint8Array => {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

const arrayBufferToBase64 = (buf: ArrayBuffer | null): string => {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
};

export const isPushSupported = (): boolean =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

export const currentPermission = (): NotificationPermission =>
  typeof Notification === "undefined" ? "denied" : Notification.permission;

export const subscribePush = async (): Promise<{ ok: boolean; reason?: string }> => {
  if (!isPushSupported()) return { ok: false, reason: "push-unsupported" };
  const key = await fetchVapidKey();
  if (!key) return { ok: false, reason: "vapid-not-configured" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "permission-denied" };

  const reg = await navigator.serviceWorker.register(SW_PATH);
  await navigator.serviceWorker.ready;

  // Re-use an existing subscription if one's already installed for
  // this browser; otherwise create a new one.
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // The Uint8Array → BufferSource interop is fine at runtime; the
      // typings disagree in newer TS lib versions. Cast through unknown.
      applicationServerKey: urlBase64ToUint8Array(key) as unknown as BufferSource,
    });
  }

  await apiPushSubscribe({
    endpoint: sub.endpoint,
    p256dh: arrayBufferToBase64(sub.getKey("p256dh")),
    authSecret: arrayBufferToBase64(sub.getKey("auth")),
    userAgent: navigator.userAgent,
  });
  return { ok: true };
};

export const unsubscribePush = async (): Promise<void> => {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await apiPushUnsubscribe(sub.endpoint);
  await sub.unsubscribe();
};
