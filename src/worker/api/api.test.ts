import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { rules, sources } from '../../shared/config/index.ts';
import type { DropDetail, DropSummary, SourceHealth } from '../../shared/api-types.ts';
import { createClassifier } from '../normalise/classify.ts';
import { createTestD1 } from '../testing/sqlite-d1.ts';
import { syncRetailers } from '../ingest/retailers.ts';
import { ingestListings, ingestReleases } from '../ingest/ingest.ts';
import { parseCollectosk, parseEcbFx } from '../adapters/calendars.ts';
import { parseShopify, shopifyUnit } from '../adapters/shops.ts';
import type { ListingObservation, ReleaseObservation } from '../adapters/types.ts';
import { api } from './routes.ts';

let db: D1Database;
const env = () => ({ DB: db, APP_ENV: 'development' }) as unknown as Env;
const get = async <T,>(path: string, e: Env = env()) => {
  const res = await api.request(path, {}, e);
  return { status: res.status, body: (await res.json()) as T };
};
const send = async (method: string, path: string, body?: unknown) => {
  const res = await api.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env());
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const f1Drop = async () => (await get<DropSummary[]>('/drops?category=f1')).body.find((d) => /chrome formula 1/i.test(d.name)) as DropSummary;

beforeAll(async () => {
  db = createTestD1();
  const classifier = createClassifier(rules);
  const deps = { db, classifier, rules, now: new Date('2026-10-05T08:00:00Z') };
  await syncRetailers(db, sources);
  const fx = parseEcbFx(readFileSync('fixtures/ecb-fx/eurofxref-daily.xml', 'utf8')).items[0];
  if (fx?.kind === 'fx') await db.batch(Object.entries(fx.rates).map(([c, r]) => db.prepare('INSERT INTO fx_rates VALUES (?, ?, ?)').bind(fx.date, c, r)));
  await ingestReleases(deps, { id: 'collectosk', categories: ['football', 'f1'], precedence: 2 }, parseCollectosk(readFileSync('fixtures/collectosk/response.json', 'utf8'), 'confirmed_date').items as ReleaseObservation[]);
  const scd = sources.retailers.find((r) => r.id === 'sportscardsdirect');
  if (!scd) throw new Error();
  await ingestListings(deps, scd, parseShopify(readFileSync('fixtures/sportscardsdirect/products-0-page1.json', 'utf8'), shopifyUnit(scd, '/products.json'), scd).items as ListingObservation[]);
});

describe('API', () => {
  it('fails closed in production without Access configured', async () => {
    const res = await api.request('/drops', {}, { DB: db, APP_ENV: 'production' } as unknown as Env);
    expect(res.status).toBe(503);
  });

  it('rejects a request with no Access token when Access is configured', async () => {
    const res = await api.request('/drops', {}, { DB: db, APP_ENV: 'production', ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud' } as unknown as Env);
    expect(res.status).toBe(401);
  });

  it('lists upcoming drops with shops, GI/ES flags, prices in GBP and EUR', async () => {
    const { body } = await get<DropSummary[]>('/drops?view=upcoming');
    const f1 = body.find((d) => /chrome formula 1/i.test(d.name));
    expect(f1).toMatchObject({ startsAt: '2026-10-15', liveAt: '2026-10-14T22:00:00.000Z', confidence: 'confirmed_date', shipsGi: true, shipsEs: true, shopCount: 1 });
    expect(f1?.configurations.sort()).toEqual(['hobby', 'mega', 'retail']);
    // All three boxes are pre-orders (not in stock), so they still count as buyable.
    expect(f1?.bestPrice?.currency).toBe('GBP');
    expect(f1?.bestPrice?.eur).toBeGreaterThan(f1?.bestPrice?.minor ?? 0);
    // Dated first, undated (TBD) last.
    const firstTbd = body.findIndex((d) => d.startsAt === null);
    expect(body.slice(firstTbd).every((d) => d.startsAt === null)).toBe(true);
  });

  it('filters by category', async () => {
    const { body } = await get<DropSummary[]>('/drops?category=f1');
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((d) => d.category === 'f1')).toBe(true);
  });

  it('returns drop detail with observations, history and shop listings', async () => {
    const { body: list } = await get<DropSummary[]>('/drops?category=f1');
    const id = list.find((d) => /chrome formula 1/i.test(d.name))?.id;
    const { status, body } = await get<DropDetail>(`/drops/${id}`);
    expect(status).toBe(200);
    expect(body.observations[0]).toMatchObject({ sourceId: 'collectosk', sourceLabel: 'collectosk release calendar', raw: '2026-10-15' });
    expect(body.history).toHaveLength(1);
    const hobby = body.products.find((p) => p.configuration === 'hobby');
    expect(hobby?.listings[0]).toMatchObject({ retailer: 'Sports Cards Direct', isPreorder: true, shipsGi: { value: 'yes', verifiedAt: '2026-10-02' } });
    expect(body.costNotes.some((n) => n.region === 'gi')).toBe(true);
  });

  it('404s an unknown drop', async () => {
    expect((await get('/drops/nope')).status).toBe(404);
  });

  it('reports source health, including sources that never ran', async () => {
    const { body } = await get<SourceHealth[]>('/sources/health');
    expect(body.find((s) => s.id === 'zatu')).toMatchObject({ kind: 'shop', status: 'never_run' });
  });

  it('scores every drop and explains each point', async () => {
    const f1 = await f1Drop();
    expect(f1.desk.breakdown.map((b) => b.id)).toEqual(['tier', 'configuration', 'scarcity', 'relevance']);
    expect(f1.desk.gates.map((g) => g.id)).toEqual(['scope', 'purchasable', 'price']);
    expect(f1.desk.breakdown.find((b) => b.id === 'tier')?.points).toBe(40);
    expect(f1.desk.breakdown.find((b) => b.id === 'configuration')?.points).toBe(20);
    expect(f1.desk.gates.find((g) => g.id === 'purchasable')?.detail).toBe('At least one shop ships to Gibraltar');
  });

  it('a manual tag adds relevance; an override replaces the number but keeps the raw score', async () => {
    const before = (await f1Drop()).desk.rawScore;
    expect((await send('POST', `/releases/${(await f1Drop()).releaseId}/tags`, { tag: 'Bearman rookie' })).status).toBe(200);
    const tagged = await f1Drop();
    expect(tagged.desk.rawScore).toBe(before + 20);
    expect((await get<DropDetail>(`/drops/${tagged.id}`)).body.tags).toEqual(['Bearman rookie']);

    expect((await send('PUT', `/releases/${tagged.releaseId}/override`, { score: 101 })).status).toBe(400);
    await send('PUT', `/releases/${tagged.releaseId}/override`, { score: 30, note: 'Too dear this year' });
    const overridden = await f1Drop();
    expect(overridden.desk).toMatchObject({ score: 30, rawScore: before + 20, label: 'Ignore', overridden: true, overrideNote: 'Too dear this year' });
    expect((await get<DropSummary[]>('/drops?category=f1&label=Priority,Watch')).body.some((d) => d.id === overridden.id)).toBe(false);

    await send('DELETE', `/releases/${tagged.releaseId}/override`);
    await send('DELETE', `/releases/${tagged.releaseId}/tags?tag=${encodeURIComponent('Bearman rookie')}`);
    expect((await f1Drop()).desk).toMatchObject({ rawScore: before, overridden: false });
  });

  it('your own RRP drives the price gate', async () => {
    const f1 = await f1Drop();
    const hobby = (await get<DropDetail>(`/drops/${f1.id}`)).body.products.find((p) => p.configuration === 'hobby');
    if (!hobby) throw new Error('no hobby box');
    await send('PUT', `/products/${hobby.id}/rrp`, { minor: 10000, currency: 'GBP' });
    const cheap = await get<DropDetail>(`/drops/${f1.id}`);
    expect(cheap.body.products.find((p) => p.id === hobby.id)?.rrp).toMatchObject({ minor: 10000, source: 'owner' });
    expect(cheap.body.desk.gates.find((g) => g.id === 'price')).toMatchObject({ pass: false });
    expect(cheap.body.desk.gated).toBe(true);
    await send('DELETE', `/products/${hobby.id}/rrp`);
  });

  it('pins sort first and appear on the watchlist with watched releases', async () => {
    const all = (await get<DropSummary[]>('/drops?view=upcoming')).body;
    const last = all[all.length - 1] as DropSummary;
    expect((await send('POST', `/pins/${last.id}`)).body).toEqual({ pinned: true });
    const pinnedFirst = (await get<DropSummary[]>('/drops?view=upcoming')).body;
    expect(pinnedFirst[0]).toMatchObject({ id: last.id, pinned: true });
    expect((await get<DropSummary[]>('/drops?view=watchlist')).body.map((d) => d.id)).toEqual([last.id]);
    await send('DELETE', `/pins/${last.id}`);
    expect((await get<DropSummary[]>('/drops?view=watchlist')).body).toEqual([]);
    expect((await send('POST', '/pins/nope')).status).toBe(404);
  });
});
