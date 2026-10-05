import type { Confidence, Money, Precision } from '../shared/api-types.ts';

export const TZ = 'Europe/Gibraltar';

const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const monthFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
const shortFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** A UTC date-only string ("2026-10-15") as a calendar day, not shifted by time zone. */
const asDay = (ymd: string) => new Date(`${ymd.slice(0, 10)}T12:00:00Z`);

export function weekStart(ymd: string): string {
  const d = asDay(ymd);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * The date line for a drop. A countdown is only ever offered when the exact time is confirmed;
 * everything else is "Expected …" with the honest precision.
 */
export function dateLabel(startsAt: string | null, precision: Precision): string {
  if (!startsAt) return 'Date to be confirmed';
  if (precision === 'time') return `${dayFmt.format(new Date(startsAt))}, ${timeFmt.format(new Date(startsAt))}`;
  if (precision === 'day') return `Expected ${dayFmt.format(asDay(startsAt))}`;
  if (precision === 'week') return `Expected week of ${dayFmt.format(asDay(weekStart(startsAt)))}`;
  if (precision === 'month') return `Expected ${monthFmt.format(asDay(startsAt))}`;
  return 'Date to be confirmed';
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  rumoured: 'Rumoured',
  announced: 'Announced',
  confirmed_date: 'Date confirmed',
  confirmed_time: 'Time confirmed',
};

export function showCountdown(precision: Precision, confidence: Confidence): boolean {
  return precision === 'time' && confidence === 'confirmed_time';
}

export function countdown(target: Date, now: Date): string {
  let s = Math.max(0, Math.floor((target.getTime() - now.getTime()) / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

const SYMBOL: Record<string, string> = { GBP: '£', EUR: '€', USD: '$' };

export function formatMinor(minor: number, currency: string): string {
  const v = (minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${SYMBOL[currency] ?? `${currency} `}${v}`;
}

/** "£840.00 (≈ €983.92)" or "€20.00 (≈ £17.07)": original currency first, then the other one. */
export function formatMoney(m: Money): string {
  const main = formatMinor(m.minor, m.currency);
  const other = m.currency === 'GBP' ? (m.eur !== null ? formatMinor(m.eur, 'EUR') : null) : m.gbp !== null ? formatMinor(m.gbp, 'GBP') : null;
  const extra = m.currency !== 'GBP' && m.currency !== 'EUR' && m.eur !== null ? ` / ${formatMinor(m.eur, 'EUR')}` : '';
  return other ? `${main} (≈ ${other}${extra})` : main;
}

/**
 * Price vs RRP wording. Never implies returns: at or under the tolerance the strongest label is
 * "At RRP — fine to rip for fun"; above it, "Above RRP — buy singles instead".
 */
export function rrpLabel(ratio: number | null, tolerance: number): { text: string; tone: 'ok' | 'warn' } | null {
  if (ratio === null) return null;
  if (ratio <= tolerance) return { text: 'At RRP — fine to rip for fun', tone: 'ok' };
  return { text: 'Above RRP — buy singles instead', tone: 'warn' };
}

export function percentVsRrp(ratio: number): string {
  const p = Math.round((ratio - 1) * 100);
  return p === 0 ? 'at RRP' : p > 0 ? `${p}% over RRP` : `${-p}% under RRP`;
}

export const formatStamp = (iso: string | null) => (iso ? shortFmt.format(new Date(iso)) : '—');

export function relativeFromNow(iso: string | null, now = new Date()): string {
  if (!iso) return 'never';
  const mins = Math.round((now.getTime() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
