// Captures the browser's `beforeinstallprompt` event so the Settings →
// "Add to Home Screen" block can trigger the install dialog whenever
// the user gets to it. The event fires once on a Chrome / Edge / etc.
// page-load when install criteria are met (manifest + service worker
// + HTTPS + not-already-installed); without an early listener, that
// fire-once moment is missed and `prompt()` becomes unreachable.
//
// Module-scoped state — install() in main.tsx attaches the listener
// once at boot, the React hook subscribes to changes for re-renders.

type BeforeInstallPromptEvent = Event & {
  readonly platforms: ReadonlyArray<string>;
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt: () => Promise<void>;
};

let cachedPrompt: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<() => void>();

const notify = () => {
  for (const fn of subscribers) fn();
};

/// One-time setup — call from main.tsx before React mounts so the
/// global `beforeinstallprompt` event is intercepted regardless of
/// when the Settings screen is rendered.
export const installInstallPromptListener = (): void => {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Suppress the browser's automatic mini-infobar — we surface
    // the install option from the Settings tile instead.
    e.preventDefault();
    cachedPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  // Once the user goes through the prompt, clear the cached event
  // (it can only be fired once) and let the UI flip to the
  // "installed" state on next subscribe.
  window.addEventListener("appinstalled", () => {
    cachedPrompt = null;
    notify();
  });
};

/// Trigger the browser's install dialog. Returns the user's choice
/// (or `null` when no prompt is currently available, e.g. iOS Safari
/// or after the user dismissed it once on the same page-load).
export const triggerInstallPrompt = async (): Promise<
  "accepted" | "dismissed" | "unavailable"
> => {
  if (!cachedPrompt) return "unavailable";
  await cachedPrompt.prompt();
  const choice = await cachedPrompt.userChoice;
  // Chrome only allows one prompt per page-load — null out so the
  // hook re-renders into the "instructions" path.
  cachedPrompt = null;
  notify();
  return choice.outcome;
};

/// Reactive subscription used by `useInstallPrompt`.
export const subscribeInstallPrompt = (fn: () => void): (() => void) => {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
};

export const hasInstallPrompt = (): boolean => cachedPrompt !== null;

/// True when the page is being rendered as an installed PWA — either
/// via the standard `display-mode: standalone` media query OR iOS
/// Safari's vendor `navigator.standalone` flag (Safari doesn't
/// implement the standard yet).
export const isStandalonePwa = (): boolean => {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari surfaces the launcher state via this nonstandard
  // boolean. Use a defensive cast — TypeScript's lib.dom doesn't
  // include it.
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
};

/// Coarse platform classifier used by the Settings tile to pick
/// between the OS install dialog (Android Chrome / Edge / etc.) and
/// the manual "Share → Add to Home Screen" instructions (iOS).
/// Desktop falls into "other" — Chrome + Edge desktop ALSO support
/// `beforeinstallprompt` so the install button still works, just
/// without a platform-specific instruction fallback.
export type InstallPlatform = "ios" | "android" | "other";

export const detectInstallPlatform = (): InstallPlatform => {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  // iPadOS reports as Mac in modern Safari; treat any touch-capable
  // Apple device as iOS for the purposes of A2HS instructions.
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (
    /Macintosh/.test(ua) &&
    "ontouchend" in document &&
    "standalone" in navigator
  ) {
    return "ios";
  }
  if (/Android/.test(ua)) return "android";
  return "other";
};
