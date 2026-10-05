import type { Confidence } from '../../shared/config/schema.ts';
import { decodeEntities } from '../normalise/text.ts';
import { parseDate, tableGrid, textOf } from './parse-utils.ts';
import type { ParseResult, ReleaseObservation, Unit } from './types.ts';

const release = (
  title: string,
  url: string | null,
  rawDate: string,
  confidence: Confidence,
  categoryHint: string | null,
  region: string | null = null,
): ReleaseObservation => {
  const { date, precision } = parseDate(rawDate);
  return {
    kind: 'release',
    title,
    url,
    date,
    precision,
    // Without a date the most any source can say is that the release is announced.
    confidence: date ? confidence : 'announced',
    rawDate: rawDate.trim(),
    categoryHint,
    region,
  };
};

/**
 * collectosk: the WP REST page JSON whose content holds a wpDataTables table. A loader <div>
 * sits inside <tbody>, so rows are matched by id rather than by strict DOM structure.
 * Columns: Date (ISO or TBD) | Collection name (optional link) | checklist link | Category.
 */
export function parseCollectosk(body: string, maxConfidence: Confidence): ParseResult {
  const page = JSON.parse(body) as { content?: { rendered?: string } } | Array<{ content?: { rendered?: string } }>;
  const html = (Array.isArray(page) ? page[0] : page)?.content?.rendered;
  if (!html) throw new Error('collectosk: page JSON has no content.rendered');
  const rows = html.match(/<tr id="table_\d+_row_\d+"[\s\S]*?<\/tr>/g) ?? [];
  if (rows.length === 0) throw new Error('collectosk: no calendar rows found (markup changed?)');
  const items = rows.map((row) => {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? '');
    const href = cells[1]?.match(/href="([^"]+)"/)?.[1] ?? null;
    // Strip emoji and the "(Pre-order)" note from names.
    const title = textOf(cells[1] ?? '').replace(/\(pre-?order\)/i, '').replace(/[\p{Extended_Pictographic}️]/gu, '').trim();
    return release(title, href, textOf(cells[0] ?? ''), maxConfidence, textOf(cells[3] ?? '') || null);
  });
  return { items, followUps: [] };
}

/** Checklist Insider: list view; each item has a <time datetime> and a titled link. */
export function parseChecklistInsider(body: string, maxConfidence: Confidence): ParseResult {
  // The first link wraps the thumbnail; the second carries the title.
  const re = /<div class="release-date-stamp[^"]*"[^>]*><time datetime="([^"]+)">[\s\S]*?<\/div>\s*<a href="[^"]+">[\s\S]*?<\/a>\s*<a href="([^"]+)">([^<]+)<\/a>/g;
  const items = [...body.matchAll(re)].map((m) =>
    release(
      decodeEntities(m[3] ?? '').replace(/\s+Checklist( Guide)?$/i, '').trim(),
      m[2] ?? null,
      (m[1] ?? '').slice(0, 10),
      maxConfidence,
      null,
    ),
  );
  if (items.length === 0) throw new Error('checklistinsider: no release items found (markup changed?)');
  return { items, followUps: [] };
}

/** Pokémon press site (NA): schedule table, newest first. */
export function parsePressPokemonNa(body: string, maxConfidence: Confidence, baseUrl: string): ParseResult {
  const re = /<a class="prod-name" href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<td class="td-date">([\s\S]*?)<\/td>/g;
  const items = [...body.matchAll(re)].map((m) =>
    release(textOf(m[2] ?? ''), new URL(m[1] ?? '', baseUrl).toString(), textOf(m[3] ?? ''), maxConfidence, 'pokemon'),
  );
  if (items.length === 0) throw new Error('press-pokemon-na: no schedule rows found (markup changed?)');
  return { items, followUps: [] };
}

/**
 * Pokémon press site (EU) home: news items. TCG headlines name the set in <em>. Each headline
 * becomes a follow-up fetch of its release page, where the release date is stated in prose.
 * Only unseen headlines are followed (the job runner skips units it already has state for).
 */
export function parsePressPokemonEuHome(body: string, sourceId: string, baseUrl: string): ParseResult {
  const re = /<div class="headline"><a href="([^"]+)">([\s\S]*?)<\/a><\/div>/g;
  const followUps: Unit[] = [];
  for (const m of body.matchAll(re)) {
    const headline = textOf(m[2] ?? '');
    if (!/trading card game|\btcg\b/i.test(headline) || /\bpocket\b/i.test(headline)) continue;
    const set = textOf(m[2]?.match(/<em>([\s\S]*?)<\/em>/)?.[1] ?? '');
    const url = new URL(`/en-GB${m[1]}`, baseUrl).toString();
    followUps.push({ sourceId, url, key: `release:${m[1]}`, expected: 'html', context: { headline, set } });
  }
  return { items: [], followUps };
}

/** Pokémon press site (EU) release page: "available … beginning 6 November 2026". */
export function parsePressPokemonEuRelease(body: string, unit: Unit, maxConfidence: Confidence): ParseResult {
  const text = textOf(body);
  const sentence = text.match(/(?:available|launch(?:es|ing)?|released?)[^.]{0,160}?(?:beginning|from|on)\s+(\d{1,2}(?:st|nd|rd|th)? [A-Z][a-z]+ 20\d\d)/);
  const title = unit.context?.set ? `Pokémon TCG: ${unit.context.set}` : (unit.context?.headline ?? 'Pokémon TCG release');
  const items: ReleaseObservation[] = [release(title, unit.url, sentence?.[1] ?? 'TBD', maxConfidence, 'pokemon', 'EU')];
  return { items, followUps: [] };
}

/**
 * Pokémon Center pre-order dates (Zendesk article JSON). A table with rowspans: item list,
 * region availability, estimated ship date. Only UK rows are kept. Ship windows like
 * "Early November 2026" are month-precision and never above "announced".
 */
export function parsePcZendesk(body: string): ParseResult {
  const article = (JSON.parse(body) as { article?: { body?: string } }).article;
  const table = article?.body?.match(/<table[\s\S]*?<\/table>/i)?.[0];
  if (!table) throw new Error('pc-zendesk: article has no table (format changed?)');
  const items: ReleaseObservation[] = [];
  for (const row of tableGrid(table).slice(1)) {
    const [itemsHtml, regionHtml, dateHtml] = row;
    const regions = textOf(regionHtml ?? '');
    if (!/\bUK\b/.test(regions)) continue;
    const names = [...(itemsHtml ?? '').matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1] ?? ''));
    for (const name of names.length ? names : [textOf(itemsHtml ?? '')]) {
      if (!/pok[eé]mon tcg/i.test(name)) continue;
      items.push(release(name, null, textOf(dateHtml ?? ''), 'announced', 'pokemon', 'UK'));
    }
  }
  return { items, followUps: [] };
}

/** Serebii English set list: set name and release date per row. */
export function parseSerebii(body: string, maxConfidence: Confidence, baseUrl: string): ParseResult {
  const re = /<td class="cen"><a href="([^"]+)"><u>([^<]+)<\/u><\/a><\/td>\s*<td class="cen">[^<]*<\/td>\s*<td class="cen"><a[^>]*>([^<]+)<\/a><\/td>/g;
  const items = [...body.matchAll(re)].map((m) =>
    release(`Pokémon TCG: ${decodeEntities(m[2] ?? '').trim()}`, new URL(m[1] ?? '', baseUrl).toString(), m[3] ?? '', maxConfidence, 'pokemon'),
  );
  if (items.length === 0) throw new Error('serebii: no set rows found (markup changed?)');
  return { items, followUps: [] };
}

/** ECB euro reference rates. */
export function parseEcbFx(body: string): ParseResult {
  const date = body.match(/<Cube time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
  if (!date) throw new Error('ecb-fx: no reference date');
  const rates: Record<string, number> = { EUR: 1 };
  for (const m of body.matchAll(/<Cube currency=['"]([A-Z]{3})['"] rate=['"]([\d.]+)['"]/g)) {
    rates[m[1] ?? ''] = Number(m[2]);
  }
  if (!rates.GBP || !rates.USD) throw new Error('ecb-fx: GBP or USD missing');
  return { items: [{ kind: 'fx', date, rates }], followUps: [] };
}
