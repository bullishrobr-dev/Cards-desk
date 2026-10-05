import { decodeEntities } from '../normalise/text.ts';
import type { Precision } from './types.ts';

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function valid(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Strips tags and decodes entities; collapses whitespace. */
export function textOf(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export interface ParsedDate {
  date: string | null;
  precision: Precision;
}

/**
 * Parses the date formats our sources publish. Day-first for numeric dates (UK/EU sources).
 * - "2026-10-15", "November 6, 2026", "November 6th 2026", "6 November 2026", "20/08/2026"
 * - Month-level: "November 2026", "Early November 2026", "Mid to late November 2026"
 * - "TBD", "TBA" and anything unrecognised → no date.
 */
export function parseDate(raw: string): ParsedDate {
  const s = raw.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  let m = s.match(/\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return valid(y, mo, d) ? { date: iso(y, mo, d), precision: 'day' } : { date: null, precision: 'unknown' };
  }
  m = s.match(/\b([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)? (20\d\d)\b/);
  if (m && MONTHS[m[1] ?? ''] !== undefined) {
    const [y, mo, d] = [Number(m[3]), MONTHS[m[1] ?? ''] ?? 0, Number(m[2])];
    if (valid(y, mo, d)) return { date: iso(y, mo, d), precision: 'day' };
  }
  m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.? (20\d\d)\b/);
  if (m && MONTHS[m[2] ?? ''] !== undefined) {
    const [y, mo, d] = [Number(m[3]), MONTHS[m[2] ?? ''] ?? 0, Number(m[1])];
    if (valid(y, mo, d)) return { date: iso(y, mo, d), precision: 'day' };
  }
  m = s.match(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d\d)\b/);
  if (m) {
    const [y, mo, d] = [Number(m[3]), Number(m[2]), Number(m[1])];
    if (valid(y, mo, d)) return { date: iso(y, mo, d), precision: 'day' };
  }
  m = s.match(/\b([a-z]+) (20\d\d)\b/);
  if (m && MONTHS[m[1] ?? ''] !== undefined) {
    return { date: iso(Number(m[2]), MONTHS[m[1] ?? ''] ?? 1, 1), precision: 'month' };
  }
  return { date: null, precision: 'unknown' };
}

/** "649.99" → 64999; "1.899,00" is not a format any of our JSON sources use. */
export function toMinor(decimal: string | number | null | undefined): number | null {
  if (decimal === null || decimal === undefined || decimal === '') return null;
  const n = typeof decimal === 'number' ? decimal : Number(decimal);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Parses simple HTML tables, expanding rowspan/colspan, into a grid of cell HTML. */
export function tableGrid(tableHtml: string): string[][] {
  const grid: string[][] = [];
  const carry: Array<{ html: string; left: number } | undefined> = [];
  const rows = tableHtml.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/gi)];
    const out: string[] = [];
    let col = 0;
    const takeCarry = () => {
      while (carry[col] && (carry[col]?.left ?? 0) > 0) {
        const c = carry[col] as { html: string; left: number };
        out[col] = c.html;
        c.left -= 1;
        col += 1;
      }
    };
    for (const cell of cells) {
      takeCarry();
      const attrs = cell[2] ?? '';
      const html = cell[3] ?? '';
      const rowspan = Number(attrs.match(/rowspan="?(\d+)/i)?.[1] ?? 1);
      const colspan = Number(attrs.match(/colspan="?(\d+)/i)?.[1] ?? 1);
      for (let k = 0; k < colspan; k++) {
        out[col] = html;
        carry[col] = rowspan > 1 ? { html, left: rowspan - 1 } : undefined;
        col += 1;
      }
    }
    takeCarry();
    grid.push(out);
  }
  return grid;
}
