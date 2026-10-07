import { buildCalendar, watchedCalendarDrops } from '../worker/notify/ical.ts';
import { tokenMatches } from '../worker/notify/env-deps.ts';
import { rules } from '../shared/config/index.ts';
import { createClassifier, type Classifier } from '../worker/normalise/classify.ts';
import { ingestMarketPrices, parseMarketBatch } from '../worker/ingest/market.ts';

/**
 * The only public surface, deliberately tiny and outside Cloudflare Access:
 * - POST /push-receipt/<RECEIPT_TOKEN>  the service worker confirms a push arrived;
 * - GET  /ical/<ICAL_TOKEN>.ics          calendar apps subscribe to watched drops;
 * - POST /ingest/market/<INGEST_TOKEN>   the daily Cardmarket import (tools/cardmarket-import.ts).
 * Each path carries a long random token; anything else is a 404.
 */

interface PublicEnv {
  DB: D1Database;
  RECEIPT_TOKEN?: string;
  ICAL_TOKEN?: string;
  INGEST_TOKEN?: string;
  /** Origin of the main app, for CORS on receipts (the service worker posts cross-origin). */
  APP_URL: string;
}

const notFound = () => new Response('Not found', { status: 404 });

let classifier: Classifier | null = null;
const MAX_BODY_BYTES = 64 * 1024;

function cors(env: PublicEnv): Record<string, string> {
  return { 'access-control-allow-origin': new URL(env.APP_URL).origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' };
}

export async function handlePublic(request: Request, env: PublicEnv, now = new Date()): Promise<Response> {
  const url = new URL(request.url);
  const receipt = url.pathname.match(/^\/push-receipt\/([A-Za-z0-9_-]{32,})$/);
  if (receipt) {
    if (!tokenMatches(receipt[1], env.RECEIPT_TOKEN)) return notFound();
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    let deliveryId: unknown;
    try {
      deliveryId = ((await request.json()) as { deliveryId?: unknown }).deliveryId;
    } catch {
      return new Response('Bad request', { status: 400, headers: cors(env) });
    }
    if (typeof deliveryId !== 'string' || !/^[0-9A-Z]{26}$/.test(deliveryId)) return new Response('Bad request', { status: 400, headers: cors(env) });
    const ts = now.toISOString();
    await env.DB.batch([
      env.DB.prepare(`UPDATE notification_deliveries SET status = 'confirmed', confirmed_at = ? WHERE id = ? AND channel = 'push' AND status = 'sent'`).bind(ts, deliveryId),
      env.DB.prepare(`UPDATE push_subscriptions SET last_confirmed_at = ? WHERE id = (SELECT subscription_id FROM notification_deliveries WHERE id = ?)`).bind(ts, deliveryId),
    ]);
    return new Response(null, { status: 204, headers: cors(env) });
  }

  const ingest = url.pathname.match(/^\/ingest\/market\/([A-Za-z0-9_-]{32,})$/);
  if (ingest) {
    if (!tokenMatches(ingest[1], env.INGEST_TOKEN)) return notFound();
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return new Response('Too large', { status: 413 });
    let batch;
    try {
      batch = parseMarketBatch(JSON.parse(text));
    } catch (e) {
      return new Response(`Bad request: ${e instanceof Error ? e.message : 'invalid'}`, { status: 400 });
    }
    classifier ??= createClassifier(rules);
    const stats = await ingestMarketPrices({ db: env.DB, classifier, rules, now }, batch);
    return Response.json({ received: stats.received, matched: stats.matched, unmatched: stats.unmatched.length });
  }

  const ical = url.pathname.match(/^\/ical\/([A-Za-z0-9_-]{32,})\.ics$/);
  if (ical && request.method === 'GET') {
    if (!tokenMatches(ical[1], env.ICAL_TOKEN)) return notFound();
    const drops = await watchedCalendarDrops(env.DB, 'owner_1', env.APP_URL.replace(/\/$/, ''));
    return new Response(buildCalendar(drops, { name: 'Card Desk Drops: watched', now }), {
      headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=900' },
    });
  }
  return notFound();
}

export default {
  fetch: (request: Request, env: PublicEnv) => handlePublic(request, env),
};
