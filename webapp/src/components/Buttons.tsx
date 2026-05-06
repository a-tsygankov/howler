import type { ButtonHTMLAttributes, ReactNode } from "react";

const base =
  "inline-flex items-center justify-center font-medium transition-colors disabled:opacity-50 disabled:cursor-default";

const variants = {
  primary:
    "bg-ink text-paper hover:bg-ink-2 active:bg-ink-2/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40",
  outline:
    "bg-transparent text-ink border border-line hover:bg-paper-2 active:bg-paper-3",
  sage:
    "bg-accent-sage text-paper hover:opacity-90",
  ghost:
    "bg-transparent text-ink-2 hover:text-ink hover:bg-paper-2",
  danger:
    "bg-transparent text-accent-rose border border-line hover:bg-paper-2",
};

const sizes = {
  pill: "rounded-full px-4 py-2 text-sm",
  pillSm: "rounded-full px-3 py-1 text-xs",
  block: "rounded-lg px-4 py-3 text-base w-full",
};

export interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  children: ReactNode;
}

export const Btn = ({
  variant = "primary",
  size = "pill",
  className = "",
  children,
  type = "button",
  ...rest
}: BtnProps) => (
  <button
    type={type}
    className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
    {...rest}
  >
    {children}
  </button>
);
