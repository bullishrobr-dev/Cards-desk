/**
 * Cardmarket's public daily data files for Pokémon (game 6), verified 7 Oct 2026:
 * - productCatalog/productList/products_nonsingles_6.json (~1 MB): { createdAt, products: [{ idProduct, name, categoryName, dateAdded, … }] }
 * - productCatalog/priceGuide/price_guide_6.json (~16 MB): { createdAt, priceGuides: [{ idProduct, avg, low, trend, … }] }, EUR.
 * Cardmarket: "Anyone can import and incorporate the data into their own applications, no extra
 * permission or access point necessary" (insight.cardmarket.com, What's new 7/2025).
 *
 * `avg` and `trend` come from sales; `low` is the cheapest listing. Prices cover every language
 * edition of a product (UNVERIFIED for sealed: Cardmarket does not say), so they are shown as an
 * EU market indication, not as the English-only price.
 */

export const CARDMARKET_BASE = 'https://downloads.s3.cardmarket.com/productCatalog';
export const CARDMARKET_PRODUCTS = `${CARDMARKET_BASE}/productList/products_nonsingles_6.json`;
export const CARDMARKET_PRICES = `${CARDMARKET_BASE}/priceGuide/price_guide_6.json`;

export interface CardmarketProduct {
  idProduct: number;
  name: string;
  categoryName: string;
  dateAdded: string;
}

export interface CardmarketPrice {
  idProduct: number;
  avg: number | null;
  low: number | null;
  trend: number | null;
}

/** What the import job posts to the Worker: one sealed box, prices in EUR minor units. */
export interface MarketRow {
  id: number;
  name: string;
  lowMinor: number | null;
  trendMinor: number | null;
  avgMinor: number | null;
}

export interface MarketBatch {
  source: 'cardmarket';
  /** The price file's createdAt (ISO). */
  asOf: string;
  rows: MarketRow[];
}

/** Single sealed boxes only: no cases, half boxes, displays of bundles or sleeved-booster cases. */
const CATEGORIES = new Set(['Pokémon Display', 'Pokémon Elite Trainer Boxes']);
const BOX = /\b(Booster Box|Elite Trainer Box|Booster Bundle)$/;
const NOT_A_SINGLE_BOX = /\bCase\b|\bDisplay\b|\(\d+ (Boosters|Packs)\)|\bHalf\b|\bSleeved\b/i;
/** Chinese and other Asian editions carry a set code: "151C: Collect 151 Hope Booster Box", "CSV3C: …". */
const ASIAN_SET_CODE = /^[A-Z0-9.]*\d[A-Z0-9.]*[A-Z]?:\s/;
const JUMBO = /\bJumbo\b/i;
/** Regional editions named in the product: "30th Celebration Indonesian & Thai Booster Box", "Black Bolt JP Deluxe …". */
const REGIONAL = /\b(JP|ID\/TH|Indonesian|Thai|Korean|Chinese|Simplified|Traditional|Deluxe|Enhanced)\b/i;

const minor = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null);

/** Picks the sealed boxes added since `since` (YYYY-MM-DD) and joins their prices. */
export function selectSealed(products: CardmarketProduct[], prices: CardmarketPrice[], since: string): MarketRow[] {
  const byId = new Map(prices.map((p) => [p.idProduct, p]));
  const out: MarketRow[] = [];
  for (const p of products) {
    if (!CATEGORIES.has(p.categoryName) || p.dateAdded.slice(0, 10) < since) continue;
    if (!BOX.test(p.name) || NOT_A_SINGLE_BOX.test(p.name) || ASIAN_SET_CODE.test(p.name) || JUMBO.test(p.name) || REGIONAL.test(p.name)) continue;
    const price = byId.get(p.idProduct);
    if (!price) continue;
    const row = { id: p.idProduct, name: p.name, lowMinor: minor(price.low), trendMinor: minor(price.trend), avgMinor: minor(price.avg) };
    if (row.lowMinor === null && row.trendMinor === null && row.avgMinor === null) continue;
    out.push(row);
  }
  return out;
}

/** The Worker takes at most this many rows per request (Free plan: 10 ms CPU, 50 subrequests). */
export const MARKET_BATCH_SIZE = 50;
