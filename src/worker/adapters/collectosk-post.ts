import { decodeEntities } from '../normalise/text.ts';
import { textOf } from './parse-utils.ts';

/**
 * A collectosk product post (WordPress REST, /wp/v2/posts?slug=…): the formats with their
 * published RRP, and the checklist. Used to enrich a release found on the calendar.
 *
 * Markup (verified 7 Oct 2026): each format is a `div.sac-product-item` with an
 * `h3.sac-product-title` and an optional `p.sac-product-msrp` holding `span.msrp-price` values
 * ("485.00 €", "$469.99", "£415.00"). Checklist cards are `span.sac-card-entry` reading
 * "12 Arvid Lindblad (Racing Bulls)", with an `img.sac-card-badge-icon` whose alt is " RC" for a
 * rookie card or " 1st" for a first card (which legends get too, so it is not a rookie marker).
 */
export interface PostFormat {
  title: string;
  /** Minor units by currency, as published. */
  rrp: Partial<Record<'GBP' | 'EUR' | 'USD', number>>;
}

export interface PostEnrichment {
  kind: 'enrichment';
  modifiedAt: string | null;
  formats: PostFormat[];
  /** Distinct names on the checklist, in order. */
  names: string[];
  /** Distinct names with a rookie-card (RC) badge. */
  rookies: string[];
  /** Checklist entries, including parallels of the same card number. */
  cardCount: number;
}

const CURRENCY: Array<[RegExp, 'GBP' | 'EUR' | 'USD']> = [
  [/£/, 'GBP'],
  [/€/, 'EUR'],
  [/\$/, 'USD'],
];

function priceMinor(text: string): { currency: 'GBP' | 'EUR' | 'USD'; minor: number } | null {
  const cur = CURRENCY.find(([re]) => re.test(text))?.[1];
  const num = text.replace(/[^\d.,]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
  const value = Number(num);
  if (!cur || !num || !Number.isFinite(value) || value <= 0) return null;
  return { currency: cur, minor: Math.round(value * 100) };
}

export function parseCollectoskPost(body: string): PostEnrichment {
  const json = JSON.parse(body) as Array<{ modified_gmt?: string; content?: { rendered?: string } }> | { code?: string };
  if (!Array.isArray(json)) throw new Error(`collectosk post: unexpected response (${(json as { code?: string }).code ?? 'not an array'})`);
  const post = json[0];
  if (!post) throw new Error('collectosk post: no post with this slug (renamed or removed?)');
  const html = post.content?.rendered;
  if (!html) throw new Error('collectosk post: no content.rendered');

  const formats: PostFormat[] = [];
  for (const block of html.split('class="sac-product-item"').slice(1)) {
    const title = block.match(/class="sac-product-title">([\s\S]*?)<\/h3>/)?.[1];
    if (!title) continue;
    const rrp: PostFormat['rrp'] = {};
    const msrp = block.match(/class="sac-product-msrp">([\s\S]*?)<\/p>/)?.[1] ?? '';
    for (const m of msrp.matchAll(/class="msrp-price">([^<]*)</g)) {
      const p = priceMinor(decodeEntities(m[1] ?? ''));
      if (p && rrp[p.currency] === undefined) rrp[p.currency] = p.minor;
    }
    formats.push({ title: textOf(title), rrp });
  }

  const names: string[] = [];
  const rookies: string[] = [];
  const seen = new Set<string>();
  const seenRookie = new Set<string>();
  let cardCount = 0;
  for (const m of html.matchAll(/<span class="sac-card-entry"[^>]*>([\s\S]*?)<\/span>/g)) {
    const inner = m[1] ?? '';
    cardCount += 1;
    // "12 Arvid Lindblad (Racing Bulls) - Dutch GP 2025" → "Arvid Lindblad"; duos read "A / B".
    const text = textOf(inner).replace(/^\s*[\w-]+\s+/, '').replace(/\s*\(.*$/s, '').trim();
    if (!text || /^TBD$/i.test(text)) continue;
    const isRookie = /class="sac-card-badge-icon"[^>]*alt="\s*RC\s*"/.test(inner);
    for (const name of text.split(/\s+\/\s+/)) {
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
      if (isRookie && !seenRookie.has(name)) {
        seenRookie.add(name);
        rookies.push(name);
      }
    }
  }
  return { kind: 'enrichment', modifiedAt: post.modified_gmt ?? null, formats, names, rookies, cardCount };
}
