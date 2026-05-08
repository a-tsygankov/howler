// Rasterize the webapp's Icon Set A barrel into 24×24 1-bit bitmaps
// and emit a SQL seed file that bulk-inserts them into the `icons`
// D1 table. The output ships as the next migration so a fresh
// migrate run primes the table; reruns are idempotent because every
// INSERT uses ON CONFLICT(name) DO UPDATE SET ... = excluded.
//
// We extract SVG paths directly from webapp/src/components/Icon.tsx
// (the single source of truth for icon shapes) so the device, the
// webapp, and the seed all stay in lockstep — there's no third copy
// of the icon geometry to drift.
//
// Usage:
//   node backend/scripts/seed-icons.mjs > backend/migrations/0011_seed_icons.sql
//
// The script is intentionally lightweight (no Babel / no AST parser)
// — it scans Icon.tsx for `case "<name>":` blocks and the SVG return
// JSX inside them, peeling out path/circle/rect/g children, then
// hands the synthesised SVG to sharp for rasterization.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, "..", "..");
const iconTsx   = path.join(repoRoot, "webapp", "src", "components", "Icon.tsx");

const STROKE_W = 1.7;
const SIZE     = 24;
const BYTES_PER_ROW = Math.ceil(SIZE / 8);  // 3 bytes for 24 px wide

// Names we ship to the device. Keeping this list in sync with
// webapp's LABEL_ICON_CHOICES + a couple of UI primitives the device
// might also need (check, plus, calendar, clock, bell, home).
const ICON_NAMES = [
  "paw", "dog", "cat", "broom", "home", "bowl",
  "heart", "sparkle", "star", "plant", "flame", "bell",
  "briefcase", "book", "run", "pill", "tooth", "clock",
  "calendar", "check",
];

// ── Step 1: harvest each icon's JSX body from Icon.tsx ───────────
//
// Icon.tsx has a `path = (name, stroke) => switch(name) { case "x":
// return <jsx />; }` shape. We do a quick textual extraction: find
// the case "<name>": line, capture everything up to the next case /
// default / closing } at the same indent. Non-rigorous but works
// because the file's own formatting is consistent.

function extractCaseBody(src, name) {
  const startToken = `case "${name}":`;
  const startIdx = src.indexOf(startToken);
  if (startIdx < 0) throw new Error(`icon "${name}" not found in Icon.tsx`);
  const returnIdx = src.indexOf("return", startIdx);
  if (returnIdx < 0) throw new Error(`no return for "${name}"`);
  let i = returnIdx + "return".length;
  while (i < src.length && /\s/.test(src[i])) i++;
  const bodyStart = i;
  // JSX-aware walk: track nesting depth, treating self-closing tags
  // (`<x ... />`) as balanced. Stop at the first `;` we see at depth 0.
  let depth = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "<") {
      const next = src[i + 1];
      if (next === "/") {
        depth--;
        while (i < src.length && src[i] !== ">") i++;
      } else if (next === "!") {
        // Comment / DOCTYPE — skip to '>'.
        while (i < src.length && src[i] !== ">") i++;
      } else {
        // Opening tag — find matching '>' and check whether it
        // self-closes (character before '>' is '/').
        let j = i + 1;
        while (j < src.length && src[j] !== ">") j++;
        const selfClosing = j > 0 && src[j - 1] === "/";
        if (!selfClosing) depth++;
        i = j;
      }
    } else if (ch === ";" && depth === 0) {
      return src.slice(bodyStart, i).trim();
    }
    i++;
  }
  throw new Error(`could not find end of return for "${name}"`);
}

// ── Step 2: convert the JSX body into a real SVG document ────────
//
// JSX tags map 1:1 to SVG tags (the webapp uses literal SVG element
// names). We just replace the React-isms (className, etc — none
// today) and wrap in a <svg viewBox> with the same stroke style as
// the live component.

function jsxToSvg(jsxBody) {
  // The body might be a bare element (<path d="..." />) or a
  // fragment-shaped <g>...</g>. Either way it's already valid SVG
  // XML once we treat `{` curly-brace expressions as nothing — the
  // only one in Icon.tsx is `fill={stroke}` for filled circles
  // inside dog/cat/more icons. Replace that with `fill="black"`
  // because the rasterizer paints fg pixels regardless of color.
  const noBraces = jsxBody.replace(/\{stroke\}/g, '"black"');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" `,
    `width="${SIZE}" height="${SIZE}" `,
    `fill="none" stroke="black" `,
    `stroke-width="${STROKE_W}" `,
    `stroke-linecap="round" stroke-linejoin="round">`,
    noBraces,
    `</svg>`,
  ].join("");
}

// ── Step 3: rasterize SVG → 24×24 grayscale → 1-bit bitmap ───────
//
// sharp gives us a raw grayscale buffer; we threshold at 128 and
// pack 8 pixels per byte, MSB = leftmost. Result is exactly 72 bytes
// for a 24×24 icon.

async function rasterize(svgString) {
  // Flatten onto a white background BEFORE grayscale — without it
  // the SVG renders onto a transparent canvas and sharp's grayscale
  // collapses the whole image to zero (premultiplied alpha eats the
  // stroke). Resize is implicit in the SVG's width/height attrs.
  const png = await sharp(Buffer.from(svgString))
    .flatten({ background: "#ffffff" })
    .grayscale()
    .raw()
    .toBuffer();
  // png is a SIZE*SIZE byte buffer (one byte / pixel after grayscale).
  // sharp returns 0 = black (the painted strokes), 255 = white (bg).
  // Our format wants 1 = fg pixel, 0 = transparent — invert.
  const out = Buffer.alloc(SIZE * BYTES_PER_ROW);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = png[y * SIZE + x];
      if (v < 128) {
        const byteIdx = y * BYTES_PER_ROW + (x >> 3);
        const bitIdx  = 7 - (x & 7);
        out[byteIdx] |= 1 << bitIdx;
      }
    }
  }
  return out;
}

// ── Step 4: emit a SQL UPSERT per icon ───────────────────────────

function bytesToHexLiteral(buf) {
  // SQLite blob literal: X'…'.
  return `X'${buf.toString("hex").toUpperCase()}'`;
}

async function main() {
  const src = fs.readFileSync(iconTsx, "utf8");
  const nowSec = Math.floor(Date.now() / 1000);

  console.log(`-- Auto-generated by backend/scripts/seed-icons.mjs.`);
  console.log(`-- Source: webapp/src/components/Icon.tsx`);
  console.log(`-- Format: 24x24 1-bit packed bitmap (72 bytes / icon)`);
  console.log(`--   row-major, MSB = leftmost pixel, 1 = ink, 0 = bg`);
  console.log(``);
  console.log(`-- Insert / refresh seeded icons. Re-running this`);
  console.log(`-- migration after the script regenerates is safe — the`);
  console.log(`-- ON CONFLICT clause replaces the bitmap + hash + timestamp.`);

  for (const name of ICON_NAMES) {
    const jsxBody  = extractCaseBody(src, name);
    const svg      = jsxToSvg(jsxBody);
    const bitmap   = await rasterize(svg);
    const hash     = crypto.createHash("sha1").update(bitmap).digest("hex");
    const blobLit  = bytesToHexLiteral(bitmap);
    console.log(``);
    console.log(`INSERT INTO icons (name, format_version, width, height, bitmap, content_hash, updated_at)`);
    console.log(`VALUES ('${name}', 1, ${SIZE}, ${SIZE}, ${blobLit}, '${hash}', ${nowSec})`);
    console.log(`ON CONFLICT(name) DO UPDATE SET`);
    console.log(`  format_version = excluded.format_version,`);
    console.log(`  width          = excluded.width,`);
    console.log(`  height         = excluded.height,`);
    console.log(`  bitmap         = excluded.bitmap,`);
    console.log(`  content_hash   = excluded.content_hash,`);
    console.log(`  updated_at     = excluded.updated_at;`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
