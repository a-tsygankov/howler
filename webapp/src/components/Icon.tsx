// Icon barrel — Set A (hand-drawn organic line) from
// docs/design_handoff_howler/icons.jsx. Set B/C are reference-only
// in the design canvas; we ship Set A across the app.
//
// To swap to a different set later: change the `paths` object body
// (and the stroke vs fill defaults) in this file. All call sites use
// `<Icon name="…" />` so the swap is one place.

const STROKE_W = 1.7;

export type IconName =
  | "paw"
  | "broom"
  | "heart"
  | "briefcase"
  | "pill"
  | "plant"
  | "bowl"
  | "bell"
  | "check"
  | "clock"
  | "calendar"
  | "flame"
  | "star"
  | "dog"
  | "cat"
  | "home"
  | "tooth"
  | "run"
  | "book"
  | "sparkle"
  | "more"
  | "plus"
  | "filter"
  | "trash"
  | "edit"
  | "chevron-left"
  | "chevron-right";

const path = (name: IconName, stroke: string): React.ReactNode => {
  switch (name) {
    case "paw":
      return (
        <g>
          <circle cx="7.5" cy="9" r="1.6" />
          <circle cx="11" cy="6.5" r="1.6" />
          <circle cx="14.5" cy="6.5" r="1.6" />
          <circle cx="18" cy="9" r="1.6" />
          <path d="M8 16.5c0-3 1.8-4.5 4.2-4.5s4 1.5 4 4.5c0 2-1.7 2.6-3 2-.7-.3-1.5-.3-2.2 0-1.4.6-3-.1-3-2z" />
        </g>
      );
    case "broom":
      return (
        <g>
          <path d="M14 4l-7 7" />
          <path d="M16 6l4 4" />
          <path d="M11 9l-5 8 8-5" />
          <path d="M6 17l-2 3" />
        </g>
      );
    case "heart":
      return <path d="M12 19s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 9c0 5.6-7 10-7 10z" />;
    case "briefcase":
      return (
        <g>
          <rect x="3.5" y="7" width="17" height="12" rx="1.5" />
          <path d="M9 7V5.5a1 1 0 011-1h4a1 1 0 011 1V7" />
          <path d="M3.5 12h17" />
        </g>
      );
    case "pill":
      return (
        <g>
          <rect x="3.2" y="9" width="17.6" height="6" rx="3" transform="rotate(-30 12 12)" />
          <path d="M8 16l8-8" />
        </g>
      );
    case "plant":
      return (
        <g>
          <path d="M12 20v-7" />
          <path d="M12 13c-3 0-5-2-5-5 3 0 5 2 5 5z" />
          <path d="M12 13c3 0 5-2 5-5-3 0-5 2-5 5z" />
          <path d="M7.5 20h9" />
        </g>
      );
    case "bowl":
      return (
        <g>
          <path d="M4 12h16l-2 6a2 2 0 01-2 2H8a2 2 0 01-2-2z" />
          <path d="M9 9c0-1.5 1.5-2 3-2s3 .5 3 2" />
        </g>
      );
    case "bell":
      return (
        <g>
          <path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15z" />
          <path d="M10 20a2 2 0 004 0" />
        </g>
      );
    case "check":
      return <path d="M5 12.5l4.5 4.5L19 7.5" />;
    case "clock":
      return (
        <g>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7.5V12l3 2" />
        </g>
      );
    case "calendar":
      return (
        <g>
          <rect x="4" y="5.5" width="16" height="14" rx="1.5" />
          <path d="M4 10h16M9 4v3M15 4v3" />
        </g>
      );
    case "flame":
      return <path d="M12 21c-3.5 0-6-2.4-6-5.5 0-2.5 1.8-3.6 2.7-5.5.6-1.4.3-3 .3-3 2 .8 3 2.5 3 4 1.5-.7 2-2.5 2-4 2.5 2 4 4.5 4 8 0 3.6-2.5 6-6 6z" />;
    case "star":
      return <path d="M12 4l2.5 5 5.5.8-4 4 1 5.6L12 17l-5 2.4 1-5.6-4-4 5.5-.8z" />;
    case "dog":
      return (
        <g>
          <path d="M5 9l-1-3 4 1 1 2" />
          <path d="M19 9l1-3-4 1-1 2" />
          <path d="M7 11c0-3 2-5 5-5s5 2 5 5v6a2 2 0 01-2 2h-6a2 2 0 01-2-2z" />
          <circle cx="10" cy="13" r=".7" fill={stroke} />
          <circle cx="14" cy="13" r=".7" fill={stroke} />
        </g>
      );
    case "cat":
      return (
        <g>
          <path d="M5 8l1 4" />
          <path d="M19 8l-1 4" />
          <path d="M5 8c2-2 4-3 7-3s5 1 7 3v9a2 2 0 01-2 2H7a2 2 0 01-2-2z" />
          <circle cx="10" cy="13" r=".7" fill={stroke} />
          <circle cx="14" cy="13" r=".7" fill={stroke} />
        </g>
      );
    case "home":
      return (
        <g>
          <path d="M4 11l8-7 8 7" />
          <path d="M6 10v9h12v-9" />
        </g>
      );
    case "tooth":
      return <path d="M8 4c2 0 2 1.5 4 1.5S14 4 16 4c2.5 0 4 2 4 4 0 4-2 5-3 9-.4 1.5-1.6 2-2.5.5l-1.5-3a1 1 0 00-2 0l-1.5 3c-.9 1.5-2 1-2.5-.5-1-4-3-5-3-9 0-2 1.5-4 4-4z" />;
    case "run":
      return (
        <g>
          <circle cx="15" cy="5" r="1.6" />
          <path d="M9 21l3-6 3 2 2 4" />
          <path d="M5 13l3-2 4 2 2-4" />
        </g>
      );
    case "book":
      return (
        <g>
          <path d="M5 5h6c1 0 2 1 2 2v13c0-1-1-2-2-2H5z" />
          <path d="M19 5h-6c-1 0-2 1-2 2v13c0-1 1-2 2-2h6z" />
        </g>
      );
    case "sparkle":
      return <path d="M12 4v6M12 14v6M4 12h6M14 12h6" />;
    case "more":
      return (
        <g>
          <circle cx="6" cy="12" r="1.3" fill={stroke} />
          <circle cx="12" cy="12" r="1.3" fill={stroke} />
          <circle cx="18" cy="12" r="1.3" fill={stroke} />
        </g>
      );
    case "plus":
      return <path d="M12 5v14M5 12h14" />;
    case "filter":
      return (
        <g>
          <path d="M4 6h16M7 12h10M10 18h4" />
        </g>
      );
    case "trash":
      return (
        <g>
          <path d="M5 7h14M9 7V5.5a1 1 0 011-1h4a1 1 0 011 1V7" />
          <path d="M7 7l1 12a2 2 0 002 2h4a2 2 0 002-2l1-12" />
        </g>
      );
    case "edit":
      return (
        <g>
          <path d="M5 19h4l10-10-4-4L5 15z" />
          <path d="M14 5l4 4" />
        </g>
      );
    case "chevron-left":
      return <path d="M14 6l-6 6 6 6" />;
    case "chevron-right":
      return <path d="M10 6l6 6-6 6" />;
  }
};

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  color?: string;
}

export const Icon = ({
  name,
  size = 20,
  className = "",
  color = "currentColor",
}: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={STROKE_W}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
  >
    {path(name, color)}
  </svg>
);
