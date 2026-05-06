import type { Config } from "tailwindcss";

// Tokens are ports of docs/design_handoff_howler/styles.css. Match
// to the hex digit — production fidelity vs. the design canvas is
// the spec for this phase. Add new accent shades only with a
// designer in the loop.

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: "#F5EFE3",
          2: "#EDE5D3",
          3: "#E4D9C0",
        },
        ink: {
          DEFAULT: "#2A2620",
          2: "#4B433A",
          3: "#6E6557",
          mute: "#97907F",
        },
        line: {
          DEFAULT: "#D6CAB0",
          soft: "#E2D7BE",
        },
        // Warm, low-chroma accents.
        accent: {
          amber: "#C77A2A",
          rose: "#B25A55",
          sage: "#6E8A5C",
          plum: "#8A5B7A",
          sky: "#6F8AA1",
        },
        // Urgency ring scale.
        urg: {
          0: "#B7A98A",
          1: "#C9A862",
          2: "#C77A2A",
          3: "#B25A55",
        },
      },
      fontFamily: {
        display: [
          "Fraunces",
          "Source Serif 4",
          "Georgia",
          "serif",
        ],
        serif: [
          "Source Serif 4",
          "Source Serif Pro",
          "Iowan Old Style",
          "Georgia",
          "serif",
        ],
        sans: [
          "Inter Tight",
          "-apple-system",
          "SF Pro Text",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SF Mono",
          "monospace",
        ],
      },
      borderRadius: {
        sm: "8px",
        DEFAULT: "14px",
        lg: "22px",
      },
      boxShadow: {
        sm: "0 1px 0 rgba(42,38,32,0.05), 0 2px 6px rgba(42,38,32,0.04)",
        md: "0 1px 0 rgba(42,38,32,0.06), 0 6px 20px rgba(42,38,32,0.08)",
        // Floating bottom-tab pill — designer-specified only.
        tabbar: "0 6px 24px rgba(42,38,32,0.18)",
      },
      letterSpacing: {
        caps: "0.12em",
      },
    },
  },
  plugins: [],
};

export default config;
