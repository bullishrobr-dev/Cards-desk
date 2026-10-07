/**
 * Time helpers. Everything is stored in UTC; a release "day" means midnight Europe/Gibraltar,
 * because that is when a UK/EU shop flips a pre-order to live.
 */

/** Offset of `tz` from UTC at `at`, in minutes (e.g. +120 for CEST). */
export function tzOffsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** UTC instant of local midnight on `ymd` in `tz`. */
export function localMidnightUtc(ymd: string, tz: string): Date {
  return localTimeUtc(ymd, '00:00', tz);
}

/** UTC instant of wall-clock `hhmm` on `ymd` in `tz` (DST-safe: 18:00 stays 18:00 local). */
export function localTimeUtc(ymd: string, hhmm: string, tz: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0));
  // Two passes handle a DST change between the guess and the real instant.
  let t = guess.getTime() - tzOffsetMinutes(guess, tz) * 60_000;
  t = guess.getTime() - tzOffsetMinutes(new Date(t), tz) * 60_000;
  return new Date(t);
}

/** When a drop goes live: the exact time if confirmed, else local midnight of its date. */
export function dropInstant(startsAt: string | null, precision: string, tz: string): Date | null {
  if (!startsAt) return null;
  if (precision === 'time') return new Date(startsAt);
  return localMidnightUtc(startsAt.slice(0, 10), tz);
}

/** YYYY-MM-DD of `at` in `tz`. */
export function localDate(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

/** YYYY-MM-DD plus `days`. */
export function addDays(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
