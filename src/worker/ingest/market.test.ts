import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { rules, sources } from '../../shared/config/index.ts';
import { MARKET_BATCH_SIZE, selectSealed, type MarketBatch } from '../../shared/cardmarket.ts';
import { createClassifier } from '../normalise/classify.ts';
import { createTestD1 } from '../testing/sqlite-d1.ts';
import { parsePressPokemonNa } from '../adapters/calendars.ts';
import type { ReleaseObservation } from '../adapters/types.ts';
import { ingestReleases } from './ingest.ts';
import { syncRetailers } from './retailers.ts';
import { checkMarketFreshness, ingestMarketPrices, parseMarketBatch } from './market.ts';
import { handlePublic } from '../../public-worker/index.ts';

const products = JSON.parse(readFileSync('fixtures/cardmarket/products_nonsingles_6.subset.json', 'utf8'));
const prices = JSON.parse(readFileSync('fixtures/cardmarket/price_guide_6.subset.json', 'utf8'));
const rows = selectSealed(products.products, prices.priceGuides, '2023-10-01');
const classifier = createClassifier(rules);
let db: D1Database;
const deps = (iso = '2026-10-07T03:30:00Z') => ({ db, classifier, rules, now: new Date(iso) });
const batch = (r = rows.slice(0, MARKET_BATCH_SIZE), asOf = '2026-10-07T00:49:47.000Z'): MarketBatch => ({ source: 'cardmarket', asOf, rows: r });

beforeEach(async () => {
  db = createTestD1();
  await syncRetailers(db, sources);
  await ingestReleases(
    deps('2026-10-05T08:00:00Z'),
    { id: 'press-pokemon-na', categories: ['pokemon'], precedence: 1 },
    parsePressPokemonNa(readFileSync('fixtures/press-pokemon-na/response.html', 'utf8'), 'confirmed_date', 'https://press.pokemon.com').items as ReleaseObservation[],
  );
});

describe('Cardmarket selection (import job)', () => {
  it('keeps single sealed boxes with a price; drops cases, half boxes, Asian editions and jumbo boxes', () => {
    const names = rows.map((r) => r.name);
    expect(names).toContain('Surging Sparks Booster Box');
    expect(names).toContain('Prismatic Evolutions Elite Trainer Box');
    expect(names).toContain('Prismatic Evolutions Pokémon Center Elite Trainer Box');
    expect(names).toContain('Destined Rivals Booster Bundle');
    for (const bad of [/Case/, /\(18 Boosters\)/, /Display/, /^151C:/, /Jumbo/, /Sleeved/, /Indonesian/, /\bJP\b/, /Deluxe/, /Enhanced/]) expect(names.some((n) => bad.test(n))).toBe(false);
    const ss = rows.find((r) => r.name === 'Surging Sparks Booster Box');
    expect(ss?.trendMinor).toBeGreaterThan(10000);
    expect(Number.isInteger(ss?.lowMinor)).toBe(true);
  });
});

describe('Cardmarket ingest (Worker)', () => {
  it('matches boxes to releases and box types, keeps history, and records the run', async () => {
    const all = rows.slice(0, MARKET_BATCH_SIZE);
    const stats = await ingestMarketPrices(deps(), batch(all));
    expect(stats.received).toBe(all.length);
    expect(stats.matched).toBeGreaterThan(5);
    const q = async (name: string) =>
      db.prepare(`SELECT r.name AS release, m.configuration, m.currency FROM market_prices m JOIN releases r ON r.id = m.release_id WHERE m.name = ?`).bind(name).first<{ release: string; configuration: string; currency: string }>();
    expect(await q('Surging Sparks Booster Box')).toMatchObject({ release: expect.stringMatching(/Surging Sparks/), configuration: 'booster_box', currency: 'EUR' });
    expect(await q('Prismatic Evolutions Elite Trainer Box')).toMatchObject({ release: expect.stringMatching(/Prismatic Evolutions/), configuration: 'etb' });
    expect(await q('Prismatic Evolutions Pokémon Center Elite Trainer Box')).toMatchObject({ configuration: 'pc_etb' });
    // Box types Cardmarket sells become products, with the rules.yaml RRP where one exists.
    expect(stats.productsCreated).toBeGreaterThan(5);
    const ss = await db.prepare(`SELECT p.rrp_minor, p.rrp_source FROM products p JOIN releases r ON r.id = p.release_id WHERE r.name LIKE '%Surging Sparks%' AND p.configuration = 'booster_box'`).first();
    expect(ss).toEqual({ rrp_minor: 15444, rrp_source: 'config' });
    expect(await db.prepare(`SELECT COUNT(*) AS n FROM market_price_history`).first<number>('n')).toBe(all.length);
    const state = await db.prepare(`SELECT last_success_at, last_item_count FROM source_state WHERE source_id = 'cardmarket'`).first<{ last_success_at: string; last_item_count: number }>();
    expect(state).toEqual({ last_success_at: '2026-10-07T03:30:00.000Z', last_item_count: stats.matched });
  });

  it('a second batch of the same file adds to the count; the next day keeps one history row per day', async () => {
    const a = await ingestMarketPrices(deps(), batch(rows.slice(0, 20)));
    const b = await ingestMarketPrices(deps(), batch(rows.slice(20, 40)));
    expect(await db.prepare(`SELECT last_item_count FROM source_state WHERE source_id = 'cardmarket'`).first<number>('last_item_count')).toBe(a.matched + b.matched);
    await ingestMarketPrices(deps('2026-10-08T03:30:00Z'), batch(rows.slice(0, 20), '2026-10-08T00:50:00.000Z'));
    await ingestMarketPrices(deps('2026-10-08T04:30:00Z'), batch(rows.slice(0, 20), '2026-10-08T00:50:00.000Z'));
    expect(await db.prepare(`SELECT COUNT(*) AS n FROM market_price_history WHERE external_id = ?`).bind(String(rows[0]?.id)).first<number>('n')).toBe(2);
  });

  it('rejects malformed or oversized batches whole', () => {
    expect(() => parseMarketBatch({ source: 'tcgplayer', asOf: '2026-10-07', rows: [] })).toThrow();
    expect(() => parseMarketBatch(batch([...rows, ...rows]))).toThrow(/at most/);
    expect(() => parseMarketBatch(batch([{ id: 1, name: 'x', lowMinor: -5, trendMinor: null, avgMinor: null }]))).toThrow(/bad row/);
    expect(parseMarketBatch(batch()).rows.length).toBeGreaterThan(0);
  });

  it('a feed that stops arriving fails loudly once, after the stale window', async () => {
    await ingestMarketPrices(deps(), batch(rows.slice(0, 5)));
    await checkMarketFreshness(db, 2, new Date('2026-10-08T12:00:00Z'));
    expect(await db.prepare(`SELECT consecutive_failures FROM source_state WHERE source_id = 'cardmarket'`).first<number>('consecutive_failures')).toBe(0);
    for (const h of ['2026-10-09T06:00:00Z', '2026-10-09T07:00:00Z', '2026-10-09T08:00:00Z']) await checkMarketFreshness(db, 2, new Date(h));
    expect(await db.prepare(`SELECT COUNT(*) AS n FROM events WHERE type = 'source_failing' AND source_id = 'cardmarket'`).first<number>('n')).toBe(1);
    await ingestMarketPrices(deps('2026-10-09T09:00:00Z'), batch(rows.slice(0, 5), '2026-10-09T00:50:00.000Z'));
    expect(await db.prepare(`SELECT consecutive_failures FROM source_state WHERE source_id = 'cardmarket'`).first<number>('consecutive_failures')).toBe(0);
  });
});

describe('public endpoint', () => {
  const TOKEN = 'i'.repeat(43);
  const env = () => ({ DB: db, APP_URL: 'https://app.test', INGEST_TOKEN: TOKEN });
  const post = (path: string, body: string) => handlePublic(new Request(`https://public.test${path}`, { method: 'POST', body }), env(), new Date('2026-10-07T03:30:00Z'));

  it('accepts a batch with the right token only', async () => {
    const ok = await post(`/ingest/market/${TOKEN}`, JSON.stringify(batch(rows.slice(0, 10))));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ received: 10 });
    expect((await post(`/ingest/market/${'x'.repeat(43)}`, JSON.stringify(batch()))).status).toBe(404);
    expect((await post(`/ingest/market/${TOKEN}`, '{"source":"cardmarket"}')).status).toBe(400);
  });
});
