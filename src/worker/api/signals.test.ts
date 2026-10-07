import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { rules, sources } from '../../shared/config/index.ts';
import type { DropDetail, DropSummary, SectorSignals } from '../../shared/api-types.ts';
import { createClassifier } from '../normalise/classify.ts';
import { createTestD1 } from '../testing/sqlite-d1.ts';
import { syncRetailers } from '../ingest/retailers.ts';
import { ingestListings, ingestReleases } from '../ingest/ingest.ts';
import { parseCollectosk, parseEcbFx } from '../adapters/calendars.ts';
import { parseShopify, shopifyUnit } from '../adapters/shops.ts';
import type { ListingObservation, ReleaseObservation } from '../adapters/types.ts';
import { api } from './routes.ts';
import { sectorSignals } from './signals.ts';

let db: D1Database;
const env = () => ({ DB: db, APP_ENV: 'development' }) as unknown as Env;
const get = async <T,>(path: string) => (await (await api.request(path, {}, env())).json()) as T;

/** Sports Cards Direct's page, with the Chrome F1 hobby box edited: price and stock. */
function scdPage(edit?: (p: { title: string; variants: Array<{ price: string; available: boolean }> }) => void) {
  const json = JSON.parse(readFileSync('fixtures/sportscardsdirect/products-0-page1.json', 'utf8')) as { products: Array<{ title: string; variants: Array<{ price: string; available: boolean }> }> };
  const hobby = json.products.find((p) => /Chrome Formula 1 2026 Hobby Box/i.test(p.title));
  if (!hobby) throw new Error('fixture changed');
  if (edit) edit(hobby);
  const scd = sources.retailers.find((r) => r.id === 'sportscardsdirect');
  if (!scd) throw new Error();
  return { scd, items: parseShopify(JSON.stringify(json), shopifyUnit(scd, '/products.json'), scd).items as ListingObservation[] };
}

beforeAll(async () => {
  db = createTestD1();
  const classifier = createClassifier(rules);
  const at = (iso: string) => ({ db, classifier, rules, now: new Date(iso) });
  await syncRetailers(db, sources);
  const fx = parseEcbFx(readFileSync('fixtures/ecb-fx/eurofxref-daily.xml', 'utf8')).items[0];
  if (fx?.kind === 'fx') await db.batch(Object.entries(fx.rates).map(([c, r]) => db.prepare('INSERT INTO fx_rates VALUES (?, ?, ?)').bind(fx.date, c, r)));
  await ingestReleases(at('2026-10-05T08:00:00Z'), { id: 'collectosk', categories: ['football', 'f1'], precedence: 2 }, parseCollectosk(readFileSync('fixtures/collectosk/response.json', 'utf8'), 'confirmed_date').items as ReleaseObservation[]);
  // Day 1: on sale (pre-order) at £840. Day 2: up to £950. Day 3, 06:00: sold out.
  const day1 = scdPage((h) => h.variants.forEach((v) => (v.available = true)));
  await ingestListings(at('2026-10-05T08:00:00Z'), day1.scd, day1.items);
  const day2 = scdPage((h) => h.variants.forEach((v) => ((v.available = true), (v.price = '950.00'))));
  await ingestListings(at('2026-10-06T08:00:00Z'), day2.scd, day2.items);
  const day3 = scdPage((h) => h.variants.forEach((v) => ((v.available = false), (v.price = '950.00'))));
  await ingestListings(at('2026-10-07T06:00:00Z'), day3.scd, day3.items);
  await db.prepare(`UPDATE products SET rrp_minor = 41500, rrp_currency = 'GBP', rrp_source = 'published' WHERE configuration = 'hobby' AND name LIKE '%Formula 1%'`).run();
});

describe('sector signals', () => {
  it('times a sell-out from going on sale, and lists the price move', async () => {
    const s = await sectorSignals(db, rules, new Date('2026-10-07T12:00:00Z'), 30);
    const f1 = s.categories.find((c) => c.category === 'f1');
    expect(f1).toMatchObject({ soldOut: 1, medianHoursToSellOut: 46 });
    expect(s.moves[0]).toMatchObject({ kind: 'sold_out', retailer: 'Sports Cards Direct', detail: 'Sold out after 46 h' });
    expect(s.moves.find((m) => m.kind === 'price_up')).toMatchObject({ detail: expect.stringMatching(/^£840\.00 → £950\.00/) });
    expect(s.moves.every((m) => /Formula 1/.test(m.release))).toBe(true);
  });

  it('places live prices against RRP per category', async () => {
    const s = await get<SectorSignals>('/signals?days=30');
    const f1 = s.categories.find((c) => c.category === 'f1');
    // Asking prices count in stock or not; mega and value boxes have no RRP here.
    expect(f1).toMatchObject({ pricedListings: 1, medianRatio: 2.29, aboveTolerance: 1 });
    expect(s.categories.map((c) => c.category)).toEqual(['football', 'f1', 'pokemon']);
  });

  it('rejects an unsupported window', async () => {
    expect((await api.request('/signals?days=5', {}, env())).status).toBe(400);
  });

  it('drop detail carries each listing’s price and stock history', async () => {
    const f1 = (await get<DropSummary[]>('/drops?category=f1')).find((d) => /Chrome Formula 1/i.test(d.name));
    const d = await get<DropDetail>(`/drops/${f1?.id}`);
    const hobby = d.products.find((p) => p.configuration === 'hobby')?.listings[0];
    expect(hobby?.history.map((h) => [h.at.slice(0, 10), h.priceMinor, h.available])).toEqual([
      ['2026-10-05', 84000, true],
      ['2026-10-06', 95000, null],
      ['2026-10-07', null, false],
    ]);
  });
});
