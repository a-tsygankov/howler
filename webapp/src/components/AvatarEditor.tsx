// Browser-side avatar editor. Opens after the user picks a file via
// AvatarUploadButton or HomeAvatarTile; runs the entire processing
// pipeline locally and only round-trips the FINAL bytes to the
// Worker. Strategy C per the avatar-editor design discussion (#45).
//
// Pipeline:
//   1. decode (createImageBitmap — native)
//   2. optional: remove background (@imgly/background-removal,
//      lazy-imported on first opt-in)
//   3. square-crop centre + resize 512×512 + encode WebP
//   4. preview as <img>
//   5. on Save: hand the Blob to the parent's onSave callback
//
// What the Worker sees: a 512×512 WebP, ~30-100 KB instead of the
// 2-5 MB phone-camera original. EXIF stripped as a side effect of
// the canvas re-encode.

import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet } from "./Sheet";
import {
  blobToAvatarFile,
  decodeImage,
  removeBackground,
  resizeAndEncode,
} from "../lib/imageProcessing";

export interface AvatarEditorProps {
  /** The file the user picked. Closed in onCancel / onSave. */
  file: File;
  /** Called with the final processed File ready for upload. */
  onSave: (processedFile: File) => Promise<void>;
  /** User backed out without saving. */
  onCancel: () => void;
}

export const AvatarEditor = ({ file, onSave, onCancel }: AvatarEditorProps) => {
  // Decoded once on mount; re-used across every re-process pass so
  // the same source bitmap doesn't get decoded twice when the user
  // toggles bg-removal off/on.
  const [original, setOriginal] = useState<ImageBitmap | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);

  // Cached bg-removal output. Computed once when the user first
  // toggles "Remove background"; subsequent toggles reuse the cache
  // (toggle off → re-process from `original`, toggle on → re-process
  // from `bgRemovedBitmap` without re-running the model).
  const [bgRemovedBitmap, setBgRemovedBitmap] = useState<ImageBitmap | null>(null);
  const [bgRemovedBlob, setBgRemovedBlob] = useState<Blob | null>(null);

  // User-facing toggles. `removeBg` triggers the @imgly model on
  // first true.
  const [removeBg, setRemoveBg] = useState(false);

  // Latest processed output — preview src + the Blob that gets
  // uploaded on Save. Both come from the same canvas pass.
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // UI state.
  const [busy, setBusy] = useState(false);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Stable Blob reference for the editor — used as the bg-removal
  // input source so the SDK's content-type sniffing has the original
  // mime intact (it's a File so it carries the type already).
  const sourceFile = useMemo(() => file, [file]);

  // Decode the source on mount. createImageBitmap supports JPEG /
  // PNG / WebP universally + HEIC on Safari ≥17; on browsers that
  // can't decode the format we surface a clear error.
  useEffect(() => {
    let cancelled = false;
    setDecodeError(null);
    (async () => {
      try {
        const bmp = await decodeImage(sourceFile);
        if (cancelled) {
          bmp.close();
          return;
        }
        setOriginal(bmp);
      } catch (err) {
        if (!cancelled) {
          setDecodeError(
            err instanceof Error ? err.message : "decode failed",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceFile]);

  // Free the GPU-backed ImageBitmaps when the editor closes — left
  // hanging they'd hold their texture memory until GC eventually
  // catches up. The bg-removed bitmap mirrors the same lifetime.
  useEffect(() => {
    return () => {
      original?.close();
      bgRemovedBitmap?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-process whenever the toggle state or source bitmap changes.
  // Cancel-token pattern — if the user toggles again mid-pass, the
  // stale pass discards its result instead of stomping the live
  // state.
  useEffect(() => {
    if (!original) return;
    let cancelled = false;
    (async () => {
      setError(null);
      setBusy(true);
      try {
        let workingBitmap: ImageBitmap = original;

        if (removeBg) {
          // Run (or reuse) the bg-removal model. The Blob is the
          // anchor — we only re-decode into a bitmap if we don't
          // already have one cached.
          let removedBlob = bgRemovedBlob;
          if (!removedBlob) {
            setStatusLabel("Removing background…");
            removedBlob = await removeBackground(sourceFile, (key, pct) => {
              if (cancelled) return;
              // @imgly emits keys like 'fetch:model', 'compute:onnx';
              // strip the prefix for a friendlier message and only
              // show progress when it actually advances (some keys
              // have no totals).
              const friendly = key.startsWith("fetch")
                ? "Loading model"
                : "Removing background";
              setStatusLabel(
                pct > 0 ? `${friendly} ${pct}%` : `${friendly}…`,
              );
            });
            if (cancelled) return;
            setBgRemovedBlob(removedBlob);
          }
          let removedBitmap = bgRemovedBitmap;
          if (!removedBitmap) {
            removedBitmap = await createImageBitmap(removedBlob);
            if (cancelled) {
              removedBitmap.close();
              return;
            }
            setBgRemovedBitmap(removedBitmap);
          }
          workingBitmap = removedBitmap;
        }

        setStatusLabel("Encoding…");
        const blob = await resizeAndEncode(workingBitmap);
        if (cancelled) return;
        setProcessedBlob(blob);
        // Replace the previous preview URL on each pass; revoke the
        // old one so the browser can free the underlying Blob.
        setPreviewUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
        setStatusLabel(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatusLabel(null);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original, removeBg]);

  // Revoke the live preview URL on unmount.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save guard — re-entrant Save clicks (during the upload round-
  // trip) must not double-submit. Guarded via `saving` flag.
  const savingRef = useRef(false);
  const handleSave = async () => {
    if (savingRef.current || !processedBlob) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await onSave(blobToAvatarFile(processedBlob));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Sheet open onClose={onCancel} ariaLabel="Avatar editor">
      <h2 className="font-display text-xl">Edit avatar</h2>

      {decodeError && (
        <p className="mt-3 text-sm text-accent-rose">
          Couldn't read this image: {decodeError}
        </p>
      )}

      {/* Preview surface. Square 192×192 box; the avatar always
          renders inside a circular CSS frame across the rest of the
          app, but the editor preview shows the full square so the
          user sees the actual upload bytes (centred crop included). */}
      <div className="mt-4 flex justify-center">
        <div className="relative h-48 w-48 overflow-hidden rounded-2xl bg-paper-3 ring-1 ring-line-soft">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Avatar preview"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-ink-3">
              {original ? "Processing…" : "Loading…"}
            </div>
          )}
          {busy && previewUrl && (
            <div className="absolute inset-0 flex items-center justify-center bg-paper/60 text-xs text-ink-2">
              {statusLabel ?? "Working…"}
            </div>
          )}
        </div>
      </div>

      {/* Toggles. Bg-removal is the only one in this PR; B&W +
          filters land in a follow-up. The ML model is lazy-loaded
          on first toggle-on, so disabling-and-leaving-disabled
          incurs zero bandwidth cost. */}
      <div className="mt-5 flex flex-col gap-2">
        <label
          className={`flex items-center justify-between rounded-md border border-line-soft bg-paper-2 px-3 py-2 text-sm ${
            saving ? "opacity-60" : "cursor-pointer hover:border-line"
          }`}
        >
          <div className="flex flex-col">
            <span className="text-ink">Remove background</span>
            <span className="cap mt-0.5">
              Auto-detects the subject. First use downloads ~24 MB.
            </span>
          </div>
          <input
            type="checkbox"
            checked={removeBg}
            disabled={saving || !original}
            onChange={(e) => setRemoveBg(e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-ink"
          />
        </label>
      </div>

      {error && (
        <p className="mt-3 text-sm text-accent-rose">{error}</p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md border border-line bg-paper-2 px-3 py-1.5 text-sm text-ink hover:border-ink disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!processedBlob || busy || saving}
          className="rounded-md bg-ink px-3 py-1.5 text-sm text-paper transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Sheet>
  );
};
