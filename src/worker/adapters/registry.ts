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
