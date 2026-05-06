/**
 * DailyTimePicker — barrel index
 *
 * Two variants are available. To switch between them, change ONE line:
 *
 *   Active variant A (pills + modal):
 *     export { DailyTimePickerPills as DailyTimePicker } from "./DailyTimePickerPills";
 *
 *   Active variant B (24h timeline strip):
 *     export { DailyTimePickerTimeline as DailyTimePicker } from "./DailyTimePickerTimeline";
 *
 * All consumers import as `DailyTimePicker` and need no changes when switching.
 */

// ── ACTIVE VARIANT — change this line to switch ──────────────────────────────
export { DailyTimePickerPills as DailyTimePicker } from "./DailyTimePickerPills";
// export { DailyTimePickerTimeline as DailyTimePicker } from "./DailyTimePickerTimeline";
// ─────────────────────────────────────────────────────────────────────────────

// Named exports for direct use if you need both simultaneously
export { DailyTimePickerPills } from "./DailyTimePickerPills";
export { DailyTimePickerTimeline } from "./DailyTimePickerTimeline";

// Utilities
export { localToUTC, utcToLocal, getLocalTimezone } from "./timeUtils";

// Types
export type { DailyTimePickerProps, LocalTimeString, UTCTimeString } from "./types";
