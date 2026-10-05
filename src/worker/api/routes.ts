import { Hono } from 'hono';
import { rules, sources } from '../../shared/config/index.ts';
import { requireAccess, type AccessIdentity } from './access.ts';
import { dropDetail, listDrops, sourceHealth } from './queries.ts';
import { buildCalendar, watchedCalendarDrops } from '../notify/ical.ts';

export const api = new Hono<{ Bindings: Env; Variables: { identity: AccessIdentity } }>();

api.use('*', requireAccess());

api.get('/drops', async (c) => {
  const view = c.req.query('view') === 'live' ? 'live' : 'upcoming';
  const category = c.req.query('category') || null;
  const regionParam = c.req.query('region');
  const region = regionParam === 'gi' || regionParam === 'es' ? regionParam : null;
  if (category && !rules.categories[category]) return c.json({ error: 'Unknown category' }, 400);
  return c.json(await listDrops(c.env.DB, rules, { view, category, region }, new Date()));
});

api.get('/drops/:id', async (c) => {
  const detail = await dropDetail(c.env.DB, rules, sources, c.req.param('id'));
  if (!detail) return c.json({ error: 'Not found' }, 404);
  const watched = await c.env.DB
    .prepare(`SELECT 1 AS x FROM watchlist WHERE owner_id = ? AND target_type = 'release' AND target_id = ?`)
    .bind(c.get('identity').ownerId, detail.releaseId)
    .first('x');
  return c.json({ ...detail, watched: Boolean(watched) });
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
