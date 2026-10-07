import type { Retailer } from '../../shared/config/schema.ts';
import { decodeEntities } from '../normalise/text.ts';
import { textOf, toMinor } from './parse-utils.ts';
import type { ListingObservation, ParseResult, Unit } from './types.ts';

export const PAGE_SIZE = 50; // a 250-product Shopify page costs ~9 ms CPU to parse; 50 costs ~1 ms

interface PreorderVerdict {
  isPreorder: boolean;
  releaseText: string | null;
}

/** Applies a shop's pre-order rules. A tag ending in "*" is a prefix ("pre-order*"). */
export function detectPreorder(rules: Retailer['preorder'], title: string, tags: string[], bodyText: string): PreorderVerdict {
  const t = title.trim().toLowerCase();
  const tagHit = rules.tags.some((rule) => {
    const r = rule.toLowerCase();
    return tags.some((tag) => (r.endsWith('*') ? tag.toLowerCase().startsWith(r.slice(0, -1)) : tag.toLowerCase() === r));
  });
  const titleHit =
    rules.title_prefixes.some((p) => t.startsWith(p.toLowerCase())) ||
    rules.title_suffixes.some((s) => t.endsWith(s.toLowerCase())) ||
    rules.title_contains.some((c) => t.includes(c.toLowerCase()));
  let releaseText: string | null = null;
  if (rules.body_date_regex) {
    releaseText = bodyText.match(new RegExp(rules.body_date_regex, 'i'))?.[1] ?? null;
  }
  return { isPreorder: tagHit || titleHit || releaseText !== null, releaseText };
}

const LIMIT_RE = /(?:limit(?:ed)?(?:\s+(?:of|to))?|max(?:imum)?(?:\s+of)?)\s+(\d{1,2})\s+(?:units?\s+|boxes\s+|items\s+)?(?:per|each)\s+(?:customer|household|order|person|account)/i;
const PER_RE = /\b(\d{1,2})\s+per\s+(?:customer|household|person|account)\b/i;
// Only a stated run size for the product counts. "Numbered to 22" describes parallels, which
// every modern release has, and "limited edition" is marketing copy.
const LIMITED_RUN_RE = /\b(?:strictly\s+)?limited\s+to\s+(?:only\s+|just\s+)?\d[\d,.]*\s+(?:cases|boxes|copies|units|sets|tins)\b/i;

/** Scarcity read from a description: purchase limits and limited or numbered runs. */
export function descriptionSignals(bodyText: string): { purchaseLimit: number | null; scarcity: string[] } {
  const m = bodyText.match(LIMIT_RE) ?? bodyText.match(PER_RE);
  const scarcity: string[] = [];
  if (LIMITED_RUN_RE.test(bodyText)) scarcity.push('numbered');
  return { purchaseLimit: m ? Number(m[1]) : null, scarcity };
}

/** Next page of the same path, when this page came back full. */
function nextPage(unit: Unit, count: number): Unit[] {
  if (count < PAGE_SIZE) return [];
  const url = new URL(unit.url);
  const page = Number(url.searchParams.get('page') ?? '1') + 1;
  url.searchParams.set('page', String(page));
  return [{ ...unit, url: url.toString(), key: `${url.pathname}?page=${page}` }];
}

export function shopifyUnit(retailer: Retailer, path: string): Unit {
  const url = new URL(path, retailer.base_url);
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('page', '1');
  return { sourceId: retailer.id, url: url.toString(), key: `${url.pathname}?page=1`, expected: 'json' };
}

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html?: string | null;
  published_at?: string | null;
  vendor?: string | null;
  product_type?: string | null;
  tags?: string[] | string;
  variants: Array<{ id: number; title: string; price: string; available: boolean }>;
}

export function parseShopify(body: string, unit: Unit, retailer: Retailer): ParseResult {
  const json = JSON.parse(body) as { products?: ShopifyProduct[] };
  if (!Array.isArray(json.products)) throw new Error(`${retailer.id}: response has no products array`);
  const items: ListingObservation[] = [];
  for (const p of json.products) {
    const tags = Array.isArray(p.tags) ? p.tags : (p.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    const bodyText = textOf(p.body_html ?? '');
    const pre = detectPreorder(retailer.preorder, p.title, tags, bodyText);
    const signals = descriptionSignals(bodyText);
    for (const v of p.variants) {
      const variantTitle = v.title === 'Default Title' ? null : v.title;
      items.push({
        kind: 'listing',
        externalId: String(v.id),
        productExternalId: String(p.id),
        title: decodeEntities(p.title),
        variantTitle,
        productType: p.product_type || null,
        tags,
        vendor: p.vendor || null,
        url: `${retailer.base_url.replace(/\/$/, '')}/products/${p.handle}${variantTitle ? `?variant=${v.id}` : ''}`,
        priceMinor: toMinor(v.price),
        currency: retailer.currency,
        available: v.available,
        isPreorder: pre.isPreorder,
        releaseText: pre.releaseText,
        publishedAt: p.published_at ?? null,
        ...signals,
      });
    }
  }
  return { items, followUps: nextPage(unit, json.products.length) };
}

export function wooUnit(retailer: Retailer, path: string): Unit {
  const url = new URL(path, retailer.base_url);
  url.searchParams.set('per_page', String(PAGE_SIZE));
  url.searchParams.set('page', '1');
  return { sourceId: retailer.id, url: url.toString(), key: `${url.pathname}?page=1`, expected: 'json' };
}

interface WooProduct {
  id: number;
  name: string;
  permalink: string;
  description?: string;
  prices?: { price?: string; currency_code?: string; currency_minor_unit?: number };
  is_in_stock?: boolean;
  is_purchasable?: boolean;
  categories?: Array<{ name: string }>;
  tags?: Array<{ name: string }>;
}

/** WooCommerce Store API. Variable products are kept as one listing at the parent price. */
export function parseWooCommerce(body: string, unit: Unit, retailer: Retailer): ParseResult {
  const json = JSON.parse(body) as WooProduct[];
  if (!Array.isArray(json)) throw new Error(`${retailer.id}: Store API did not return an array`);
  const items: ListingObservation[] = json.map((p) => {
    const tags = [...(p.categories ?? []), ...(p.tags ?? [])].map((t) => decodeEntities(t.name));
    const title = decodeEntities(p.name);
    const minorUnit = p.prices?.currency_minor_unit ?? 2;
    const raw = p.prices?.price ? Number(p.prices.price) : null;
    const body = textOf(p.description ?? '');
    const pre = detectPreorder(retailer.preorder, title, tags, body);
    return {
      kind: 'listing',
      externalId: String(p.id),
      productExternalId: String(p.id),
      title,
      variantTitle: null,
      productType: null,
      tags,
      vendor: null,
      url: p.permalink,
      priceMinor: raw === null || !Number.isFinite(raw) ? null : Math.round(raw * 10 ** (2 - minorUnit)),
      currency: p.prices?.currency_code ?? retailer.currency,
      available: Boolean(p.is_in_stock && p.is_purchasable !== false),
      isPreorder: pre.isPreorder,
      releaseText: pre.releaseText,
      publishedAt: null,
      ...descriptionSignals(body),
    };
  });
  return { items, followUps: nextPage(unit, json.length) };
}
