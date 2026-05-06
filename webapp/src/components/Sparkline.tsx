// Hand-rolled SVG sparkline, ~30 LOC per the design handoff.
// Designed for the task-detail view's last-30 `task_executions`.
// Y-axis is normalized [min, max] of the values it actually
// receives; missing values are skipped (null in result_value
// means the user pressed Done without entering a value).

export interface SparklinePoint {
  ts: number;
  value: number | null;
}

export interface SparklineProps {
  points: SparklinePoint[];
  width?: number;
  height?: number;
  className?: string;
}

export const Sparkline = ({
  points,
  width = 320,
  height = 56,
  className = "",
}: SparklineProps) => {
  const dataPoints = points.filter(
    (p): p is SparklinePoint & { value: number } => p.value !== null,
  );
  if (dataPoints.length === 0) {
    return (
      <div
        className={`flex items-center justify-center text-ink-3 ${className}`}
        style={{ width, height }}
      >
        <span className="cap">no values yet</span>
      </div>
    );
  }
  const minTs = Math.min(...dataPoints.map((p) => p.ts));
  const maxTs = Math.max(...dataPoints.map((p) => p.ts));
  const minV = Math.min(...dataPoints.map((p) => p.value));
  const maxV = Math.max(...dataPoints.map((p) => p.value));
  const xRange = Math.max(maxTs - minTs, 1);
  const yRange = Math.max(maxV - minV, 1);

  const xy = (p: SparklinePoint & { value: number }) => {
    const x = ((p.ts - minTs) / xRange) * (width - 8) + 4;
    const y = height - 4 - ((p.value - minV) / yRange) * (height - 8);
    return [x, y] as const;
  };

  // Sort ascending by ts so the polyline reads left → right.
  const sorted = [...dataPoints].sort((a, b) => a.ts - b.ts);
  const d = sorted
    .map((p, i) => {
      const [x, y] = xy(p);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const last = sorted[sorted.length - 1];
  const [lx, ly] = last ? xy(last) : [0, 0];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {last && (
        <circle cx={lx} cy={ly} r="2.5" fill="currentColor" />
      )}
    </svg>
  );
};
