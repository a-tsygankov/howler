import type { Label, Occurrence, Task } from "../lib/api.ts";
import { HowlerAvatar, type Urgency } from "./HowlerAvatar.tsx";

// One pending-occurrence row in the Day Ribbon. Layout:
//
//   46px mono due time → 38px round HowlerAvatar
//   → flex-1 title + (label name in label color · OVERDUE caps mono)
//   → 28px round Done button.
//
// The "done" visual state comes from a parent that tracks freshly-
// completed rows for the strike-through fade before they leave on
// next render.

const fmtDue = (epochSec: number): string => {
  const d = new Date(epochSec * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
};

const urgencyOf = (occ: Occurrence): Urgency => {
  const nowSec = Date.now() / 1000;
  const dueIn = occ.dueAt - nowSec;
  if (dueIn < -3600) return 3; // > 1 h overdue
  if (dueIn < 0) return 2;     // overdue
  if (dueIn < 3600) return 1;  // due soon
  return 0;
};

export interface DayRibbonRowProps {
  occurrence: Occurrence;
  task: Task | undefined;
  label: Label | undefined;
  acked?: boolean; // local "freshly-acked, fading" state
  busy?: boolean;
  onAck: () => void;
}

export const DayRibbonRow = ({
  occurrence,
  task,
  label,
  acked = false,
  busy = false,
  onAck,
}: DayRibbonRowProps) => {
  const urgency = acked ? 0 : urgencyOf(occurrence);
  const overdue = !acked && occurrence.dueAt < Date.now() / 1000;
  const titleClass = acked
    ? "text-ink-3 line-through"
    : "text-ink";
  const dueClass = acked ? "line-through" : "";

  return (
    <div
      className={`flex items-center gap-3 border-t border-line-soft px-5 py-2.5 transition-opacity ${
        acked ? "opacity-55" : "opacity-100"
      }`}
    >
      <div
        className={`w-12 font-mono text-xs text-ink-3 tabular-nums ${dueClass}`}
      >
        {fmtDue(occurrence.dueAt)}
      </div>
      <HowlerAvatar
        avatarId={task?.avatarId}
        seed={task?.id ?? occurrence.taskId}
        initials={task?.title.slice(0, 2).toUpperCase()}
        urgency={urgency}
        size={38}
      />
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[15px] font-medium ${titleClass}`}>
          {task?.title ?? "(unknown task)"}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          {label && (
            <span
              className="text-xs"
              style={{ color: label.color ?? "#7A7060" }}
            >
              · {label.displayName}
            </span>
          )}
          {overdue && (
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-accent-rose">
              overdue
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onAck}
        disabled={busy || acked}
        aria-label={acked ? "Done" : "Mark done"}
        className={`flex h-7 w-7 items-center justify-center rounded-full border-[1.5px] transition-colors ${
          acked
            ? "border-transparent bg-accent-sage text-paper"
            : "border-line text-ink-3 hover:border-ink hover:text-ink disabled:opacity-50"
        }`}
      >
        {acked ? (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M3 8.5l3.5 3 6.5-7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </button>
    </div>
  );
};
