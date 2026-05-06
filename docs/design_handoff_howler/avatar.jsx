/* global React */
// Avatar — round photo placeholder OR initials, with urgency ring.
// Photos use deterministic gradient by seed. The point is to evoke
// the spec's "Option B" round + colored urgency ring treatment.

const URG_TONES = ["#B7A98A", "#C9A862", "#C77A2A", "#B25A55"];
// Stripe seeds for photo placeholders — different per seed
const PHOTO_PALETTES = {
  mochi: ["#E8C9A6", "#C99A6E", "#7A5740"],
  fern:  ["#B7C9A6", "#7E9F6A", "#3F5A36"],
  dog:   ["#D9C8AE", "#A48A6B", "#5A4A36"],
  default: ["#D8C9AE", "#9F8A6E", "#5A4A36"],
};

function HowlerAvatar({ photo, initials, urgency = 0, size = 44, ringWidth = 3, label }) {
  const ring = URG_TONES[Math.max(0, Math.min(3, urgency))];
  const inner = size - ringWidth * 2;
  const palette = PHOTO_PALETTES[photo] || PHOTO_PALETTES.default;
  const seed = (photo || initials || "?")[0]?.toUpperCase() || "?";
  return (
    <div
      style={{
        width: size, height: size, borderRadius: "50%",
        padding: ringWidth,
        background: ring,
        boxShadow: urgency >= 2 ? `0 0 0 1.5px ${ring}33, 0 1px 3px rgba(42,38,32,0.18)` : "0 1px 2px rgba(42,38,32,0.14)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        flex: "none",
      }}
      aria-label={label || "avatar"}
    >
      <div style={{
        width: inner, height: inner, borderRadius: "50%",
        background: photo
          ? `linear-gradient(135deg, ${palette[0]} 0%, ${palette[1]} 55%, ${palette[2]} 100%)`
          : `radial-gradient(circle at 30% 25%, #F5EFE3 0%, #E4D9C0 100%)`,
        color: "#2A2620",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "Fraunces, Georgia, serif",
        fontWeight: 500,
        fontSize: Math.round(inner * 0.42),
        letterSpacing: "-0.02em",
        position: "relative", overflow: "hidden",
      }}>
        {photo ? (
          // Placeholder photo: layered subtle shapes evoking the subject
          <PhotoSilhouette kind={photo} size={inner} palette={palette}/>
        ) : (
          <span style={{transform:"translateY(-1px)"}}>{initials || seed}</span>
        )}
      </div>
    </div>
  );
}

function PhotoSilhouette({ kind, size, palette }) {
  // Very minimal subject hint (NOT a real illustration — placeholder)
  const s = size;
  const dark = palette[2];
  const mid = palette[1];
  const light = palette[0];
  if (kind === "mochi" || kind === "cat") {
    return (
      <svg width={s} height={s} viewBox="0 0 40 40">
        <rect width="40" height="40" fill={`url(#g${kind})`}/>
        <defs><linearGradient id={`g${kind}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={light}/><stop offset="1" stopColor={dark}/>
        </linearGradient></defs>
        <path d="M10 28c0-7 4-12 10-12s10 5 10 12" fill={dark} opacity="0.55"/>
        <path d="M12 16l3-4 3 4M22 16l3-4 3 4" stroke={dark} strokeWidth="1.5" fill="none" opacity="0.7"/>
        <circle cx="17" cy="22" r="1" fill={dark}/>
        <circle cx="23" cy="22" r="1" fill={dark}/>
      </svg>
    );
  }
  if (kind === "dog") {
    return (
      <svg width={s} height={s} viewBox="0 0 40 40">
        <rect width="40" height="40" fill={mid}/>
        <ellipse cx="20" cy="32" rx="16" ry="10" fill={dark} opacity="0.5"/>
        <ellipse cx="20" cy="22" rx="9" ry="8" fill={dark} opacity="0.7"/>
        <ellipse cx="13" cy="14" rx="3" ry="5" fill={dark}/>
        <ellipse cx="27" cy="14" rx="3" ry="5" fill={dark}/>
      </svg>
    );
  }
  if (kind === "fern") {
    return (
      <svg width={s} height={s} viewBox="0 0 40 40">
        <rect width="40" height="40" fill={light}/>
        <path d="M20 36V14" stroke={dark} strokeWidth="1.4"/>
        <path d="M20 30c-4-1-7-4-7-9 4 0 7 3 7 9zM20 30c4-1 7-4 7-9-4 0-7 3-7 9z" fill={mid}/>
        <path d="M20 22c-3-1-5-3-5-7 3 0 5 2 5 7zM20 22c3-1 5-3 5-7-3 0-5 2-5 7z" fill={dark} opacity="0.7"/>
      </svg>
    );
  }
  return (
    <svg width={s} height={s} viewBox="0 0 40 40">
      <rect width="40" height="40" fill={`url(#g-default)`}/>
      <defs><linearGradient id="g-default" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={light}/><stop offset="1" stopColor={dark}/>
      </linearGradient></defs>
    </svg>
  );
}

window.HowlerAvatar = HowlerAvatar;
window.URG_TONES = URG_TONES;
