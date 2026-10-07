import type { Retailer, Source } from '../../shared/config/schema.ts';
import {
  parseChecklistInsider,
  parseCollectosk,
  parseEcbFx,
  parsePcZendesk,
  parsePressPokemonEuHome,
  parsePressPokemonEuRelease,
  parsePressPokemonNa,
  parseSerebii,
} from './calendars.ts';
import { PAGE_SIZE, parseShopify, parseWooCommerce, shopifyUnit, wooUnit } from './shops.ts';
import type { ParseResult, Unit } from './types.ts';

/** What a calendar adapter expects back, so the fetcher can spot a challenge page. */
const EXPECTED: Record<string, Unit['expected']> = {
  collectosk: 'json',
  checklistinsider: 'html',
  'press-pokemon-na': 'html',
  'press-pokemon-eu': 'html',
  'pc-zendesk': 'json',
  serebii: 'html',
  'ecb-fx': 'xml',
};

/**
 * The WordPress REST read of a collectosk product post, from the post URL the calendar links.
 * Only collectosk.com post URLs qualify; the release id rides along in the unit context.
 */
export function collectoskPostUnit(source: Source, postUrl: string, releaseId: string): Unit | null {
  let url: URL;
  try {
    url = new URL(postUrl);
  } catch {
    return null;
  }
  if (url.hostname !== 'www.collectosk.com') return null;
  const slug = url.pathname.split('/').filter(Boolean).pop();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return null;
  const api = new URL('/wp-json/wp/v2/posts', url.origin);
  api.searchParams.set('slug', slug);
  api.searchParams.set('_fields', 'id,slug,modified_gmt,content');
  return { sourceId: source.id, url: api.toString(), key: `post:${slug}`, expected: 'json', context: { releaseId } };
}

export function calendarRootUnit(source: Source): Unit {
  const expected = EXPECTED[source.adapter];
  if (!expected) throw new Error(`No adapter registered for ${source.adapter}`);
  return { sourceId: source.id, url: source.urls[0] ?? '', key: 'root', expected };
}

export function retailerRootUnits(r: Retailer): Unit[] {
  if (r.platform === 'shopify') return r.paths.map((p) => shopifyUnit(r, p));
  if (r.platform === 'woocommerce') return r.paths.map((p) => wooUnit(r, p));
  return []; // magento-panini: adapter not built yet (disabled in config)
}

/** Shopify's public shop metadata: its ship-to country list, a hint (not proof) of GI/ES shipping. */
export function retailerMetaUnit(r: Retailer): Unit | null {
  if (r.platform !== 'shopify') return null;
  return { sourceId: r.id, url: new URL('/meta.json', r.base_url).toString(), key: 'meta', expected: 'json' };
}

/** Reads ships_to_countries into GI/ES membership. */
export function parseShipsTo(body: string): { gi: boolean; es: boolean } {
  const json = JSON.parse(body) as { ships_to_countries?: unknown };
  if (!Array.isArray(json.ships_to_countries)) throw new Error('meta.json has no ships_to_countries');
  const list = json.ships_to_countries as string[];
  return { gi: list.includes('GI'), es: list.includes('ES') };
}

/** A single product, polled often when its release is close. Derived from the stored listing URL. */
export function retailerListingUnit(r: Retailer, listingUrl: string, externalId: string): Unit | null {
  if (r.platform === 'shopify') {
    const handle = new URL(listingUrl).pathname.match(/\/products\/([^/?#]+)/)?.[1];
    if (!handle) return null;
    const url = new URL(`/products/${handle}.json`, r.base_url).toString();
    return { sourceId: r.id, url, key: `listing:/products/${handle}`, expected: 'json' };
  }
  if (r.platform === 'woocommerce') {
    const url = new URL(`/wp-json/wc/store/v1/products/${externalId}`, r.base_url).toString();
    return { sourceId: r.id, url, key: `listing:${externalId}`, expected: 'json' };
  }
  return null;
}

export function parseCalendar(source: Source, unit: Unit, body: string): ParseResult {
  const base = new URL(source.urls[0] ?? unit.url).origin;
  switch (source.adapter) {
    case 'collectosk':
      return parseCollectosk(body, source.max_confidence);
    case 'checklistinsider':
      return parseChecklistInsider(body, source.max_confidence);
    case 'press-pokemon-na':
      return parsePressPokemonNa(body, source.max_confidence, base);
    case 'press-pokemon-eu':
      return unit.key === 'root' ? parsePressPokemonEuHome(body, source.id, base) : parsePressPokemonEuRelease(body, unit, source.max_confidence);
    case 'pc-zendesk':
      return parsePcZendesk(body);
    case 'serebii':
      return parseSerebii(body, source.max_confidence, base);
    case 'ecb-fx':
      return parseEcbFx(body);
    default:
      throw new Error(`No parser for adapter ${source.adapter}`);
  }
}

export function parseRetailer(r: Retailer, unit: Unit, body: string): ParseResult {
  if (unit.key.startsWith('listing:')) {
    // Single-product endpoints: wrap them in the list shape, never page on.
    const json = JSON.parse(body) as Record<string, unknown>;
    const wrapped = r.platform === 'shopify' ? JSON.stringify({ products: json.product ? [json.product] : [] }) : JSON.stringify([json]);
    if (r.platform === 'shopify' && !json.product) throw new Error(`${r.id}: single product response has no product`);
    const res = r.platform === 'shopify' ? parseShopify(wrapped, unit, r) : parseWooCommerce(wrapped, unit, r);
    return { items: res.items, followUps: [] };
  }
  if (r.platform === 'shopify') return parseShopify(body, unit, r);
  if (r.platform === 'woocommerce') return parseWooCommerce(body, unit, r);
  throw new Error(`${r.id}: platform ${r.platform} has no parser`);
}

/** The next page of a paged unit, used when a page answered 304 but was full last time. */
export function nextPageUnit(unit: Unit): Unit {
  const url = new URL(unit.url);
  const page = Number(url.searchParams.get('page') ?? '1') + 1;
  url.searchParams.set('page', String(page));
  return { ...unit, url: url.toString(), key: `${url.pathname}?page=${page}` };
}

export { PAGE_SIZE };
