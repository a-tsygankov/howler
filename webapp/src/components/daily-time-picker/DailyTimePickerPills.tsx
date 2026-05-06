import { useEffect, useRef, useState } from "react";
import type { DailyTimePickerProps } from "./types";

// ─── TimePickerModal ──────────────────────────────────────────────────────────

interface TimePickerModalProps {
  onConfirm: (time: string) => void;
  onCancel: () => void;
}

// The hour column repeats 0–23 five times (120 entries) so the
// scroll has "infinite-feel" margin in either direction without
// needing real virtualised wrap-around. Default lands at "09" in
// the middle (3rd) set so the user can scroll a comfortable
// distance up or down before hitting an edge.
const HOUR_REPEATS = 5;
const HOURS_PER_SET = 24;
const HOUR_SLOTS = HOUR_REPEATS * HOURS_PER_SET;       // 120
const DEFAULT_HOUR_INDEX = 2 * HOURS_PER_SET + 9;      // 57 → "09" in set #3

function TimePickerModal({ onConfirm, onCancel }: TimePickerModalProps) {
  const [hourIndex, setHourIndex] = useState(DEFAULT_HOUR_INDEX);
  const [minute, setMinute] = useState(0);
  const MINUTE_STEPS = [0, 15, 30, 45];
  const fmt2 = (n: number) => String(n).padStart(2, "0");
  const hour = hourIndex % HOURS_PER_SET;

  // Scroll the hour column so the active item is centered. The
  // items' offsetParent is the modal-backdrop (the nearest
  // positioned ancestor), not the scroll column itself, so we
  // can't use offsetTop directly — we measure with bounding rects
  // and current scrollTop. We also re-run on animationend because
  // the modal's `dtpSlideUp` keyframe applies a `scale(0.96)`
  // that shifts measured positions while it runs.
  const hourColRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const col = hourColRef.current;
    if (!col) return;
    const center = () => {
      const active = col.querySelector<HTMLButtonElement>(
        ".dtp-scroll-item.active",
      );
      if (!active) return;
      const colRect = col.getBoundingClientRect();
      const itemRect = active.getBoundingClientRect();
      const itemTopInContent = itemRect.top - colRect.top + col.scrollTop;
      col.scrollTop =
        itemTopInContent + itemRect.height / 2 - col.clientHeight / 2;
    };
    center();
    const modal = col.closest<HTMLDivElement>(".dtp-modal");
    if (!modal) return;
    const onEnd = () => center();
    modal.addEventListener("animationend", onEnd, { once: true });
    return () => modal.removeEventListener("animationend", onEnd);
  }, []);

  return (
    <>
      <style>{MODAL_CSS}</style>
      <div className="dtp-modal-backdrop" onClick={onCancel}>
        <div className="dtp-modal" onClick={(e) => e.stopPropagation()}>

          <div className="dtp-modal-header">
            <span className="dtp-modal-title">Pick a time</span>
            <span className="dtp-modal-preview">
              {fmt2(hour)}:{fmt2(minute)}
            </span>
          </div>

          <div className="dtp-modal-columns">
            <div className="dtp-col-label">Hour</div>
            <div className="dtp-col-label">Minute</div>

            <div className="dtp-scroll-col" ref={hourColRef}>
              {Array.from({ length: HOUR_SLOTS }, (_, i) => (
                <button
                  key={i}
                  className={`dtp-scroll-item${i === hourIndex ? " active" : ""}`}
                  onClick={() => setHourIndex(i)}
                >
                  {fmt2(i % HOURS_PER_SET)}
                </button>
              ))}
            </div>

            <div className="dtp-scroll-col">
              {MINUTE_STEPS.map((m) => (
                <button
                  key={m}
                  className={`dtp-scroll-item${m === minute ? " active" : ""}`}
                  onClick={() => setMinute(m)}
                >
                  {fmt2(m)}
                </button>
              ))}
            </div>
          </div>

          <div className="dtp-modal-actions">
            <button className="dtp-modal-cancel" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="dtp-modal-confirm"
              onClick={() => onConfirm(`${fmt2(hour)}:${fmt2(minute)}`)}
            >
              Add
            </button>
          </div>

        </div>
      </div>
    </>
  );
}

// ─── DailyTimePickerPills (Variant A) ────────────────────────────────────────

/**
 * Pill-chip time picker for daily schedule entry.
 *
 * - Each time slot renders as a dismissible pill with an inline <input type="time">.
 * - Clicking "+ Add time" opens a modal with scrollable hour/minute columns.
 * - Existing pills remain directly editable without reopening the modal.
 *
 * Times are stored in local timezone ("HH:MM"). Convert to UTC before
 * persisting to D1:
 *   import { localToUTC } from "./timeUtils";
 *   const utcTimes = value.map(localToUTC).filter(Boolean);
 */
export function DailyTimePickerPills({
  value,
  onChange,
  maxSlots = 6,
}: DailyTimePickerProps) {
  const [showPicker, setShowPicker] = useState(false);

  const update = (i: number, time: string) => {
    const next = [...value];
    next[i] = time;
    onChange(next);
  };

  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  const handleConfirm = (time: string) => {
    onChange([...value, time]);
    setShowPicker(false);
  };

  return (
    <>
      <style>{PILLS_CSS}</style>

      <div className="dtp-pill-row">
        {value.map((t, i) => (
          <div key={i} className="dtp-pill">
            <span className="dtp-pill-clock">🕐</span>
            <input
              type="time"
              className="dtp-pill-input"
              value={t}
              onChange={(e) => update(i, e.target.value)}
            />
            <button
              className="dtp-pill-remove"
              onClick={() => remove(i)}
              aria-label="Remove time"
            >
              ×
            </button>
          </div>
        ))}

        {value.length < maxSlots && (
          <button
            className="dtp-pill-add"
            onClick={() => setShowPicker(true)}
          >
            + Add time
          </button>
        )}
      </div>

      {showPicker && (
        <TimePickerModal
          onConfirm={handleConfirm}
          onCancel={() => setShowPicker(false)}
        />
      )}
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const PILLS_CSS = `
  .dtp-pill-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .dtp-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #27272a;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 100px;
    padding: 6px 10px;
    transition: border-color 0.2s;
  }
  .dtp-pill:focus-within {
    border-color: #6366f1;
    box-shadow: 0 0 0 3px rgba(99,102,241,0.15);
  }
  .dtp-pill-clock { font-size: 14px; }
  .dtp-pill-input {
    background: transparent;
    border: none;
    outline: none;
    color: #f4f4f5;
    font-size: 14px;
    font-weight: 600;
    width: 74px;
    cursor: pointer;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }
  .dtp-pill-input::-webkit-calendar-picker-indicator {
    filter: invert(0.7);
    cursor: pointer;
  }
  .dtp-pill-remove {
    background: none;
    border: none;
    color: #52525b;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 0 2px;
    transition: color 0.15s;
  }
  .dtp-pill-remove:hover { color: #f87171; }
  .dtp-pill-add {
    background: none;
    border: 1px dashed rgba(255,255,255,0.2);
    border-radius: 100px;
    color: #71717a;
    font-size: 13px;
    padding: 6px 14px;
    cursor: pointer;
    transition: all 0.2s;
  }
  .dtp-pill-add:hover { border-color: #6366f1; color: #a5b4fc; }
`;

const MODAL_CSS = `
  .dtp-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: dtpFadeIn 0.15s ease;
  }
  @keyframes dtpFadeIn { from { opacity: 0 } to { opacity: 1 } }

  .dtp-modal {
    background: #1c1c21;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 20px;
    padding: 24px;
    width: 280px;
    box-shadow: 0 24px 64px rgba(0,0,0,0.6);
    animation: dtpSlideUp 0.2s cubic-bezier(0.34,1.56,0.64,1);
  }
  @keyframes dtpSlideUp {
    from { opacity: 0; transform: translateY(20px) scale(0.96) }
    to   { opacity: 1; transform: translateY(0) scale(1) }
  }
  .dtp-modal-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 20px;
  }
  .dtp-modal-title { font-size: 13px; color: #71717a; font-weight: 500; }
  .dtp-modal-preview {
    font-size: 30px;
    font-weight: 700;
    color: #f4f4f5;
    font-family: 'SF Mono', 'Fira Code', monospace;
    letter-spacing: -1px;
  }
  .dtp-modal-columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 20px;
  }
  .dtp-col-label {
    font-size: 10px;
    color: #52525b;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0 4px 6px;
  }
  .dtp-scroll-col {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 184px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #3f3f46 transparent;
    padding-right: 4px;
  }
  .dtp-scroll-col::-webkit-scrollbar { width: 4px; }
  .dtp-scroll-col::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 2px; }
  .dtp-scroll-item {
    background: none;
    border: 1px solid transparent;
    color: #71717a;
    font-size: 14px;
    font-weight: 600;
    font-family: 'SF Mono', 'Fira Code', monospace;
    padding: 7px 10px;
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    transition: all 0.12s;
  }
  .dtp-scroll-item:hover { background: #27272a; color: #e4e4e7; }
  .dtp-scroll-item.active {
    background: rgba(99,102,241,0.2);
    color: #a5b4fc;
    border-color: rgba(99,102,241,0.35);
  }
  .dtp-modal-actions { display: flex; gap: 8px; }
  .dtp-modal-cancel {
    flex: 1;
    background: #27272a;
    border: 1px solid rgba(255,255,255,0.08);
    color: #71717a;
    font-size: 14px;
    font-weight: 500;
    padding: 10px;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .dtp-modal-cancel:hover { background: #2f2f35; color: #a1a1aa; }
  .dtp-modal-confirm {
    flex: 2;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    border: none;
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    padding: 10px;
    border-radius: 10px;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(99,102,241,0.35);
    transition: opacity 0.15s, transform 0.15s;
  }
  .dtp-modal-confirm:hover { opacity: 0.9; transform: translateY(-1px); }
  .dtp-modal-confirm:active { transform: translateY(0); }
`;
