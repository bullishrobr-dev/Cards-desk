/**
 * Exponential back-off for a failing source unit: 15 min, 30 min, 1 h, 2 h ... capped at 24 h.
 * A 429 with Retry-After uses the server's value when that is longer.
 */
const BASE_MINUTES = 15;
const CAP_MINUTES = 24 * 60;

export function backoffMinutes(level: number): number {
  return Math.min(BASE_MINUTES * 2 ** Math.max(0, level), CAP_MINUTES);
}

/** Parses Retry-After (seconds or HTTP date) into minutes from `now`, or null. */
export function retryAfterMinutes(header: string | null, now: Date): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.ceil(secs / 60);
  const at = Date.parse(header);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now.getTime()) / 60_000));
}

export function nextBackoff(level: number, retryAfter: string | null, now: Date): { until: Date; level: number } {
  const ours = backoffMinutes(level);
  const theirs = retryAfterMinutes(retryAfter, now) ?? 0;
  const minutes = Math.min(Math.max(ours, theirs), CAP_MINUTES);
  return { until: new Date(now.getTime() + minutes * 60_000), level: level + 1 };
}
