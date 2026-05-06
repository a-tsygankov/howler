import { useRef } from "react";
import type { DailyTimePickerProps } from "./types";

/**
 * Timeline-strip time picker for daily schedule entry.
 *
 * - A 24-hour horizontal bar: click to place a marker, drag to reposition.
 * - Times snap to whole hours only (suitable for tasks where minute precision
 *   is not required). For minute-accurate input, use DailyTimePickerPills.
 * - Selected times are reflected as chip badges below the strip.
 *
 * Times are stored as whole-hour local-timezone strings ("HH:00"). Convert
 * to UTC before persisting to D1:
 *   import { localToUTC } from "./timeUtils";
 *   const utcTimes = value.map(localToUTC).filter(Boolean);
 */
export function DailyTimePickerTimeline({
  value,
  onChange,
  maxSlots = 6,
}: DailyTimePickerProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);

  // Convert "HH:00" strings back to integer hours for internal use
  const markers = value.map((t) => parseInt(t.split(":")[0] ?? "0", 10));

  const setMarkers = (next: number[]) => {
    onChange(next.map((h) => `${String(h).padStart(2, "0")}:00`));
  };

  const addAt = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragging.current !== null) return;
    const rect = barRef.current!.getBoundingClientRect();
    const hour = Math.round(((e.clientX - rect.left) / rect.width) * 24);
    const clamped = Math.max(0, Math.min(23, hour));
    if (markers.length < maxSlots && !markers.includes(clamped)) {
      setMarkers([...markers, clamped].sort((a, b) => a - b));
    }
  };

  const startDrag = (e: React.MouseEvent, i: number) => {
    e.stopPropagation();
    dragging.current = i;

    const move = (ev: MouseEvent) => {
      const rect = barRef.current!.getBoundingClientRect();
      const hour = Math.max(
        0,
        Math.min(23, Math.round(((ev.clientX - rect.left) / rect.width) * 24))
      );
      setMarkers(
        markers.map((h, idx) => (idx === i ? hour : h))
      );
    };

    const up = () => {
      dragging.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const remove = (e: React.MouseEvent, i: number) => {
    e.stopPropagation();
    setMarkers(markers.filter((_, idx) => idx !== i));
  };

  const fmt = (h: number) => `${String(h).padStart(2, "0")}:00`;

  return (
    <>
      <style>{TIMELINE_CSS}</style>

      <div className="dtp-tl-wrap">
        {/* Hour labels */}
        <div className="dtp-tl-labels">
          {[0, 6, 12, 18, 23].map((h) => (
            <span key={h} style={{ left: `${(h / 23) * 100}%` }}>
              {h}h
            </span>
          ))}
        </div>

        {/* Interactive bar */}
        <div className="dtp-tl-bar" ref={barRef} onClick={addAt}>
          <div className="dtp-tl-track" />

          {markers.map((h, i) => (
            <div
              key={i}
              className="dtp-tl-marker"
              style={{ left: `${(h / 23) * 100}%` }}
              onMouseDown={(e) => startDrag(e, i)}
            >
              <div className="dtp-tm-dot" />
              <div className="dtp-tm-label">
                {fmt(h)}
                <button
                  className="dtp-tm-remove"
                  onClick={(e) => remove(e, i)}
                  aria-label="Remove time"
                >
                  ×
                </button>
              </div>
            </div>
          ))}

          {markers.length === 0 && (
            <div className="dtp-tl-hint">Click anywhere to add a time</div>
          )}
        </div>

        <div className="dtp-tl-sub">
          Click to add · Drag to adjust ·{" "}
          {markers.length < maxSlots
            ? `${maxSlots - markers.length} more slots available`
            : `Maximum ${maxSlots} times`}
        </div>
      </div>

      {/* Selected time chips */}
      <div className="dtp-tl-chips">
        {[...markers]
          .sort((a, b) => a - b)
          .map((h, i) => (
            <span key={i} className="dtp-tl-chip">
              {fmt(h)}
            </span>
          ))}
      </div>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const TIMELINE_CSS = `
  .dtp-tl-wrap { display: flex; flex-direction: column; gap: 8px; }

  .dtp-tl-labels {
    position: relative;
    height: 16px;
    font-size: 10px;
    color: #52525b;
  }
  .dtp-tl-labels span {
    position: absolute;
    transform: translateX(-50%);
  }

  .dtp-tl-bar {
    position: relative;
    height: 48px;
    cursor: crosshair;
    display: flex;
    align-items: center;
  }
  .dtp-tl-track {
    position: absolute;
    left: 0; right: 0;
    height: 4px;
    background: #27272a;
    border-radius: 2px;
  }

  .dtp-tl-marker {
    position: absolute;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    cursor: grab;
    user-select: none;
    z-index: 2;
  }
  .dtp-tl-marker:active { cursor: grabbing; }

  .dtp-tm-dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    border: 2px solid #18181b;
    box-shadow: 0 0 0 2px #6366f1;
    transition: transform 0.15s;
  }
  .dtp-tl-marker:hover .dtp-tm-dot { transform: scale(1.3); }

  .dtp-tm-label {
    position: absolute;
    top: 18px;
    background: #27272a;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px;
    padding: 2px 6px;
    font-size: 10px;
    font-weight: 600;
    color: #a5b4fc;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 4px;
    pointer-events: none;
  }
  .dtp-tm-remove {
    background: none;
    border: none;
    color: #52525b;
    cursor: pointer;
    font-size: 12px;
    padding: 0;
    pointer-events: all;
    transition: color 0.15s;
  }
  .dtp-tm-remove:hover { color: #f87171; }

  .dtp-tl-hint {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    font-size: 11px;
    color: #3f3f46;
    pointer-events: none;
  }
  .dtp-tl-sub {
    font-size: 10px;
    color: #3f3f46;
    text-align: center;
  }

  .dtp-tl-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }
  .dtp-tl-chip {
    background: rgba(99,102,241,0.15);
    border: 1px solid rgba(99,102,241,0.3);
    border-radius: 6px;
    padding: 3px 10px;
    font-size: 12px;
    font-weight: 600;
    color: #a5b4fc;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }
`;
