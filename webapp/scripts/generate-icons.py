#!/usr/bin/env python3
"""Generate the PWA icon set + favicon.ico from a single 512×512 RGBA
source. Run from repo root:

    python webapp/scripts/generate-icons.py

Outputs land under webapp/public/icons/ (created if absent) and the
favicon.ico goes to webapp/public/favicon.ico (root, where browsers
look first when no <link rel="icon"> matches).

Why a script + not a build step: the source image is committed to
source control alongside its derivatives so the production deploy
pipeline doesn't need PIL. Re-run only when the source changes.
"""

from pathlib import Path
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
# Source artwork lives under docs/assets so it stays committed but
# doesn't ship in webapp/dist alongside the derivatives. Re-run this
# script whenever the artwork changes.
SRC = REPO / "docs" / "assets" / "howler-icon-source.png"
OUT_ROOT = REPO / "webapp" / "public"
OUT_ICONS = OUT_ROOT / "icons"


# (filename, size, output dir, treat-as-maskable)
#
# Maskable variants get a transparent safe-zone padding around the
# subject (Android adaptive icons crop ~10 % off each side). The
# regular variants render the artwork edge-to-edge.
TARGETS = [
    # Browser favicons
    ("favicon-16.png",      16,   OUT_ICONS, False),
    ("favicon-32.png",      32,   OUT_ICONS, False),
    ("favicon-48.png",      48,   OUT_ICONS, False),
    # Apple touch icon (iOS Add-to-Home-Screen)
    ("apple-touch-icon.png", 180, OUT_ICONS, False),
    # Android / PWA standard sizes
    ("icon-192.png",        192,  OUT_ICONS, False),
    ("icon-512.png",        512,  OUT_ICONS, False),
    # Maskable for Android adaptive icons. Padded by ~12 % so the
    # OS-applied circle / squircle / squircle mask doesn't clip the
    # subject. https://w3c.github.io/manifest/#icon-masks
    ("icon-512-maskable.png", 512, OUT_ICONS, True),
    ("icon-192-maskable.png", 192, OUT_ICONS, True),
]


def render(size: int, src: Image.Image, *, maskable: bool) -> Image.Image:
    """Resize `src` to `size`×`size`. For maskable variants, scale the
    artwork into the inner ~76 % safe-zone with a transparent margin
    so adaptive-icon masks don't clip the design."""
    if maskable:
        inner = int(round(size * 0.76))
        scaled = src.resize((inner, inner), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        offset = (size - inner) // 2
        canvas.paste(scaled, (offset, offset), scaled)
        return canvas
    return src.resize((size, size), Image.Resampling.LANCZOS)


def write_favicon_ico(src: Image.Image) -> None:
    """Multi-resolution .ico carrying 16, 32, 48 px variants. Browsers
    pick the closest match for the device pixel density. The
    `sizes=` flag triggers PIL's multi-image ICO writer."""
    target = OUT_ROOT / "favicon.ico"
    sizes = [(16, 16), (32, 32), (48, 48)]
    src.save(target, format="ICO", sizes=sizes)
    print(f"  -> {target.relative_to(REPO)} ({', '.join(f'{w}x{h}' for w,h in sizes)})")


def main() -> int:
    if not SRC.exists():
        print(f"source not found: {SRC}")
        return 1
    OUT_ICONS.mkdir(parents=True, exist_ok=True)

    src = Image.open(SRC).convert("RGBA")
    if src.size != (512, 512):
        print(f"warning: source is {src.size}, expected 512x512 — proceeding")

    for name, size, out_dir, maskable in TARGETS:
        img = render(size, src, maskable=maskable)
        target = out_dir / name
        img.save(target, format="PNG", optimize=True)
        rel = target.relative_to(REPO)
        tag = " (maskable)" if maskable else ""
        print(f"  -> {rel} ({size}x{size}{tag})")

    write_favicon_ico(src)
    print("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
