// Day-progress bar from the design canvas — 6px-tall track in
// paper-3, fill in ink, mono "done/total" caption.

export interface ProgressBarProps {
  done: number;
  total: number;
  className?: string;
}

export const ProgressBar = ({
  done,
  total,
  className = "",
}: ProgressBarProps) => {
  const safeTotal = Math.max(total, 0);
  const safeDone = Math.min(Math.max(done, 0), safeTotal);
  const pct = safeTotal === 0 ? 0 : (safeDone / safeTotal) * 100;
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="h-1.5 flex-1 rounded-full bg-paper-3">
        <div
          className="h-full rounded-full bg-ink transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-xs text-ink-3 tabular-nums">
        {safeDone}/{safeTotal}
      </span>
    </div>
  );
};
