// Shared photo-upload trigger for the home / user / task avatar
// editors. Renders as a labelled file picker (the <input type="file">
// is hidden; the surrounding <label> is the click target so the
// styling matches the icon-preset buttons next to it).
//
// Why a dedicated component, not inline JSX in each editor: the three
// call sites (HomeAvatarTile, UserRowEditor, TaskAvatarPicker) had
// drifting copies of the same upload + busy + error logic — extracting
// it locks down the rejection-message UX and makes it trivial to add
// shared niceties (size validation pre-upload, drag-and-drop later).
//
// The caller hands us `onUploaded(avatarId)` and decides what to do
// with the new id (commit to the home, stage on a draft, etc).
// Errors are surfaced inline as a tiny red caption — the upload
// endpoint returns 413 / 415 / 400 with self-descriptive messages
// (see backend/src/routes/avatars.ts), so we relay verbatim.

import { type ReactNode, useId, useState } from "react";
import { uploadAvatar } from "../lib/api";

export interface AvatarUploadButtonProps {
  onUploaded: (avatarId: string) => void;
  /** Inline visual style. "outline" = the default Settings tile look,
   *  "tile" = compact icon-grid sized button (matches the 28-px icon
   *  buttons in the user/task pickers). */
  variant?: "outline" | "tile";
  /** Override the default label. Defaults to "Upload photo" / 📷. */
  label?: ReactNode;
  /** Disable while a parent operation is in flight. */
  disabled?: boolean;
}

export const AvatarUploadButton = ({
  onUploaded,
  variant = "outline",
  label,
  disabled = false,
}: AvatarUploadButtonProps) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { id: avatarId } = await uploadAvatar(file);
      onUploaded(avatarId);
    } catch (err) {
      // The api helper throws Error objects whose `message` carries
      // the server's JSON `error` field. 413 → "max 2097152 bytes",
      // 415 → "only jpeg/png/webp", 400 → "file field required".
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.warn("avatar upload failed", err);
    } finally {
      setBusy(false);
      // Clear the input so re-picking the same file fires onChange
      // again. Without this, picking → cancelling → re-picking the
      // same file is a silent no-op.
      e.target.value = "";
    }
  };

  const buttonClass =
    variant === "tile"
      ? `flex h-7 w-7 items-center justify-center rounded-md border text-[12px] ${
          busy
            ? "border-line-soft text-ink-3"
            : "border-line text-ink-3 hover:border-ink hover:text-ink"
        }`
      : `inline-flex items-center gap-2 rounded-md border border-line-soft bg-paper-2 px-2.5 py-1 text-xs text-ink transition-colors ${
          busy ? "opacity-60" : "hover:border-line"
        }`;

  return (
    <div className={variant === "tile" ? "" : "flex flex-col gap-1"}>
      <label
        htmlFor={id}
        className={`${buttonClass} ${disabled || busy ? "cursor-wait" : "cursor-pointer"}`}
        title="Upload a photo (JPEG, PNG, or WebP, up to 2 MB)"
      >
        <input
          id={id}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onPick}
          disabled={disabled || busy}
          className="hidden"
        />
        {busy ? "…" : (label ?? (variant === "tile" ? "📷" : "Upload photo"))}
      </label>
      {error && variant !== "tile" && (
        <p className="text-[11px] text-accent-rose">{error}</p>
      )}
    </div>
  );
};
