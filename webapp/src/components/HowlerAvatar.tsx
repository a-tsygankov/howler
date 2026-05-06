import { avatarUrl } from "../lib/api.ts";

// Round photo + colored urgency ring (Option B from plan §13).
// CVD redundancy per design handoff: each urgency level pairs the
// ring color with a glyph at 12 o'clock (1 dot / 2 dots / "!" / "‼")
// so red-green colorblind users still get the priority signal.
//
// Photo path: <img src={avatarUrl(avatarId)}> — falls back to an
// SVG with initials on a hash-determined accent color when no
// avatar is set.

export type Urgency = 0 | 1 | 2 | 3;

export interface HowlerAvatarProps {
  // Use `| undefined` explicitly so callers can pass through optional
  // chains (`task?.avatarId`) without coalescing — exactOptionalPropertyTypes
  // would otherwise reject the implicit undefined.
  avatarId?: string | null | undefined;
  initials?: string | undefined;
  seed?: string | undefined;
  urgency?: Urgency | undefined;
  size?: number | undefined;
  className?: string | undefined;
}

const RING_CLASS: Record<Urgency, string> = {
  0: "ring-urg-0",
  1: "ring-urg-1",
  2: "ring-urg-2",
  3: "ring-urg-3",
};

const GLYPH: Record<Urgency, string | null> = {
  0: null,
  1: "·",
  2: "!",
  3: "‼",
};

const BG_PALETTE = [
  "bg-accent-amber",
  "bg-accent-sage",
  "bg-accent-plum",
  "bg-accent-sky",
  "bg-accent-rose",
] as const;

const bgFromSeed = (seed: string): string => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % BG_PALETTE.length;
  return BG_PALETTE[idx]!;
};

const initialsFor = (s: string | undefined): string =>
  (s ?? "?").trim().slice(0, 2).toUpperCase();

export const HowlerAvatar = ({
  avatarId,
  initials,
  seed,
  urgency = 0,
  size = 38,
  className = "",
}: HowlerAvatarProps) => {
  const url = avatarUrl(avatarId);
  const ring = RING_CLASS[urgency];
  const glyph = GLYPH[urgency];

  const inner =
    url ? (
      <img
        src={url}
        alt=""
        className="h-full w-full rounded-full object-cover"
      />
    ) : (
      <div
        className={`grid h-full w-full place-items-center rounded-full ${bgFromSeed(seed ?? initials ?? "")} text-paper font-display`}
        style={{ fontSize: size * 0.42 }}
      >
        {initialsFor(initials ?? seed)}
      </div>
    );

  return (
    <div
      className={`relative inline-block rounded-full ring-2 ring-offset-2 ring-offset-paper ${ring} ${className}`}
      style={{ width: size, height: size }}
    >
      {inner}
      {glyph !== null && (
        <div
          aria-hidden
          className={`absolute -top-0.5 left-1/2 -translate-x-1/2 -translate-y-full rounded-full bg-paper px-1 font-mono text-[10px] leading-none ${urgency === 3 ? "text-urg-3" : urgency === 2 ? "text-urg-2" : "text-urg-1"}`}
          style={{ minWidth: 10, textAlign: "center" }}
        >
          {glyph}
        </div>
      )}
    </div>
  );
};
