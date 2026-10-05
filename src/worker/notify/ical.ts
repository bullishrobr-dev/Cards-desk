/**
 * iCalendar (RFC 5545) for watched drops. Day-precision drops are all-day events; drops with a
 * confirmed time are timed events in UTC. Month-level dates are left out: a calendar entry
 * would claim a day nobody has announced. SEQUENCE rises with every date change, so subscribed
 * calendars move the event when a date slips.
 */

export interface CalendarDrop {
  id: string;
  name: string;
  startsAt: string;
  precision: 'day' | 'time';
  confidence: string;
  sequence: number;
  url: string;
  updatedAt: string;
}

const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Folds lines at 75 octets as RFC 5545 requires (continuation lines start with a space). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateOnly = (ymd: string) => ymd.slice(0, 10).replace(/-/g, '');
function nextDay(ymd: string): string {
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

export function buildCalendar(drops: CalendarDrop[], opts: { name: string; now: Date; alarmMinutesBefore?: number }): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Card Desk Drops//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(opts.name)}`, 'X-WR-TIMEZONE:Europe/Gibraltar', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const d of drops) {
    lines.push('BEGIN:VEVENT', `UID:${d.id}@card-desk-drops`, `DTSTAMP:${stamp(opts.now.toISOString())}`, `LAST-MODIFIED:${stamp(new Date(d.updatedAt).toISOString())}`, `SEQUENCE:${d.sequence}`);
    if (d.precision === 'time') {
      const start = new Date(d.startsAt);
      lines.push(`DTSTART:${stamp(start.toISOString())}`, `DTEND:${stamp(new Date(start.getTime() + 30 * 60_000).toISOString())}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(d.startsAt)}`, `DTEND;VALUE=DATE:${nextDay(d.startsAt)}`);
    }
    lines.push(`SUMMARY:${escapeText(d.name)}`, `DESCRIPTION:${escapeText(`Confidence: ${d.confidence.replace('_', ' ')}\n${d.url}`)}`, `URL:${d.url}`, 'TRANSP:TRANSPARENT');
    if (opts.alarmMinutesBefore !== undefined) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(d.name)}`, `TRIGGER:-PT${opts.alarmMinutesBefore}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** Watched drops with a day or time, ready for the feed. */
export async function watchedCalendarDrops(db: D1Database, ownerId: string, appUrl: string, dropId?: string): Promise<CalendarDrop[]> {
  const rows = await db
    .prepare(
      `SELECT d.id, r.name, d.starts_at, d.precision, d.confidence, d.updated_at,
              (SELECT COUNT(*) FROM drop_date_history h WHERE h.drop_id = d.id) - 1 AS sequence
       FROM drops d JOIN releases r ON r.id = d.release_id
       WHERE d.starts_at IS NOT NULL AND d.precision IN ('day', 'time') AND d.status != 'cancelled'
         AND ${dropId ? 'd.id = ?' : `d.release_id IN (SELECT target_id FROM watchlist WHERE owner_id = ? AND target_type = 'release')`}`,
    )
    .bind(dropId ?? ownerId)
    .all<{ id: string; name: string; starts_at: string; precision: 'day' | 'time'; confidence: string; updated_at: string; sequence: number }>();
  return rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    startsAt: r.starts_at,
    precision: r.precision,
    confidence: r.confidence,
    sequence: Math.max(0, r.sequence),
    url: `${appUrl}/drop/${r.id}`,
    updatedAt: r.updated_at,
  }));
}
