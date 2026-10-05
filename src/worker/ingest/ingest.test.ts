import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { rules, sources } from '../../shared/config/index.ts';
import { createClassifier } from '../normalise/classify.ts';
import { createTestD1 } from '../testing/sqlite-d1.ts';
import { parseChecklistInsider, parseCollectosk, parseEcbFx, parsePcZendesk, parsePressPokemonNa, parseSerebii } from '../adapters/calendars.ts';
import { parseShopify, shopifyUnit } from '../adapters/shops.ts';
import type { ListingObservation, ReleaseObservation } from '../adapters/types.ts';
import { ingestListings, ingestReleases, type IngestDeps } from './ingest.ts';
import { syncRetailers } from './retailers.ts';

const fx = (p: string) => readFileSync(`fixtures/${p}`, 'utf8');
const classifier = createClassifier(rules);
const retailer = (id: string) => sources.retailers.find((r) => r.id === id) ?? (() => { throw new Error(id); })();
const src = (id: string) => {
  const s = sources.sources.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return { id: s.id, categories: s.categories, precedence: s.precedence };
};

/** Wraps D1 to count calls: on the Free plan each one is a subrequest. */
function counting(db: D1Database) {
  let calls = 0;
  let inBatch = false;
  const wrapped = {
    prepare: (sql: string) => {
      const stmt = db.prepare(sql);
      const wrap = (s: D1PreparedStatement): D1PreparedStatement =>
        new Proxy(s, {
          get(target, prop, recv) {
            if (prop === 'bind') return (...args: unknown[]) => wrap(target.bind(...args));
            if (!inBatch && (prop === 'first' || prop === 'all' || prop === 'run' || prop === 'raw')) calls += 1;
            const v = Reflect.get(target, prop, recv);
            return typeof v === 'function' ? v.bind(target) : v;
          },
        });
      return wrap(stmt);
    },
    batch: async (stmts: D1PreparedStatement[]) => {
      calls += 1; // one round trip, however many statements
      inBatch = true;
      try {
        return await db.batch(stmts);
      } finally {
        inBatch = false;
      }
    },
  } as unknown as D1Database;
  return { db: wrapped, calls: () => calls, reset: () => (calls = 0) };
}

let db: D1Database;
let deps: IngestDeps;
const at = (iso: string): IngestDeps => ({ ...deps, now: new Date(iso) });
const q = async <T,>(sql: string, ...args: unknown[]) => (await db.prepare(sql).bind(...args).all<T>()).results;

beforeEach(async () => {
  db = createTestD1();
  deps = { db, classifier, rules, now: new Date('2026-10-05T08:00:00Z') };
  await syncRetailers(db, sources);
});

async function loadSportsCalendars() {
  await ingestReleases(deps, src('collectosk'), parseCollectosk(fx('collectosk/response.json'), 'confirmed_date').items as ReleaseObservation[]);
  await ingestReleases(deps, src('checklistinsider'), parseChecklistInsider(fx('checklistinsider/response.html'), 'confirmed_date').items as ReleaseObservation[]);
}

describe('sports: calendars then shops', () => {
  it('creates in-scope releases only, with confirmed dates', async () => {
    await loadSportsCalendars();
    const rows = await q<{ name: string; category: string; starts_at: string | null; confidence: string }>(
      `SELECT r.name, r.category, d.starts_at, d.confidence FROM releases r JOIN drops d ON d.release_id = r.id ORDER BY r.name`,
    );
    expect(rows.every((r) => r.category === 'football' || r.category === 'f1')).toBe(true);
    expect(rows.some((r) => /baseball|basketball|disney|tennis/i.test(r.name))).toBe(false);
    const f1 = rows.filter((r) => /chrome formula 1/i.test(r.name));
    expect(f1).toHaveLength(1); // collectosk and Checklist Insider agree on one release
    // "World Cup 26" (collectosk) and "World Cup 2026 … Guide" (Checklist Insider) are one release.
    expect(rows.filter((r) => /national treasures road to fifa/i.test(r.name))).toHaveLength(1);
    expect(f1[0]).toMatchObject({ starts_at: '2026-10-15', confidence: 'confirmed_date' });
  });

  it('links Chrome F1 hobby, mega and value boxes to the calendar release', async () => {
    await loadSportsCalendars();
    const scd = retailer('sportscardsdirect');
    const items = parseShopify(fx('sportscardsdirect/products-0-page1.json'), shopifyUnit(scd, '/products.json'), scd).items as ListingObservation[];
    const stats = await ingestListings(deps, scd, items);
    expect(stats.excluded['Match Attax / Turbo Attax']).toBeGreaterThan(0);
    const linked = await q<{ configuration: string; price_minor: number; release: string }>(
      `SELECT p.configuration, l.price_minor, r.name AS release FROM listings l JOIN products p ON p.id = l.product_id
       JOIN releases r ON r.id = p.release_id WHERE r.name LIKE '%Chrome Formula 1%' ORDER BY p.configuration`,
    );
    expect(linked.map((l) => l.configuration)).toEqual(['hobby', 'mega', 'retail']);
    expect(linked.find((l) => l.configuration === 'hobby')?.price_minor).toBe(84000);
    // Market signals start on first sight.
    expect((await q('SELECT * FROM stock_events')).length).toBeGreaterThan(0);
    expect((await q('SELECT * FROM price_events')).length).toBeGreaterThan(0);
  });

  it('stays within the Free plan subrequest budget for a 50-product page', async () => {
    await loadSportsCalendars();
    const c = counting(db);
    const scd = retailer('sportscardsdirect');
    const items = parseShopify(fx('sportscardsdirect/products-0-page1.json'), shopifyUnit(scd, '/products.json'), scd).items as ListingObservation[];
    await ingestListings({ ...deps, db: c.db }, scd, items);
    expect(c.calls()).toBeLessThanOrEqual(12);
  });
});

describe('change capture', () => {
  async function seed() {
    await loadSportsCalendars();
    const scd = retailer('sportscardsdirect');
    const items = parseShopify(fx('sportscardsdirect/products-0-page1.json'), shopifyUnit(scd, '/products.json'), scd).items as ListingObservation[];
    await ingestListings(deps, scd, items);
    return { scd, items };
  }

  it('writes nothing new when nothing changed', async () => {
    const { scd, items } = await seed();
    const before = (await q('SELECT * FROM price_events')).length;
    const stats = await ingestListings(at('2026-10-05T14:00:00Z'), scd, items);
    expect(stats.changed).toBe(0);
    expect((await q('SELECT * FROM price_events')).length).toBe(before);
  });

  it('records a price change and a restock event', async () => {
    const { scd, items } = await seed();
    const hobby = items.find((i) => i.title === 'Topps Chrome Formula 1 2026 Hobby Box - Pre-Order');
    if (!hobby) throw new Error('fixture changed');
    await ingestListings(at('2026-10-06T08:00:00Z'), scd, [{ ...hobby, priceMinor: 79999, available: true }]);
    const prices = await q<{ price_minor: number }>(`SELECT price_minor FROM price_events WHERE listing_id = ? ORDER BY id`, `sportscardsdirect:${hobby.externalId}`);
    expect(prices.map((p) => p.price_minor)).toEqual([84000, 79999]);
    const restock = await q<{ type: string }>(`SELECT type FROM events WHERE type = 'restock'`);
    expect(restock).toHaveLength(1);
  });

  it('never silently overwrites a date: history and a date_changed event', async () => {
    await loadSportsCalendars();
    const items = parseCollectosk(fx('collectosk/response.json'), 'confirmed_date').items as ReleaseObservation[];
    const moved = items.map((i) => (i.title.includes('TOPPS Chrome Formula 1') ? { ...i, date: '2026-10-22', rawDate: '2026-10-22' } : i));
    await ingestReleases(at('2026-10-06T08:00:00Z'), src('collectosk'), moved);
    const drop = await q<{ starts_at: string; id: string }>(
      `SELECT d.id, d.starts_at FROM drops d JOIN releases r ON r.id = d.release_id WHERE r.name LIKE '%Chrome Formula 1%'`,
    );
    expect(drop[0]?.starts_at).toBe('2026-10-22');
    const history = await q<{ old_starts_at: string | null; new_starts_at: string }>(`SELECT old_starts_at, new_starts_at FROM drop_date_history WHERE drop_id = ? ORDER BY id`, drop[0]?.id);
    expect(history.map((h) => [h.old_starts_at, h.new_starts_at])).toEqual([[null, '2026-10-15'], ['2026-10-15', '2026-10-22']]);
    expect((await q(`SELECT * FROM events WHERE type = 'date_changed'`)).length).toBe(1);
  });
});

describe('Pokémon: official dates win, everything lands on one release', () => {
  it('builds Delta Reign from press, Serebii, Pokémon Center and Zatu', async () => {
    const p = (name: string, body: ReleaseObservation[]) => ingestReleases(deps, src(name), body);
    await ingestReleases(deps, { id: 'ecb-fx', categories: [], precedence: 9 }, []);
    const fxItem = parseEcbFx(fx('ecb-fx/eurofxref-daily.xml')).items[0];
    if (fxItem?.kind === 'fx') {
      await db.batch(Object.entries(fxItem.rates).map(([cur, rate]) => db.prepare('INSERT INTO fx_rates (date, currency, rate) VALUES (?, ?, ?)').bind(fxItem.date, cur, rate)));
    }
    await p('pc-zendesk', parsePcZendesk(fx('pc-zendesk/response.json')).items as ReleaseObservation[]);
    await p('serebii', parseSerebii(fx('serebii/response.html'), 'announced', 'https://www.serebii.net').items as ReleaseObservation[]);
    await p('press-pokemon-na', parsePressPokemonNa(fx('press-pokemon-na/response.html'), 'confirmed_date', 'https://press.pokemon.com').items as ReleaseObservation[]);

    const zatu = retailer('zatu');
    const items = parseShopify(fx('zatu/products-0-page1.json'), shopifyUnit(zatu, zatu.paths[0] ?? ''), zatu).items as ListingObservation[];
    await ingestListings(deps, zatu, items);

    const delta = await q<{ id: string; name: string; starts_at: string; confidence: string; decided_by_source: string }>(
      `SELECT r.id, r.name, d.starts_at, d.confidence, d.decided_by_source FROM releases r JOIN drops d ON d.release_id = r.id WHERE r.subject LIKE '%delta%reign%'`,
    );
    expect(delta).toHaveLength(1);
    expect(delta[0]?.name).toBe('Pokémon TCG: Mega Evolution—Delta Reign');
    expect(delta[0]).toMatchObject({ starts_at: '2026-11-06', confidence: 'confirmed_date', decided_by_source: 'press-pokemon-na' });

    const obs = await q<{ source_id: string }>(`SELECT o.source_id FROM drop_observations o JOIN drops d ON d.id = o.drop_id WHERE d.release_id = ? ORDER BY o.source_id`, delta[0]?.id);
    expect(obs.map((o) => o.source_id)).toEqual(['pc-zendesk', 'press-pokemon-na', 'serebii']);

    const box = await q<{ configuration: string; rrp_minor: number; rrp_source: string }>(`SELECT configuration, rrp_minor, rrp_source FROM products WHERE release_id = ?`, delta[0]?.id);
    expect(box).toContainEqual({ configuration: 'booster_box', rrp_minor: 15444, rrp_source: 'config' });

    // Japanese and Korean boxes never reach the database.
    expect((await q(`SELECT * FROM listings WHERE raw_title LIKE '%JAPANESE%' OR raw_title LIKE '%KOREAN%'`)).length).toBe(0);
    // The price-to-RRP ratio is captured from day one.
    const ratio = await q<{ ratio_to_rrp: number | null }>(
      `SELECT pe.ratio_to_rrp FROM price_events pe JOIN listings l ON l.id = pe.listing_id JOIN products p ON p.id = l.product_id WHERE p.release_id = ?`,
      delta[0]?.id,
    );
    expect(ratio[0]?.ratio_to_rrp).toBeGreaterThan(0);
  });

  it('does not create releases for old stock that matches nothing', async () => {
    const zatu = retailer('zatu');
    const items = parseShopify(fx('zatu/products-0-page1.json'), shopifyUnit(zatu, zatu.paths[0] ?? ''), zatu).items as ListingObservation[];
    const stats = await ingestListings(deps, zatu, items.map((i) => ({ ...i, isPreorder: false, publishedAt: '2020-01-01T00:00:00Z' })));
    expect(stats.createdReleases).toBe(0);
    expect((await q('SELECT * FROM releases')).length).toBe(0);
    // Listings are still recorded for market signals.
    expect((await q('SELECT * FROM listings')).length).toBeGreaterThan(0);
  });
});
