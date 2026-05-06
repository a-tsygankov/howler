import type { LocalTimeString, UTCTimeString } from "./types";

/**
 * Converts a local "HH:MM" time string to a UTC "HH:MM" string.
 *
 * Uses the browser's current timezone (Intl) so no timezone arg is needed.
 * Call this before persisting schedule data to D1.
 *
 * @example
 * // User is in America/New_York (UTC-4 in summer)
 * localToUTC("10:00") // → "14:00"
 * localToUTC("13:00") // → "17:00"
 * localToUTC("22:00") // → "02:00"  (next day UTC — date is not tracked here)
 *
 * @example
 * // On form submit in your Hono route handler:
 * const utcTimes = formTimes.map(localToUTC).filter(Boolean) as UTCTimeString[];
 * await db.insert(schedules).values({ taskId, times: JSON.stringify(utcTimes) });
 */
export function localToUTC(time: LocalTimeString): UTCTimeString | null {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [h = 0, m = 0] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return (
    String(d.getUTCHours()).padStart(2, "0") +
    ":" +
    String(d.getUTCMinutes()).padStart(2, "0")
  );
}

/**
 * Returns the user's IANA timezone name, e.g. "America/New_York".
 * Useful for displaying a timezone hint in the UI or logging.
 */
export function getLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Inverse of localToUTC — converts a UTC "HH:MM" string into a local
 * "HH:MM" string. Use when loading server data (which is stored UTC)
 * for display in the picker.
 *
 * @example
 * // User is in America/New_York (UTC-4 in summer)
 * utcToLocal("14:00") // → "10:00"
 * utcToLocal("02:00") // → "22:00"  (previous day local)
 */
export function utcToLocal(time: UTCTimeString): LocalTimeString | null {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [h = 0, m = 0] = time.split(":").map(Number);
  const d = new Date();
  d.setUTCHours(h, m, 0, 0);
  return (
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0")
  );
}
