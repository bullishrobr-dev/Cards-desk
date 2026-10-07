/**
 * Daily Cardmarket import, run by .github/workflows/cardmarket.yml (or by hand):
 *   CARD_DESK_PUBLIC_URL=https://card-desk-public.<sub>.workers.dev CARD_DESK_INGEST_TOKEN=… \
 *     node --experimental-strip-types tools/cardmarket-import.ts
 *
 * The price file is ~16 MB: parsing it inside a Free-plan Worker would blow the 10 ms CPU limit,
 * so this job downloads it, keeps the sealed boxes (a few hundred rows) and posts them to the
 * public Worker in batches of 50. With DRY_RUN=1 it only prints what it would send.
 */
import {
  CARDMARKET_PRICES,
  CARDMARKET_PRODUCTS,
  MARKET_BATCH_SIZE,
  selectSealed,
  type CardmarketPrice,
  type CardmarketProduct,
  type MarketBatch,
} from '../src/shared/cardmarket.ts';

const UA = 'CardDeskDrops/0.1 (personal release tracker)';
const YEARS_BACK = 3;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

const { CARD_DESK_PUBLIC_URL: base, CARD_DESK_INGEST_TOKEN: token, DRY_RUN } = process.env;
if (!DRY_RUN && (!base || !token)) {
  console.log('CARD_DESK_PUBLIC_URL / CARD_DESK_INGEST_TOKEN are not set yet (see docs/deploy.md). Nothing to do.');
  process.exit(0);
}

const [products, prices] = await Promise.all([
  getJson<{ products: CardmarketProduct[] }>(CARDMARKET_PRODUCTS),
  getJson<{ createdAt: string; priceGuides: CardmarketPrice[] }>(CARDMARKET_PRICES),
]);
const since = new Date(Date.now() - YEARS_BACK * 365 * 86400_000).toISOString().slice(0, 10);
const rows = selectSealed(products.products, prices.priceGuides, since);
const asOf = new Date(prices.createdAt).toISOString();
console.log(`Cardmarket price file ${asOf}: ${rows.length} sealed boxes since ${since}.`);

let failed = 0;
for (let i = 0; i < rows.length; i += MARKET_BATCH_SIZE) {
  const batch: MarketBatch = { source: 'cardmarket', asOf, rows: rows.slice(i, i + MARKET_BATCH_SIZE) };
  if (DRY_RUN) {
    console.log(JSON.stringify(batch.rows.slice(0, 3)));
    continue;
  }
  const res = await fetch(`${base?.replace(/\/$/, '')}/ingest/market/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify(batch),
  });
  const text = await res.text();
  console.log(`batch ${i / MARKET_BATCH_SIZE + 1}: HTTP ${res.status} ${text.slice(0, 200)}`);
  if (!res.ok) failed += 1;
}
if (failed) {
  console.error(`${failed} batch(es) failed.`);
  process.exit(1);
}
