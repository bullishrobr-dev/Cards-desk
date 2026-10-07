import type { RulesConfig } from '../../shared/config/schema.ts';
import type { DropSummary, WeeklyBrief } from '../../shared/api-types.ts';
import { listDrops } from '../api/queries.ts';
import { addDays, localDate, localTimeUtc } from '../time.ts';

/**
 * The weekly brief: every Sunday at 18:00 Europe/Gibraltar (rules.alerts.weekly_brief), the
 * drops of the next 14 days ranked by Desk Score, with one push pointing at /brief.
 */

/** The brief moments either side of `now`: the latest one at or before it and the next after it. */
export function briefMoments(now: Date, rules: RulesConfig): { last: { at: Date; date: string }; next: Date } {
  const { weekday, local_time } = rules.alerts.weekly_brief;
  const tz = rules.owner.timezone;
  const today = localDate(now, tz);
  const back = (new Date(`${today}T12:00:00Z`).getUTCDay() - weekday + 7) % 7;
  let date = addDays(today, -back);
  let at = localTimeUtc(date, local_time, tz);
  if (at > now) {
    date = addDays(date, -7);
    at = localTimeUtc(date, local_time, tz);
  }
  return { last: { at, date }, next: localTimeUtc(addDays(date, 7), local_time, tz) };
}

const DATED = new Set(['day', 'time', 'week']);

/** Ranks a brief: drops passing every gate first, then by score, then by date. */
export function rankBrief(drops: DropSummary[]): DropSummary[] {
  return [...drops].sort(
    (a, b) =>
      Number(a.desk.gated) - Number(b.desk.gated) ||
      Number(b.pinned) - Number(a.pinned) ||
      b.desk.score - a.desk.score ||
      (a.startsAt ?? '').localeCompare(b.startsAt ?? ''),
  );
}

export async function buildBrief(db: D1Database, rules: RulesConfig, now: Date, ownerId: string): Promise<WeeklyBrief> {
  const tz = rules.owner.timezone;
  const from = localDate(now, tz);
  const to = addDays(from, rules.alerts.weekly_brief.days_ahead);
  const upcoming = await listDrops(db, rules, { view: 'upcoming', category: null, region: null }, now, ownerId);
  // Only drops with a day (or week) inside the window; month-level dates would claim false precision.
  const inWindow = upcoming.filter((d) => d.startsAt && DATED.has(d.precision) && localDateOf(d) <= to);
  const drops = rankBrief(inWindow);
  const count = (l: string) => drops.filter((d) => !d.desk.gated && d.desk.label === l).length;
  return { from, to, generatedAt: now.toISOString(), priority: count('Priority'), watch: count('Watch'), gated: drops.filter((d) => d.desk.gated).length, drops };
}

function localDateOf(d: DropSummary): string {
  return (d.startsAt ?? '').slice(0, 10);
}

/** One-line summary for the push. */
export function briefSummary(b: WeeklyBrief): string {
  const total = b.drops.length;
  if (total === 0) return `Nothing dated in the next ${daysBetween(b.from, b.to)} days.`;
  const top = b.drops.find((d) => !d.desk.gated);
  const parts = [`${total} drop${total === 1 ? '' : 's'} in the next ${daysBetween(b.from, b.to)} days`];
  if (b.priority) parts.push(`${b.priority} Priority`);
  if (b.watch) parts.push(`${b.watch} Watch`);
  return `${parts.join(', ')}.${top ? ` Top: ${top.name} (${top.desk.score}).` : ''}`;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
