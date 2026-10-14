/**
 * Definition of CrossedArts' logical "study day".
 *
 * BEFORE: the "today" and streak queries used `date('now')`, which in SQLite
 * means UTC. For a user in a negative UTC offset, an 11:30 pm local session
 * would have been counted on the wrong day, and the streak could break or skip
 * a day right at the midnight boundary.
 *
 * NOW (deliberate, explicit strategy): the study day is the LOCAL calendar day
 * of the user's clock. No timezone framework is introduced: the local
 * `YYYY-MM-DD` date is derived in JavaScript and passed as a parameter to
 * parameterized SQLite queries.
 *
 * Deliberate, documented consequences:
 *  - Persisted timestamps (`datetime('now')`) remain UTC. No existing row is
 *    migrated: only how rows are labeled to a day changes.
 *  - The computation is deterministic for a given timezone and reproducible in
 *    tests (the offset can be injected explicitly).
 *  - No browser/server ambiguity: the backend takes no part in these KPIs.
 */

/** Result of resolving the local calendar day from a UTC instant. */
export interface LocalDayResolution {
  /** Local day in `YYYY-MM-DD` format. */
  day: string;
  /**
   * Shift applied to the UTC timestamp to obtain the local day, as a modifier
   * accepted by SQLite date functions (e.g. `'-240 minutes'`).
   */
  utcOffsetModifier: string;
}

/**
 * Formats a number of minutes as a SQLite date modifier.
 *
 * IMPORTANT: for a 0 offset an empty string is NOT returned. SQLite treats `''`
 * as an invalid modifier and makes `date(x, '')` return NULL for ALL rows, which
 * left the "today" summary and the streak permanently at zero for any user in
 * UTC (offset +00:00). `'0 minutes'` is valid and equivalent to no shift at all.
 */
function formatUtcOffsetModifier(offsetMinutes: number): string {
  if (offsetMinutes === 0) return '0 minutes';
  const sign = offsetMinutes > 0 ? '+' : '-';
  return `${sign}${Math.abs(offsetMinutes)} minutes`;
}

/**
 * Normalizes an hour offset in `±HH:MM` format (the one returned by the timezone
 * API) into signed minutes relative to UTC.
 */
export function parseUtcOffsetToMinutes(offset: string): number {
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(offset.trim());
  if (!match) throw new Error(`Desfase horario inválido: "${offset}" (se esperaba ±HH:MM).`);
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/**
 * Converts a UTC instant into its local calendar day.
 *
 * The algorithm is intentionally simple and deterministic: the local offset at
 * that specific instant (`getTimezoneOffset`) is computed, applied to the UTC
 * timestamp, and the date part is read. Applying the offset at the instant
 * (rather than a fixed offset captured from "now") keeps the result correct even
 * in the middle of a daylight saving time change.
 */
export function resolveLocalDay(now: Date = new Date(), utcOffset?: string): LocalDayResolution {
  let offsetMinutes: number;
  if (utcOffset !== undefined) {
    // Explicit offset: deterministic path for tests and environments without a reliable local clock.
    offsetMinutes = parseUtcOffsetToMinutes(utcOffset);
  } else {
    // `getTimezoneOffset()` returns minutes TO SUBTRACT from local time, hence the inverted sign.
    offsetMinutes = -now.getTimezoneOffset();
  }

  const shifted = new Date(now.getTime() + offsetMinutes * 60_000);
  const day = shifted.toISOString().slice(0, 10);
  return { day, utcOffsetModifier: formatUtcOffsetModifier(offsetMinutes) };
}

/**
 * Shifts a `YYYY-MM-DD` calendar day by a number of days, in pure UTC.
 *
 * It works on the string, not on a local `Date`, so the day change does not
 * depend on the timezone of the process running the test.
 */
export function shiftIsoDay(day: string, deltaDays: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`Día inválido: "${day}" (se esperaba YYYY-MM-DD).`);
  }
  const parsed = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Día inválido: "${day}".`);
  }
  parsed.setUTCDate(parsed.getUTCDate() + deltaDays);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Computes the active streak by counting consecutive days backwards from `today`.
 *
 * Pure, deterministic function: it receives the set of study days and the
 * current local day, and returns the number of consecutive days. Without
 * activity today it checks yesterday (so an open streak stays alive until the
 * day ends); without activity yesterday either, the streak is zero.
 */
export function computeActiveStreak(studyDays: Iterable<string>, today: string): number {
  const days = studyDays instanceof Set ? studyDays : new Set(studyDays);
  if (days.has(today)) {
    return countBackwards(days, today);
  }
  // Without activity today the streak stays alive if there was activity
  // yesterday, and counts from yesterday (no artificial day is added).
  const yesterday = shiftIsoDay(today, -1);
  if (!days.has(yesterday)) return 0;
  return countBackwards(days, yesterday);
}

function countBackwards(days: Set<string>, fromDay: string): number {
  let streak = 0;
  let cursor = fromDay;
  while (days.has(cursor)) {
    streak += 1;
    cursor = shiftIsoDay(cursor, -1);
  }
  return streak;
}