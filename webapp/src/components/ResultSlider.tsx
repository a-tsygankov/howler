// Slider Sheet ack body — variant B from the design canvas.
// Generic over the task's TaskResult definition (min/max/step/unit).

import { useState } from "react";
import type { TaskResultDef } from "../lib/api.ts";

export interface ResultSliderProps {
  result: TaskResultDef;
  /** Optional last-known value (from prior task_executions) used as
   *  the default when result.useLastValue and lastValue is non-null. */
  lastValue?: number | null;
  onChange: (value: number | null) => void;
}

const inferRange = (r: TaskResultDef): { min: number; max: number } => {
  const min = r.minValue ?? 0;
  // If max is null we pick a sensible cap so the slider has somewhere
  // to travel — last-value + 50 % rounded to the step, fallback 100.
  const fallbackMax = Math.max(100, min + 100);
  const max = r.maxValue ?? fallbackMax;
  return { min, max };
};

export const ResultSlider = ({
  result,
  lastValue,
  onChange,
}: ResultSliderProps) => {
  const { min, max } = inferRange(result);
  const initial =
    result.defaultValue ??
    (result.useLastValue && lastValue != null ? lastValue : min);
  const [value, setValue] = useState<number>(initial);

  const setAndEmit = (v: number) => {
    setValue(v);
    onChange(v);
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="font-display text-3xl tabular-nums">
        {value}
        <span className="ml-1 font-mono text-base text-ink-3">
          {result.unitName}
        </span>
      </div>
      {result.useLastValue && lastValue != null && (
        <p className="cap italic text-ink-3">
          last time was {lastValue} {result.unitName}
        </p>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={result.step}
        value={value}
        onChange={(e) => setAndEmit(Number(e.target.value))}
        className="result-slider w-full"
        aria-label={`${result.displayName} (${result.unitName})`}
      />
      <div className="flex w-full justify-between font-mono text-[11px] text-ink-3">
        <span>{min}</span>
        <span>{max}</span>
      </div>
      <style>{`
        .result-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 6px;
          background: linear-gradient(
            to right,
            #6E8A5C 0%,
            #6E8A5C ${((value - min) / (max - min)) * 100}%,
            #E4D9C0 ${((value - min) / (max - min)) * 100}%,
            #E4D9C0 100%
          );
          border-radius: 999px;
          outline: none;
        }
        .result-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: #2A2620;
          border: 2px solid #F5EFE3;
          cursor: pointer;
          box-shadow: 0 1px 4px rgba(42,38,32,0.25);
        }
        .result-slider::-moz-range-thumb {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: #2A2620;
          border: 2px solid #F5EFE3;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
};
