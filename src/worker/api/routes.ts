import { Hono } from 'hono';
import { rules, sources } from '../../shared/config/index.ts';
import { requireAccess, type AccessIdentity } from './access.ts';
import { dropDetail, listDrops, sourceHealth } from './queries.ts';
import { buildCalendar, watchedCalendarDrops } from '../notify/ical.ts';
import { buildBrief } from '../notify/brief.ts';
import { sectorSignals } from './signals.ts';

export const api = new Hono<{ Bindings: Env; Variables: { identity: AccessIdentity } }>();

api.use('*', requireAccess());

const LABELS = ['Priority', 'Watch', 'Ignore'] as const;

api.get('/drops', async (c) => {
  const v = c.req.query('view');
  const view = v === 'live' || v === 'watchlist' ? v : 'upcoming';
  const labels = (c.req.query('label') ?? '').split(',').filter((l): l is (typeof LABELS)[number] => (LABELS as readonly string[]).includes(l));
  const category = c.req.query('category') || null;
  const regionParam = c.req.query('region');
  const region = regionParam === 'gi' || regionParam === 'es' ? regionParam : null;
  if (category && !rules.categories[category]) return c.json({ error: 'Unknown category' }, 400);
  return c.json(await listDrops(c.env.DB, rules, { view, category, region, labels }, new Date(), c.get('identity').ownerId));
});

api.get('/drops/:id', async (c) => {
  const detail = await dropDetail(c.env.DB, rules, sources, c.req.param('id'), c.get('identity').ownerId);
  if (!detail) return c.json({ error: 'Not found' }, 404);
  return c.json(detail);
});

api.get('/brief', async (c) => c.json(await buildBrief(c.env.DB, rules, new Date(), c.get('identity').ownerId)));

api.get('/signals', async (c) => {
  const days = Number(c.req.query('days') ?? 30);
  if (![7, 30, 90].includes(days)) return c.json({ error: 'days must be 7, 30 or 90' }, 400);
  return c.json(await sectorSignals(c.env.DB, rules, new Date(), days));
});

api.get('/sources/health', async (c) => c.json(await sourceHealth(c.env.DB, sources)));

/** Read-only view of the rules and the categories the UI can filter by. */
api.get('/config', (c) =>
  c.json({
    timezone: rules.owner.timezone,
    shipTo: rules.owner.ship_to,
    categories: Object.entries(rules.categories)
      .filter(([, cat]) => cat.enabled)
      .map(([id, cat]) => ({ id, label: cat.label })),
    rules,
  }),
);

api.get('/me', (c) => c.json(c.get('identity')));

// ---------- Notifications, push, watchlist, calendar ----------

const alertStub = (env: Env, ownerId: string) => env.ALARMS.get(env.ALARMS.idFromName(ownerId));

api.get('/push/config', (c) => {
  const receiptBase = (c.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  return c.json({
    vapidPublicKey: c.env.VAPID_PUBLIC_KEY ?? null,
    receiptUrl: receiptBase && c.env.RECEIPT_TOKEN ? `${receiptBase}/push-receipt/${c.env.RECEIPT_TOKEN}` : null,
  });
});

api.post('/push/subscribe', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || typeof p256dh !== 'string' || typeof auth !== 'string') {
    return c.json({ error: 'Invalid subscription' }, 400);
  }
  const { ownerId } = c.get('identity');
  const ts = new Date().toISOString();
  await c.env.DB
    .prepare(
      `INSERT INTO push_subscriptions (id, owner_id, endpoint, p256dh, auth, user_agent, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, status = 'active', dead_at = NULL, dead_emailed_at = NULL, user_agent = excluded.user_agent`,
    )
    .bind(crypto.randomUUID(), ownerId, endpoint, p256dh, auth, c.req.header('user-agent')?.slice(0, 200) ?? null, ts)
    .run();
  return c.json({ ok: true });
});

api.get('/push/status', async (c) => {
  const { ownerId } = c.get('identity');
  const subs = await c.env.DB
    .prepare('SELECT id, status, user_agent, created_at, last_sent_at, last_confirmed_at, dead_at FROM push_subscriptions WHERE owner_id = ? ORDER BY created_at DESC')
    .bind(ownerId)
    .all();
  return c.json({ subscriptions: subs.results, emailFallback: Boolean(c.env.RESEND_API_KEY && c.env.ALERT_EMAIL) });
});

api.post('/push/test', async (c) => {
  const { ownerId } = c.get('identity');
  const critical = c.req.query('critical') === '1';
  const result = await alertStub(c.env, ownerId).tick({
    title: critical ? 'Test critical alert' : 'Test notification',
    body: critical ? 'If this is not confirmed within 5 minutes, it will also arrive by email.' : 'Push notifications are working.',
    url: `${(c.env.APP_URL ?? '').replace(/\/$/, '')}/notifications`,
    critical,
  });
  return c.json(result);
});

api.get('/notifications', async (c) => {
  const { ownerId } = c.get('identity');
  const [items, unread] = await Promise.all([
    c.env.DB.prepare('SELECT id, trigger, critical, title, body, url, created_at, read_at FROM notifications WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100').bind(ownerId).all(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE owner_id = ? AND read_at IS NULL').bind(ownerId).first<number>('n'),
  ]);
  return c.json({ unread: unread ?? 0, items: items.results });
});

api.post('/notifications/read', async (c) => {
  const { ownerId } = c.get('identity');
  const id = ((await c.req.json().catch(() => ({}))) as { id?: unknown }).id;
  const ts = new Date().toISOString();
  if (typeof id === 'string') await c.env.DB.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND owner_id = ? AND read_at IS NULL').bind(ts, id, ownerId).run();
  else await c.env.DB.prepare('UPDATE notifications SET read_at = ? WHERE owner_id = ? AND read_at IS NULL').bind(ts, ownerId).run();
  return c.json({ ok: true });
});

api.get('/watch', async (c) => {
  const { ownerId } = c.get('identity');
  const rows = await c.env.DB.prepare(`SELECT target_id FROM watchlist WHERE owner_id = ? AND target_type = 'release'`).bind(ownerId).all<{ target_id: string }>();
  return c.json(rows.results.map((r) => r.target_id));
});

api.post('/watch/:releaseId', async (c) => {
  const { ownerId } = c.get('identity');
  const releaseId = c.req.param('releaseId');
  const exists = await c.env.DB.prepare('SELECT 1 AS x FROM releases WHERE id = ?').bind(releaseId).first('x');
  if (!exists) return c.json({ error: 'Not found' }, 404);
  await c.env.DB.prepare(`INSERT OR IGNORE INTO watchlist (owner_id, target_type, target_id, created_at) VALUES (?, 'release', ?, ?)`).bind(ownerId, releaseId, new Date().toISOString()).run();
  c.executionCtx.waitUntil(alertStub(c.env, ownerId).tick().then(() => undefined)); // schedule its alarms now
  return c.json({ watched: true });
});

api.delete('/watch/:releaseId', async (c) => {
  const { ownerId } = c.get('identity');
  await c.env.DB.prepare(`DELETE FROM watchlist WHERE owner_id = ? AND target_type = 'release' AND target_id = ?`).bind(ownerId, c.req.param('releaseId')).run();
  return c.json({ watched: false });
});

// ---------- Pins, tags, score overrides, RRPs (personal; every row carries owner_id) ----------

const jsonBody = async (c: { req: { json: () => Promise<unknown> } }) => ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
const exists = (db: D1Database, table: 'drops' | 'releases' | 'products', id: string) => db.prepare(`SELECT 1 AS x FROM ${table} WHERE id = ?`).bind(id).first('x');

api.post('/pins/:dropId', async (c) => {
  const dropId = c.req.param('dropId');
  if (!(await exists(c.env.DB, 'drops', dropId))) return c.json({ error: 'Not found' }, 404);
  await c.env.DB.prepare('INSERT OR IGNORE INTO pins (owner_id, drop_id, created_at) VALUES (?, ?, ?)').bind(c.get('identity').ownerId, dropId, new Date().toISOString()).run();
  return c.json({ pinned: true });
});

api.delete('/pins/:dropId', async (c) => {
  await c.env.DB.prepare('DELETE FROM pins WHERE owner_id = ? AND drop_id = ?').bind(c.get('identity').ownerId, c.req.param('dropId')).run();
  return c.json({ pinned: false });
});

/** A manual relevance tag (chase card, player, set) until checklists are ingested. */
api.post('/releases/:releaseId/tags', async (c) => {
  const releaseId = c.req.param('releaseId');
  const tag = (await jsonBody(c)).tag;
  if (typeof tag !== 'string' || !tag.trim() || tag.length > 60) return c.json({ error: 'A tag is 1–60 characters' }, 400);
  if (!(await exists(c.env.DB, 'releases', releaseId))) return c.json({ error: 'Not found' }, 404);
  await c.env.DB.prepare('INSERT OR IGNORE INTO manual_tags (owner_id, release_id, tag, created_at) VALUES (?, ?, ?, ?)').bind(c.get('identity').ownerId, releaseId, tag.trim(), new Date().toISOString()).run();
  return c.json({ ok: true });
});

api.delete('/releases/:releaseId/tags', async (c) => {
  const tag = c.req.query('tag');
  if (!tag) return c.json({ error: 'Which tag?' }, 400);
  await c.env.DB.prepare('DELETE FROM manual_tags WHERE owner_id = ? AND release_id = ? AND tag = ?').bind(c.get('identity').ownerId, c.req.param('releaseId'), tag).run();
  return c.json({ ok: true });
});

/** Replace the Desk Score with your own number; the breakdown still shows what the rules said. */
api.put('/releases/:releaseId/override', async (c) => {
  const releaseId = c.req.param('releaseId');
  const body = await jsonBody(c);
  const score = body.score;
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 200) : null;
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 100) return c.json({ error: 'Score must be a whole number from 0 to 100' }, 400);
  if (!(await exists(c.env.DB, 'releases', releaseId))) return c.json({ error: 'Not found' }, 404);
  await c.env.DB
    .prepare(
      `INSERT INTO score_overrides (owner_id, release_id, score, note, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (owner_id, release_id) DO UPDATE SET score = excluded.score, note = excluded.note, created_at = excluded.created_at`,
    )
    .bind(c.get('identity').ownerId, releaseId, score, note, new Date().toISOString())
    .run();
  return c.json({ ok: true });
});

api.delete('/releases/:releaseId/override', async (c) => {
  await c.env.DB.prepare('DELETE FROM score_overrides WHERE owner_id = ? AND release_id = ?').bind(c.get('identity').ownerId, c.req.param('releaseId')).run();
  return c.json({ ok: true });
});

/** Your own RRP for a box type, when the rules have none or the estimate looks wrong. */
api.put('/products/:productId/rrp', async (c) => {
  const productId = c.req.param('productId');
  const body = await jsonBody(c);
  const minor = body.minor;
  const currency = body.currency;
  if (typeof minor !== 'number' || !Number.isInteger(minor) || minor <= 0 || (currency !== 'GBP' && currency !== 'EUR' && currency !== 'USD')) {
    return c.json({ error: 'RRP needs a positive amount in pence/cents and a currency (GBP, EUR or USD)' }, 400);
  }
  if (!(await exists(c.env.DB, 'products', productId))) return c.json({ error: 'Not found' }, 404);
  await c.env.DB
    .prepare(
      `INSERT INTO rrp_overrides (owner_id, product_id, rrp_minor, currency, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (owner_id, product_id) DO UPDATE SET rrp_minor = excluded.rrp_minor, currency = excluded.currency, created_at = excluded.created_at`,
    )
    .bind(c.get('identity').ownerId, productId, minor, currency, new Date().toISOString())
    .run();
  return c.json({ ok: true });
});

api.delete('/products/:productId/rrp', async (c) => {
  await c.env.DB.prepare('DELETE FROM rrp_overrides WHERE owner_id = ? AND product_id = ?').bind(c.get('identity').ownerId, c.req.param('productId')).run();
  return c.json({ ok: true });
});

api.get('/drops/:id/ics', async (c) => {
  const appUrl = (c.env.APP_URL ?? new URL(c.req.url).origin).replace(/\/$/, '');
  const drops = await watchedCalendarDrops(c.env.DB, c.get('identity').ownerId, appUrl, c.req.param('id'));
  if (drops.length === 0) return c.json({ error: 'This drop has no confirmed day yet' }, 404);
  return new Response(buildCalendar(drops, { name: 'Card Desk Drops', now: new Date(), alarmMinutesBefore: 60 }), {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `attachment; filename="drop-${c.req.param('id')}.ics"` },
  });
});

api.get('/calendar', (c) => {
  const base = (c.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  return c.json({ feedUrl: base && c.env.ICAL_TOKEN ? `${base}/ical/${c.env.ICAL_TOKEN}.ics` : null });
});

/**
 * Phase 1 step 1: is Topps reachable from Cloudflare's network? (From the build sandbox every
 * Topps host returned a Cloudflare WAF 403.) Three requests, robots.txt first, run on demand.
 */
api.get('/diagnostics/topps', async (c) => {
  const ua = sources.user_agent;
  const out: Array<{ url: string; status: number | null; note: string }> = [];
  for (const host of ['https://www.topps.com', 'https://uk.topps.com']) {
    const probe = async (path: string) => {
      try {
        const res = await fetch(`${host}${path}`, { headers: { 'user-agent': ua, accept: '*/*' }, redirect: 'manual' });
        const body = await res.text();
        const blocked = res.headers.get('cf-mitigated') || /you have been blocked|Just a moment/i.test(body.slice(0, 4000));
        out.push({ url: `${host}${path}`, status: res.status, note: blocked ? 'blocked by bot protection' : res.headers.get('content-type') ?? '' });
        return { ok: res.ok && !blocked, body };
      } catch (e) {
        out.push({ url: `${host}${path}`, status: null, note: e instanceof Error ? e.message : String(e) });
        return { ok: false, body: '' };
      }
    };
    const robots = await probe('/robots.txt');
    if (!robots.ok) continue;
    // Only probe the feeds robots.txt allows.
    const { isAllowed, parseRobots } = await import('../fetch/robots.ts');
    const policy = parseRobots(robots.body, ua);
    for (const path of ['/products.json?limit=1', '/release-calendar']) {
      if (isAllowed(policy, path)) await probe(path);
      else out.push({ url: `${host}${path}`, status: null, note: 'disallowed by robots.txt; not fetched' });
    }
  }
  return c.json(out);
});
