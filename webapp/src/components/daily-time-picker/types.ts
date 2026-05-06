/**
 * Shared types for the DailyTimePicker component family.
 */

/** A local-timezone time string in "HH:MM" 24h format, e.g. "09:00", "22:30" */
export type LocalTimeString = string;

/** A UTC time string in "HH:MM" format, ready to store in D1 */
export type UTCTimeString = string;

export interface DailyTimePickerProps {
  /**
   * Controlled list of local-timezone times in "HH:MM" format.
   * Displayed as-is; UTC conversion happens on submit via localToUTC().
   */
  value: LocalTimeString[];

  /** Called whenever the user adds, edits, or removes a time slot. */
  onChange: (times: LocalTimeString[]) => void;

  /** Maximum number of time slots the user can add. Default: 6 */
  maxSlots?: number;
}
