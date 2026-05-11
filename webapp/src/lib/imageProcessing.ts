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

/// Phase 7: produce a 24×24 1-bit dithered bitmap for the device.
/// Returns a Uint8Array of exactly 72 bytes (24×24 / 8) in the
/// same layout as the `icons` table (see backend migration 0010):
///
///   - 24 rows of 3 bytes each
///   - MSB-first per byte
///   - 1 = foreground (painted in the device's ink colour)
///   - 0 = transparent (disc background shines through)
///
/// Pipeline:
///   1. Resize source to 24×24 on a canvas with high-quality scaling
///   2. Convert RGBA → grayscale luminance (rec. 601 weights)
///   3. Floyd-Steinberg error diffusion to a 1-bit threshold
///   4. Pack 576 bits → 72 bytes
///
/// The dither runs purely in-process (no WASM, no model). ~5 ms
/// even on slow phones — runs alongside the WebP encode without
/// noticeable pipeline overhead.
export const generate1bitBitmap = (source: ImageBitmap): Uint8Array => {
  const W = 24;
  const H = 24;

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas 2D context not available");

  // Square-crop centre + downscale to 24×24. Same crop strategy as
  // resizeAndEncode so the WebP avatar and the 1-bit bitmap show
  // the same framing.
  const srcSide = Math.min(source.width, source.height);
  const srcX = Math.round((source.width - srcSide) / 2);
  const srcY = Math.round((source.height - srcSide) / 2);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, srcX, srcY, srcSide, srcSide, 0, 0, W, H);

  const { data: rgba } = ctx.getImageData(0, 0, W, H);

  // Grayscale luminance buffer (one float per pixel) so we can
  // diffuse the quantisation error to neighbours without thrashing
  // the RGBA buffer's typed integer math.
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = rgba[i * 4 + 0]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    const a = rgba[i * 4 + 3]!;
    // Premultiply by alpha so transparent regions in the source
    // (e.g. post-bg-removal) collapse to "background" (0) rather
    // than carrying their RGB through. Rec.601 luminance weights.
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) * (a / 255);
    gray[i] = lum;
  }

  // Floyd-Steinberg error diffusion. Walk left-to-right, top-to-
  // bottom; for each pixel, threshold at 128, push the quantisation
  // error to the four canonical neighbours with weights 7/16, 3/16,
  // 5/16, 1/16. Edges clamp the diffusion (no wrap-around).
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const old = gray[idx]!;
      const newVal = old < 128 ? 0 : 255;
      out[idx] = newVal === 255 ? 1 : 0;
      const err = old - newVal;
      if (x + 1 < W) gray[idx + 1] = (gray[idx + 1] ?? 0) + (err * 7) / 16;
      if (y + 1 < H) {
        if (x > 0) gray[idx + W - 1] = (gray[idx + W - 1] ?? 0) + (err * 3) / 16;
        gray[idx + W] = (gray[idx + W] ?? 0) + (err * 5) / 16;
        if (x + 1 < W) gray[idx + W + 1] = (gray[idx + W + 1] ?? 0) + (err * 1) / 16;
      }
    }
  }

  // Pack the 576 1-bit pixels into 72 bytes, MSB-first per byte.
  // (See preview1bitBitmap below for the inverse — it unpacks the
  // same 72 bytes for rendering inside the editor.)
  // Same layout the icons table uses; the device unpacks 1bpp → A8
  // exactly the same way regardless of source. The `??= 0` guard
  // makes TS's noUncheckedIndexedAccess happy without a runtime
  // check — `packed` was just `new Uint8Array(72)`'d, so every
  // index ≤71 is definitely a number, but the compiler can't prove
  // that statically.
  const packed = new Uint8Array(72);
  for (let i = 0; i < W * H; i++) {
    if (out[i]) {
      const byteIdx = i >> 3;
      const bitIdx = 7 - (i & 7);
      packed[byteIdx] = (packed[byteIdx] ?? 0) | (1 << bitIdx);
    }
  }
  return packed;
};

/// Turn the 72-byte 1-bit packed bitmap (output of
/// `generate1bitBitmap`) back into a Blob suitable for an `<img>`
/// preview inside the editor. Renders set bits as ink (#2A2620 —
/// matches the device's `Palette::ink()`) on a paper-toned
/// background so the user sees the avatar approximately as the
/// dial will paint it.
///
/// The output is a 24×24 PNG; the editor scales it up via CSS
/// (`image-rendering: pixelated`) so the dither pattern reads
/// crisply at preview size instead of bilinear-blurring.
export const preview1bitBitmap = async (
  packed: Uint8Array,
): Promise<Blob> => {
  if (packed.byteLength !== 72) {
    throw new Error(`expected 72 bytes, got ${packed.byteLength}`);
  }
  const W = 24;
  const H = 24;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas 2D context not available");

  // Mirror the device's palette: #F5EFE3 paper background, #2A2620
  // ink for set pixels. The on-device avatar disc is paper3
  // (#E4D9C0) under the ring, but for a flat preview the brighter
  // paper reads better at small render sizes.
  const img = ctx.createImageData(W, H);
  const data = img.data;
  for (let i = 0; i < W * H; i++) {
    const byteIdx = i >> 3;
    const bitIdx = 7 - (i & 7);
    const set = ((packed[byteIdx] ?? 0) >> bitIdx) & 1;
    const off = i * 4;
    if (set) {
      data[off + 0] = 0x2a;
      data[off + 1] = 0x26;
      data[off + 2] = 0x20;
      data[off + 3] = 0xff;
    } else {
      data[off + 0] = 0xf5;
      data[off + 1] = 0xef;
      data[off + 2] = 0xe3;
      data[off + 3] = 0xff;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
};
