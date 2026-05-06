// Two-pill segmented toggle from the design canvas. Active = ink
// background, paper text. 12px Inter Tight 500.

export interface SegBtnProps<T extends string> {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export const SegBtn = <T extends string>({
  options,
  value,
  onChange,
  className = "",
}: SegBtnProps<T>) => (
  <div
    className={`inline-flex rounded-full border border-line bg-paper-2 p-0.5 ${className}`}
    role="tablist"
  >
    {options.map((o) => {
      const active = o.value === value;
      return (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={active}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            active
              ? "bg-ink text-paper"
              : "text-ink-2 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      );
    })}
  </div>
);
