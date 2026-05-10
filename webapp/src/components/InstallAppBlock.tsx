// Settings → "Add to Home Screen" tile. Three render paths:
//
//   1. Already installed (display-mode: standalone OR
//      navigator.standalone) — show "Already on your home screen ✓"
//      with no action.
//   2. Browser captured `beforeinstallprompt` — show "Install" button
//      that triggers the OS install dialog.
//   3. iOS Safari (no beforeinstallprompt support) — show
//      "Tap Share → Add to Home Screen" instructions, illustrated
//      with the standard Share glyph so the user knows what icon to
//      look for.
//
// The "instructions" path also covers desktop Firefox / desktop Safari
// where there's no install affordance at all — the user is told to
// bookmark the page, which is the closest available primitive.

import { useEffect, useState } from "react";
import { Sheet } from "./Sheet";
import {
  detectInstallPlatform,
  hasInstallPrompt,
  isStandalonePwa,
  subscribeInstallPrompt,
  triggerInstallPrompt,
  type InstallPlatform,
} from "../lib/install-prompt";

export const InstallAppBlock = () => {
  const [installed, setInstalled] = useState(() => isStandalonePwa());
  const [hasPrompt, setHasPrompt] = useState(() => hasInstallPrompt());
  const [platform] = useState<InstallPlatform>(() => detectInstallPlatform());
  const [showInstructions, setShowInstructions] = useState(false);
  const [outcome, setOutcome] = useState<
    null | "accepted" | "dismissed" | "unavailable"
  >(null);

  // Subscribe to the global install-prompt cache so the Install
  // button surfaces / hides as the browser fires `beforeinstallprompt`
  // and `appinstalled`. Mount-time check covers the case where the
  // event fired before this component mounted.
  useEffect(() => {
    const sync = () => {
      setHasPrompt(hasInstallPrompt());
      setInstalled(isStandalonePwa());
    };
    sync();
    return subscribeInstallPrompt(sync);
  }, []);

  const onInstallClick = async () => {
    setOutcome(null);
    const r = await triggerInstallPrompt();
    setOutcome(r);
    if (r === "unavailable") {
      // Browser dropped the prompt — fall back to the manual
      // instructions sheet so the user has a path forward.
      setShowInstructions(true);
    }
  };

  if (installed) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-line-soft bg-paper-2 px-3 py-3 text-sm">
        <span className="text-ink">Already on your home screen</span>
        <span className="text-accent-sage" aria-hidden>✓</span>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        {hasPrompt ? (
          <button
            type="button"
            onClick={onInstallClick}
            className="rounded-lg border border-ink bg-ink px-3 py-2 text-sm text-paper transition-colors hover:bg-ink-2"
          >
            Add Howler to home screen
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setShowInstructions(true)}
            className="rounded-lg border border-line-soft bg-paper-2 px-3 py-2 text-sm text-ink transition-colors hover:border-line"
          >
            Show me how
          </button>
        )}
        <p className="cap">
          Launch like a native app — full-screen, on the home screen,
          works offline.
        </p>
        {outcome === "dismissed" && (
          <p className="text-xs text-ink-3">
            No problem — you can install later from this tile.
          </p>
        )}
        {outcome === "accepted" && (
          <p className="text-xs text-accent-sage">
            Installing — check your home screen.
          </p>
        )}
      </div>

      <Sheet
        open={showInstructions}
        onClose={() => setShowInstructions(false)}
        ariaLabel="Add to home screen"
      >
        <InstructionsBody platform={platform} />
        <button
          type="button"
          onClick={() => setShowInstructions(false)}
          className="mt-4 w-full rounded-lg border border-line-soft bg-paper-2 px-3 py-2 text-sm text-ink"
        >
          Done
        </button>
      </Sheet>
    </>
  );
};

const InstructionsBody = ({ platform }: { platform: InstallPlatform }) => {
  if (platform === "ios") {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-ink">
          Add Howler to your iPhone
        </h2>
        <ol className="flex flex-col gap-3 text-sm text-ink-2">
          <li className="flex items-start gap-3">
            <Step n={1} />
            <span>
              Tap the <strong className="text-ink">Share</strong> button
              {" "}
              <ShareGlyph className="-mt-0.5 inline-block align-middle text-ink-2" />
              {" "}at the bottom of Safari.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <Step n={2} />
            <span>
              Scroll and tap{" "}
              <strong className="text-ink">Add to Home Screen</strong>.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <Step n={3} />
            <span>
              Tap <strong className="text-ink">Add</strong>. Howler
              {" "}lands on your home screen alongside your other apps.
            </span>
          </li>
        </ol>
        <p className="cap">
          Tip: open Howler in Safari first — Chrome on iOS doesn't
          support adding web apps to the home screen.
        </p>
      </div>
    );
  }
  if (platform === "android") {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-ink">
          Add Howler to your Android home screen
        </h2>
        <ol className="flex flex-col gap-3 text-sm text-ink-2">
          <li className="flex items-start gap-3">
            <Step n={1} />
            <span>
              Tap the browser menu (⋮ in the top-right) in Chrome,
              {" "}Edge, or Brave.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <Step n={2} />
            <span>
              Tap{" "}
              <strong className="text-ink">
                Install app
              </strong>{" "}or{" "}
              <strong className="text-ink">Add to home screen</strong>.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <Step n={3} />
            <span>Confirm — Howler appears on your home screen.</span>
          </li>
        </ol>
        <p className="cap">
          If those options aren't there, your browser already let
          {" "}you install on a previous visit. Look for the icon on
          {" "}your launcher.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-ink">Install Howler</h2>
      <ul className="flex flex-col gap-3 text-sm text-ink-2">
        <li className="flex items-start gap-3">
          <Step n="C" />
          <span>
            <strong className="text-ink">Chrome / Edge</strong>: look
            for the install icon in the address bar (looks like a
            monitor with a down-arrow), or use the browser menu →
            Install Howler.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <Step n="S" />
          <span>
            <strong className="text-ink">Safari (Mac)</strong>: Share →
            Add to Dock.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <Step n="F" />
          <span>
            <strong className="text-ink">Firefox</strong>: doesn't
            support PWA installs — you can bookmark this page instead
            (Cmd/Ctrl + D).
          </span>
        </li>
      </ul>
    </div>
  );
};

const Step = ({ n }: { n: number | string }) => (
  <span
    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-paper"
    aria-hidden
  >
    {n}
  </span>
);

// iOS-style Share glyph rendered inline so users recognise the icon
// from Safari without needing a screenshot.
const ShareGlyph = ({ className = "" }: { className?: string }) => (
  <svg
    width="16"
    height="20"
    viewBox="0 0 16 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
  >
    <path d="M8 1v12" />
    <path d="M4 5l4-4 4 4" />
    <path d="M2 9v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9" />
  </svg>
);
