// Shared photo-upload trigger for the home / user / task / label
// avatar editors. Renders as a labelled file picker (the
// <input type="file"> is hidden; the surrounding <label> is the
// click target so the styling matches the icon-preset buttons next
// to it).
//
// On file pick we DON'T upload immediately. Instead we open
// AvatarEditor — a client-side processing sheet that:
//
//   1. decodes the image
//   2. optionally removes the background (lazy-loaded ML)
//   3. resizes to 512×512 + encodes WebP
//   4. shows a preview before commit
//
// Only the FINAL processed Blob round-trips to the Worker; the
// 2-5 MB phone-camera original never touches the network. EXIF is
// stripped as a side-effect of the canvas re-encode (privacy).
//
// The caller hands us `onUploaded(avatarId)` and decides what to
// do with the new id (commit to the home, stage on a draft, etc).

import { type ReactNode, useId, useState } from "react";
import { uploadAvatar } from "../lib/api";
import { AvatarEditor } from "./AvatarEditor";

// Source-side cap before the editor downscales. 8 MB covers a
// typical phone-camera HEIC/JPEG; the editor's WebP output is
// ~30-100 KB regardless. Hard cap exists so a runaway 50 MB drag-
// and-drop doesn't OOM the in-memory decode step.
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const ALLOWED_SOURCE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const fmtBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

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
  const [editorFile, setEditorFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Always reset the input so re-picking the same file fires
    // onChange again. Without this, pick → close-editor → re-pick-
    // same is a silent no-op.
    e.target.value = "";
    if (!file) return;
    if (!ALLOWED_SOURCE_MIME.has(file.type)) {
      setError("only jpeg/png/webp");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setError(
        `max ${fmtBytes(MAX_SOURCE_BYTES)} (got ${fmtBytes(file.size)})`,
      );
      return;
    }
    setError(null);
    setEditorFile(file);
  };

  const handleSave = async (
    processedFile: File,
    bitmap1bit: Uint8Array,
  ) => {
    try {
      const { id: avatarId } = await uploadAvatar(processedFile, bitmap1bit);
      onUploaded(avatarId);
      setEditorFile(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      console.warn("avatar upload failed", err);
      // Keep the editor open so the user can retry without
      // re-running the pipeline.
    }
  };

  const buttonClass =
    variant === "tile"
      ? `flex h-7 w-7 items-center justify-center rounded-md border text-[12px] border-line text-ink-3 hover:border-ink hover:text-ink`
      : `inline-flex items-center gap-2 rounded-md border border-line-soft bg-paper-2 px-2.5 py-1 text-xs text-ink transition-colors hover:border-line`;

  return (
    <>
      <div className={variant === "tile" ? "" : "flex flex-col gap-1"}>
        <label
          htmlFor={id}
          className={`${buttonClass} ${disabled ? "cursor-wait" : "cursor-pointer"}`}
          title="Upload a photo (JPEG, PNG, or WebP)"
        >
          <input
            id={id}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onPick}
            disabled={disabled}
            className="hidden"
          />
          {label ?? (variant === "tile" ? "📷" : "Upload photo")}
        </label>
        {error && variant !== "tile" && (
          <p className="text-[11px] text-accent-rose">{error}</p>
        )}
      </div>
      {editorFile && (
        <AvatarEditor
          file={editorFile}
          onSave={handleSave}
          onCancel={() => setEditorFile(null)}
        />
      )}
    </>
  );
};
