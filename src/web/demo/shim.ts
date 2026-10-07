import type { DropDetail, DropSummary, NotificationPref } from '../../shared/api-types.ts';

/**
 * Demo build only: answers the app's /api calls from a snapshot of a real local run
 * (tools/demo-snapshot.mjs), with watch, pin, notification switches and "read" kept in memory.
 * Anything that needs the real backend says so instead of pretending to work.
 */
const files = import.meta.glob<{ default: Record<string, unknown> }>('./snapshot.json', { eager: true });
const snap: Record<string, unknown> = files['./snapshot.json']?.default ?? {};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const unavailable = (what: string) => json({ error: `${what} needs the deployed app; this demo does not save changes.` }, 409);

const lists = {
  upcoming: (snap['/api/drops?view=upcoming'] as DropSummary[] | undefined) ?? [],
  live: (snap['/api/drops?view=live'] as DropSummary[] | undefined) ?? [],
};
const watched = new Set<string>([...lists.upcoming, ...lists.live].filter((d) => d.watched).map((d) => d.releaseId));
const pinned = new Set<string>([...lists.upcoming, ...lists.live].filter((d) => d.pinned).map((d) => d.id));
const prefs = (snap['/api/notification-prefs'] as NotificationPref[] | undefined) ?? [];
const notes = (snap['/api/notifications'] as { unread: number; items: Array<{ id: string; read_at: string | null }> } | undefined) ?? { unread: 0, items: [] };

function overlay<T extends DropSummary>(d: T): T {
  return { ...d, watched: watched.has(d.releaseId), pinned: pinned.has(d.id) };
}

function dropsFor(params: URLSearchParams): DropSummary[] {
  const view = params.get('view') ?? 'upcoming';
  let out = (view === 'watchlist' ? [...lists.upcoming, ...lists.live] : view === 'live' ? lists.live : lists.upcoming).map(overlay);
  if (view === 'watchlist') out = out.filter((d) => d.watched || d.pinned);
  const category = params.get('category');
  if (category) out = out.filter((d) => d.category === category);
  const region = params.get('region');
  if (region === 'gi' || region === 'es') out = out.filter((d) => d.shopCount === 0 || (region === 'gi' ? d.shipsGi : d.shipsEs) || d.bestPrice !== null);
  const labels = params.get('label')?.split(',').filter(Boolean);
  if (labels?.length) out = out.filter((d) => labels.includes(d.desk.label));
  return out.sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

async function handle(url: URL, method: string, body: unknown): Promise<Response> {
  const path = url.pathname;
  if (method === 'GET') {
    if (path === '/api/drops') return json(dropsFor(url.searchParams));
    const detail = path.match(/^\/api\/drops\/([^/]+)$/);
    if (detail) {
      const d = snap[path] as DropDetail | undefined;
      return d ? json(overlay(d)) : json({ error: 'Not in this demo snapshot' }, 404);
    }
    if (path === '/api/notification-prefs') return json(prefs);
    if (path === '/api/notifications') return json({ unread: notes.items.filter((n) => !n.read_at).length, items: notes.items });
    const key = url.search ? `${path}${url.search}` : path;
    return key in snap ? json(snap[key]) : json({ error: 'Not in this demo snapshot' }, 404);
  }
  const watch = path.match(/^\/api\/watch\/([^/]+)$/);
  if (watch?.[1]) {
    if (method === 'POST') watched.add(watch[1]);
    else watched.delete(watch[1]);
    return json({ watched: method === 'POST' });
  }
  const pin = path.match(/^\/api\/pins\/([^/]+)$/);
  if (pin?.[1]) {
    if (method === 'POST') pinned.add(pin[1]);
    else pinned.delete(pin[1]);
    return json({ pinned: method === 'POST' });
  }
  const pref = path.match(/^\/api\/notification-prefs\/([^/]+)$/);
  if (pref) {
    const p = prefs.find((x) => x.id === pref[1]);
    if (p) p.enabled = Boolean((body as { enabled?: boolean } | null)?.enabled);
    return json({ ok: true });
  }
  if (path === '/api/notifications/read') {
    const id = (body as { id?: string } | null)?.id;
    for (const n of notes.items) if (!id || n.id === id) n.read_at ??= new Date().toISOString();
    return json({ ok: true });
  }
  if (path.startsWith('/api/push')) return unavailable('Push notifications');
  if (path.includes('/tags')) return unavailable('Saving tags');
  if (path.includes('/override')) return unavailable('Saving a score override');
  if (path.includes('/rrp')) return unavailable('Saving your RRP');
  return unavailable('This action');
}

export function installDemoApi() {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'https://demo.invalid');
    if (!url.pathname.startsWith('/api/')) return real(input, init);
    let body: unknown = null;
    try {
      body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    } catch {
      body = null;
    }
    return handle(url, (init?.method ?? 'GET').toUpperCase(), body);
  };
}
