// Browser-side avatar processing pipeline. Strategy C per the
// design discussion (PR #45):
//
//   File / Blob
//      ↓ createImageBitmap()                     (native, free)
//      ↓ optional: removeBackground() via @imgly  (lazy import)
//      ↓ resize on OffscreenCanvas                (native, free)
//      ↓ canvas.convertToBlob('image/webp')       (native, free)
//   Blob ready for upload
//
// Everything is pure helpers — the React state machine lives in
// AvatarEditor. Lazy import of @imgly/background-removal keeps the
// 3 MB WASM + 24 MB ONNX model out of the main bundle until the
// user actually toggles "Remove background" (model files cached in
// the browser HTTP cache after first run, so subsequent uses are
// instant).

const TARGET_SIZE = 512;
const TARGET_QUALITY = 0.85;

/// Decode a File/Blob into an ImageBitmap. Throws on unsupported
/// format (e.g. HEIC on browsers that don't natively decode it).
export const decodeImage = async (input: Blob): Promise<ImageBitmap> => {
  return await createImageBitmap(input);
};

/// Square-crop the source bitmap (centred), then resize to
/// `targetSize × targetSize` and encode as WebP. Returns a Blob
/// ready for the existing `uploadAvatar` flow.
///
/// Square crop is implicit on the result side — every avatar surface
/// renders inside `border-radius: 50%`, so a square upload is the
/// least-surprising default. Future revisions can add manual crop
/// controls; the editor today just centres the smaller dimension.
export const resizeAndEncode = async (
  source: ImageBitmap,
  options: {
    grayscale?: boolean;
    targetSize?: number;
    quality?: number;
  } = {},
): Promise<Blob> => {
  const size = options.targetSize ?? TARGET_SIZE;
  const quality = options.quality ?? TARGET_QUALITY;

  // Canvas-side square crop: pick the smaller of (width, height) as
  // the source side; centre it in the source. This is the
  // "object-fit: cover" pattern, applied in-canvas so the encoded
  // bytes match what the user sees in the preview.
  const srcSide = Math.min(source.width, source.height);
  const srcX = Math.round((source.width - srcSide) / 2);
  const srcY = Math.round((source.height - srcSide) / 2);

  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas 2D context not available");

  // Higher-quality scaling — the default is browser-implementation-
  // defined (usually bilinear). 'high' picks Lanczos / bicubic on
  // most engines; matters most when downscaling 4 MP phone shots.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  if (options.grayscale) {
    // Native CSS-style filter; faster than walking the pixel buffer
    // and produces identical output to a luminance manual pass.
    ctx.filter = "grayscale(1)";
  }

  ctx.drawImage(source, srcX, srcY, srcSide, srcSide, 0, 0, size, size);

  // WebP at q=0.85 is the sweet spot for avatars: visually identical
  // to the original at small render sizes, ~5-10× smaller than JPEG
  // at the same perceptual quality. Browsers ≥2020 all support it.
  return canvas.convertToBlob({ type: "image/webp", quality });
};

/// Run @imgly/background-removal on the bitmap and return a new
/// ImageBitmap with the background pixels alpha=0. Lazy-imports the
/// SDK so the WASM + model fetch only happens on first opt-in.
///
/// The 'isnet_quint8' model variant is ~24 MB (vs the default
/// 'isnet_fp16' at ~96 MB). Plenty of accuracy for avatar headshots
/// + pet portraits; not ideal for fine-edged subjects (hair on a
/// busy background). Subsequent uses hit the HTTP cache and run in
/// ~500 ms; first run is download + warmup, ~5-15 s on broadband.
export const removeBackground = async (
  source: Blob,
  onProgress?: (label: string, percent: number) => void,
): Promise<Blob> => {
  // Dynamic import → Vite code-splits the @imgly chunk into a
  // separate bundle that's only fetched when this code path runs.
  const { removeBackground: imglyRemove } = await import(
    "@imgly/background-removal"
  );
  // exactOptionalPropertyTypes treats `undefined` as a distinct
  // assignment vs. "absent property", and @imgly types `progress`
  // as required-when-present. Spread the optional field only when
  // we actually have a callback; flat object otherwise.
  const config: Parameters<typeof imglyRemove>[1] = {
    model: "isnet_quint8",
    output: { format: "image/png", quality: 1 },
    ...(onProgress && {
      progress: (key: string, current: number, total: number) => {
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;
        onProgress(key, pct);
      },
    }),
  };
  return imglyRemove(source, config);
};

/// Wrap a processed Blob into a `File` with a stable name + mime.
/// `uploadAvatar()` in lib/api.ts takes a File so we can attach it
/// to FormData with the right field type; this helper keeps the
/// editor's caller from dealing with that detail.
export const blobToAvatarFile = (
  blob: Blob,
  name = "avatar.webp",
): File => new File([blob], name, { type: blob.type || "image/webp" });
