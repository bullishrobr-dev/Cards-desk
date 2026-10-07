import { beforeEach, describe, expect, it } from 'vitest';
import { rules, sources } from '../../shared/config/index.ts';
import { createClassifier } from '../normalise/classify.ts';
import { syncRetailers } from '../ingest/retailers.ts';
import { createTestD1 } from '../testing/sqlite-d1.ts';
import { fakeFetch, fakeKv, fakeQueue, type Route } from '../testing/fakes.ts';
import { localMidnightUtc } from '../time.ts';
import { dispatch } from './scheduler.ts';
import { runFetchJob, type RunnerDeps } from './runner.ts';
import { runMaintenance } from './maintenance.ts';
import type { JobMessage } from './types.ts';

const classifier = createClassifier(rules);
let db: D1Database;
type FetchMsg = Extract<JobMessage, { type: 'fetch' }>;

const robotsOk: Route = { body: 'User-agent: *\nDisallow: /cart\n' };
const COLLECTOSK = 'https://www.collectosk.com/wp-json/wp/v2/pages';
const SCD = 'https://www.sportscardsdirect.co.uk/products.json';

function runner(now: string, routes: Record<string, Route | ((r: Request) => Route)>, kv = fakeKv()) {
  const q = fakeQueue();
  const f = fakeFetch(routes);
  const deps: RunnerDeps = { db, kv, queue: q.queue, rules, sources, classifier, now: new Date(now), fetchImpl: f.impl };
  return { deps, sent: q.sent, requests: f.requests, kv };
}

const calendarMsg = (id: string): FetchMsg => {
  const s = sources.sources.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return { type: 'fetch', sourceKind: 'calendar', unitKind: 'root', unit: { sourceId: id, url: s.urls[0] ?? '', key: 'root', expected: id === 'collectosk' ? 'json' : 'html' } };
};
const scdPage1: FetchMsg = {
  type: 'fetch',
  sourceKind: 'retailer',
  unitKind: 'root',
  unit: { sourceId: 'sportscardsdirect', url: `${SCD}?limit=50&page=1`, key: '/products.json?page=1', expected: 'json' },
};

beforeEach(async () => {
  db = createTestD1();
  await syncRetailers(db, sources);
});

describe('time', () => {
  it('puts a release day at local midnight in Gibraltar, across the clock change', () => {
    expect(localMidnightUtc('2026-10-15', 'Europe/Gibraltar').toISOString()).toBe('2026-10-14T22:00:00.000Z');
    expect(localMidnightUtc('2026-11-06', 'Europe/Gibraltar').toISOString()).toBe('2026-11-05T23:00:00.000Z');
  });
});

describe('dispatcher', () => {
  it('queues every enabled root once, spaced per host, and leases them', async () => {
    const q = fakeQueue();
    const now = new Date('2026-10-05T10:20:00Z');
    const first = await dispatch({ db, queue: q.queue, rules, sources, now, llmEnabled: false });
    const fetches = q.sent.filter((m) => m.body.type === 'fetch');
    const enabledCalendars = sources.sources.filter((s) => s.enabled).length;
    expect(fetches.length).toBeGreaterThan(enabledCalendars);
    expect(first.seeded).toBe(fetches.length);
    // Zatu: two collection paths and its meta.json, 10 s apart (Zatu's delay).
    const zatu = fetches.filter((m) => m.body.type === 'fetch' && m.body.unit.sourceId === 'zatu').map((m) => m.delaySeconds);
    expect(zatu).toEqual([0, 10, 20]);
    // Nothing is queued twice while leased.
    const q2 = fakeQueue();
    await dispatch({ db, queue: q2.queue, rules, sources, now: new Date('2026-10-05T10:35:00Z'), llmEnabled: false });
    expect(q2.sent.filter((m) => m.body.type === 'fetch')).toHaveLength(0);
  });

  it('adds hourly maintenance and the LLM pass in the first tick of the hour', async () => {
    const q = fakeQueue();
    await dispatch({ db, queue: q.queue, rules, sources, now: new Date('2026-10-05T11:00:00Z'), llmEnabled: true });
    expect(q.sent.map((m) => m.body.type)).toEqual(expect.arrayContaining(['maintenance', 'llm']));
  });
});

describe('job runner', () => {
  it('ingests a calendar, then sends its ETag and accepts a 304', async () => {
    const r1 = runner('2026-10-05T10:00:00Z', {
      'https://www.collectosk.com/robots.txt': robotsOk,
      [COLLECTOSK]: { file: 'fixtures/collectosk/response.json', headers: { etag: 'W/"v1"', 'content-type': 'application/json' } },
    });
    const res1 = await runFetchJob(r1.deps, calendarMsg('collectosk'));
    expect(res1.outcome).toBe('ok');
    expect(res1.stats?.createdReleases).toBeGreaterThan(5);

    const r2 = runner('2026-10-06T10:00:00Z', {
      'https://www.collectosk.com/robots.txt': robotsOk,
      [COLLECTOSK]: (req) => (req.headers.get('if-none-match') === 'W/"v1"' ? { status: 304 } : { status: 500 }),
    });
    expect((await runFetchJob(r2.deps, calendarMsg('collectosk'))).outcome).toBe('not_modified');
  });

  it('chains to the next page of a full catalogue page, spaced by crawl delay', async () => {
    const r = runner('2026-10-05T10:00:00Z', {
      'https://www.sportscardsdirect.co.uk/robots.txt': robotsOk,
      [SCD]: { file: 'fixtures/sportscardsdirect/products-0-page1.json', headers: { etag: 'W/"p1"', 'content-type': 'application/json' } },
    });
    expect((await runFetchJob(r.deps, scdPage1)).outcome).toBe('ok');
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]?.body).toMatchObject({ unitKind: 'page', unit: { key: '/products.json?page=2' } });
    expect(r.sent[0]?.delaySeconds).toBeGreaterThanOrEqual(2);

    // Unchanged page 1 still walks on to page 2, which may have changed.
    const r2 = runner('2026-10-05T16:00:00Z', {
      'https://www.sportscardsdirect.co.uk/robots.txt': robotsOk,
      [SCD]: { status: 304 },
    });
    expect((await runFetchJob(r2.deps, scdPage1)).outcome).toBe('not_modified');
    expect(r2.sent[0]?.body).toMatchObject({ unit: { key: '/products.json?page=2' } });
  });

  it('respects robots.txt and never fetches a disallowed path', async () => {
    const r = runner('2026-10-05T10:00:00Z', {
      'https://www.sportscardsdirect.co.uk/robots.txt': { body: 'User-agent: *\nDisallow: /products.json\n' },
      [SCD]: { file: 'fixtures/sportscardsdirect/products-0-page1.json' },
    });
    expect((await runFetchJob(r.deps, scdPage1)).outcome).toBe('robots_disallowed');
    expect(r.requests.some((q) => q.url.startsWith(SCD))).toBe(false);
  });

  it('fails loudly: one source_failing event at the second consecutive failure, then recovery', async () => {
    const kv = fakeKv();
    const challenge: Route = { status: 429, body: '<html><title>Just a moment...</title></html>', headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' } };
    const routes = { 'https://www.sportscardsdirect.co.uk/robots.txt': robotsOk, [SCD]: challenge };
    for (const at of ['2026-10-05T10:00:00Z', '2026-10-05T16:00:00Z', '2026-10-05T22:00:00Z']) {
      expect((await runFetchJob(runner(at, routes, kv).deps, scdPage1)).outcome).toBe('challenge');
    }
    const failing = await db.prepare(`SELECT COUNT(*) AS n FROM events WHERE type = 'source_failing' AND source_id = 'sportscardsdirect'`).first<number>('n');
    expect(failing).toBe(1);
    // A challenge is never read as an empty shop.
    expect(await db.prepare('SELECT COUNT(*) AS n FROM listings').first<number>('n')).toBe(0);

    const ok = runner('2026-10-06T10:00:00Z', { 'https://www.sportscardsdirect.co.uk/robots.txt': robotsOk, [SCD]: { file: 'fixtures/sportscardsdirect/products-0-page1.json' } }, kv);
    expect((await runFetchJob(ok.deps, scdPage1)).outcome).toBe('ok');
    expect(await db.prepare(`SELECT COUNT(*) AS n FROM events WHERE type = 'source_recovered'`).first<number>('n')).toBe(1);
  });

  it('backs off a failing unit', async () => {
    const r = runner('2026-10-05T10:00:00Z', { 'https://www.sportscardsdirect.co.uk/robots.txt': robotsOk, [SCD]: { status: 503 } });
    await runFetchJob(r.deps, scdPage1);
    const s = await db.prepare(`SELECT backoff_until, consecutive_failures FROM source_state WHERE source_id = 'sportscardsdirect'`).first<{ backoff_until: string; consecutive_failures: number }>();
    expect(s).toEqual({ backoff_until: '2026-10-05T10:15:00.000Z', consecutive_failures: 1 });
  });
});

describe('hot polling and going live', () => {
  it('never raises went_live for a release first seen after its date', async () => {
    const routes = { 'https://www.collectosk.com/robots.txt': robotsOk, [COLLECTOSK]: { file: 'fixtures/collectosk/response.json' } };
    await runFetchJob(runner('2026-10-20T10:00:00Z', routes).deps, calendarMsg('collectosk'));
    expect((await runMaintenance(db, rules, new Date('2026-10-20T11:00:00Z'))).wentLive).toBe(0);
    expect(await db.prepare(`SELECT COUNT(*) AS n FROM drops WHERE status = 'live'`).first<number>('n')).toBeGreaterThan(0);
  });

  async function seedChromeF1() {
    const routes = {
      'https://www.collectosk.com/robots.txt': robotsOk,
      [COLLECTOSK]: { file: 'fixtures/collectosk/response.json' },
      'https://www.sportscardsdirect.co.uk/robots.txt': robotsOk,
      [SCD]: { file: 'fixtures/sportscardsdirect/products-0-page1.json' },
    };
    await runFetchJob(runner('2026-10-05T10:00:00Z', routes).deps, calendarMsg('collectosk'));
    await runFetchJob(runner('2026-10-05T10:00:00Z', routes).deps, scdPage1);
  }

  it('polls Chrome F1 products hourly within 48 h, every 15 min in the final 2 h', async () => {
    await seedChromeF1();
    const day = fakeQueue();
    await dispatch({ db, queue: day.queue, rules, sources, now: new Date('2026-10-13T12:20:00Z'), llmEnabled: false });
    const listingUnits = day.sent.filter((m) => m.body.type === 'fetch' && m.body.unitKind === 'listing');
    expect(listingUnits.length).toBe(3); // hobby, mega, value
    let lease = await db.prepare(`SELECT next_due_at FROM source_state WHERE unit_kind = 'listing' LIMIT 1`).first<string>('next_due_at');
    expect(lease).toBe('2026-10-13T13:20:00.000Z');

    const final = fakeQueue();
    await dispatch({ db, queue: final.queue, rules, sources, now: new Date('2026-10-14T21:05:00Z'), llmEnabled: false });
    lease = await db.prepare(`SELECT next_due_at FROM source_state WHERE unit_kind = 'listing' LIMIT 1`).first<string>('next_due_at');
    expect(lease).toBe('2026-10-14T21:20:00.000Z');
  });

  it('marks the drop live at local midnight and raises went_live once', async () => {
    await seedChromeF1();
    await runMaintenance(db, rules, new Date('2026-10-14T21:00:00Z')); // the hourly run before
    expect((await runMaintenance(db, rules, new Date('2026-10-14T21:59:00Z'))).wentLive).toBe(0);
    expect((await runMaintenance(db, rules, new Date('2026-10-14T22:01:00Z'))).wentLive).toBe(1);
    expect((await runMaintenance(db, rules, new Date('2026-10-14T23:00:00Z'))).wentLive).toBe(0);
  });
});

describe('shipping hint from /meta.json', () => {
  const metaMsg: FetchMsg = { type: 'fetch', sourceKind: 'retailer', unitKind: 'root', unit: { sourceId: 'zatu', url: 'https://zatu.com/meta.json', key: 'meta', expected: 'json' } };
  const zatuMeta = 'fixtures/meta/zatu-meta.json';

  it('records the hint quietly the first time, and raises shipping_reverify when Gibraltar drops off', async () => {
    const routes = (body: Route) => ({ 'https://zatu.com/robots.txt': robotsOk, 'https://zatu.com/meta.json': body });
    await runFetchJob(runner('2026-10-05T10:00:00Z', routes({ file: zatuMeta, headers: { 'content-type': 'application/json' } })).deps, metaMsg);
    expect(await db.prepare(`SELECT meta_ships_to FROM retailers WHERE id = 'zatu'`).first<string>('meta_ships_to')).toBe('GI:1,ES:1');
    expect(await db.prepare(`SELECT COUNT(*) AS n FROM events WHERE type = 'shipping_reverify'`).first<number>('n')).toBe(0);

    const withoutGi = JSON.stringify({ ships_to_countries: ['ES', 'FR', 'GB'] });
    await runFetchJob(runner('2026-10-12T10:00:00Z', routes({ body: withoutGi, headers: { 'content-type': 'application/json' } })).deps, metaMsg);
    expect(await db.prepare(`SELECT COUNT(*) AS n FROM events WHERE type = 'shipping_reverify'`).first<number>('n')).toBe(1);
    // The configured flag is untouched: a person re-verifies.
    expect(await db.prepare(`SELECT ships_gi FROM retailers WHERE id = 'zatu'`).first<string>('ships_gi')).toBe('yes');
  });
});

describe('collectosk enrichment jobs', () => {
  const loadCalendar = async () => {
    const r = runner('2026-10-05T10:00:00Z', { 'https://www.collectosk.com/robots.txt': robotsOk, [COLLECTOSK]: { file: 'fixtures/collectosk/response.json' } });
    await runFetchJob(r.deps, calendarMsg('collectosk'));
  };

  it('queues each linked upcoming release page once, every 3 days', async () => {
    await loadCalendar();
    const q = fakeQueue();
    await dispatch({ db, queue: q.queue, rules, sources, now: new Date('2026-10-05T10:20:00Z'), llmEnabled: false });
    const enrich = q.sent.flatMap((m) => (m.body.type === 'fetch' && m.body.unitKind === 'enrich' ? [m.body] : []));
    expect(enrich.length).toBeGreaterThan(3);
    const f1 = enrich.find((m) => m.unit.key === 'post:2026-topps-chrome-formula-1-racing-cards');
    expect(f1?.unit.url).toBe('https://www.collectosk.com/wp-json/wp/v2/posts?slug=2026-topps-chrome-formula-1-racing-cards&_fields=id%2Cslug%2Cmodified_gmt%2Ccontent');
    expect(f1?.unit.context?.releaseId).toMatch(/^[0-9A-Z]{26}$/);
    const due = await db.prepare(`SELECT next_due_at FROM source_state WHERE unit_key = ?`).bind(f1?.unit.key).first<string>('next_due_at');
    expect(due).toBe('2026-10-08T10:20:00.000Z');
    const q2 = fakeQueue();
    await dispatch({ db, queue: q2.queue, rules, sources, now: new Date('2026-10-07T10:20:00Z'), llmEnabled: false });
    expect(q2.sent.some((m) => m.body.type === 'fetch' && m.body.unitKind === 'enrich')).toBe(false);
  });

  it('runs a post job end to end; a vanished post fails loudly', async () => {
    await loadCalendar();
    const q = fakeQueue();
    await dispatch({ db, queue: q.queue, rules, sources, now: new Date('2026-10-05T10:20:00Z'), llmEnabled: false });
    const msg = q.sent.map((m) => m.body).find((b): b is FetchMsg => b.type === 'fetch' && b.unit.key === 'post:2026-topps-chrome-formula-1-racing-cards');
    if (!msg) throw new Error('not queued');
    const POSTS = 'https://www.collectosk.com/wp-json/wp/v2/posts';
    const ok = runner('2026-10-05T10:30:00Z', { 'https://www.collectosk.com/robots.txt': robotsOk, [POSTS]: { file: 'fixtures/collectosk-post/2026-topps-chrome-formula-1-racing-cards.json' } });
    const res = await runFetchJob(ok.deps, msg);
    expect(res).toMatchObject({ outcome: 'ok', stats: { seen: 6, changed: 6 } });
    expect(await db.prepare(`SELECT COUNT(*) AS n FROM products WHERE rrp_source = 'published'`).first<number>('n')).toBe(3);

    const gone = runner('2026-10-08T10:30:00Z', { 'https://www.collectosk.com/robots.txt': robotsOk, [POSTS]: { body: '[]' } });
    const failed = await runFetchJob(gone.deps, msg);
    expect(failed.outcome).toBe('failed');
    expect(failed.error).toMatch(/no post with this slug/);
  });
});
