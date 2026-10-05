import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { rules, sources } from '../../shared/config/index.ts';
import { createClassifier } from '../normalise/classify.ts';
import { createTestD1 } from '../testing/sqlite-d1.ts';
import { fakeFetch } from '../testing/fakes.ts';
import { syncRetailers } from '../ingest/retailers.ts';
import { ingestReleases } from '../ingest/ingest.ts';
import { parseCollectosk } from '../adapters/calendars.ts';
import type { ReleaseObservation } from '../adapters/types.ts';
import { runNotificationPass, type EngineDeps } from './engine.ts';

const b64url = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url');

async function vapidKeys() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return { subject: 'mailto:test@example.com', publicKey: b64url((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer), privateKey: jwk.d ?? '' };
}

async function browserSubscriptionKeys() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  return { p256dh: b64url((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) };
}

let db: D1Database;
let f1Release: string;
let f1Drop: string;
let vapid: Awaited<ReturnType<typeof vapidKeys>>;
const PUSH = 'https://push.example.test/sub/1';

function deps(now: string, pushStatus = 201) {
  const net = fakeFetch({ [PUSH]: { status: pushStatus }, 'https://api.resend.com/emails': { status: 200, body: '{"id":"x"}' } });
  const d: EngineDeps = { db, rules, ownerId: 'owner_1', now: new Date(now), appUrl: 'https://drops.test', vapid, email: { apiKey: 'k', to: 'me@test', from: 'Card Desk Drops <onboarding@resend.dev>' }, fetchImpl: net.impl };
  const pushes = () => net.requests.filter((r) => r.url === PUSH).length;
  const emails = () => net.requests.filter((r) => r.url.startsWith('https://api.resend.com')).length;
  return { d, pushes, emails, requests: net.requests };
}

const notifications = async () => (await db.prepare('SELECT trigger, critical, title FROM notifications ORDER BY created_at, trigger').all<{ trigger: string; critical: number; title: string }>()).results;

beforeEach(async () => {
  db = createTestD1();
  vapid = await vapidKeys();
  await syncRetailers(db, sources);
  await ingestReleases(
    { db, classifier: createClassifier(rules), rules, now: new Date('2026-10-05T08:00:00Z') },
    { id: 'collectosk', categories: ['football', 'f1'], precedence: 2 },
    parseCollectosk(readFileSync('fixtures/collectosk/response.json', 'utf8'), 'confirmed_date').items as ReleaseObservation[],
  );
  const row = await db.prepare(`SELECT r.id AS rid, d.id AS did FROM releases r JOIN drops d ON d.release_id = r.id WHERE r.name LIKE '%Chrome Formula 1%'`).first<{ rid: string; did: string }>();
  f1Release = row?.rid ?? '';
  f1Drop = row?.did ?? '';
  // Skip the backlog of events from the initial load.
  await db.prepare(`UPDATE notification_cursor SET last_event_id = (SELECT MAX(id) FROM events)`).run();
  await db.prepare(`INSERT INTO watchlist (owner_id, target_type, target_id, created_at) VALUES ('owner_1', 'release', ?, '2026-10-05T09:00:00Z')`).bind(f1Release).run();
  const keys = await browserSubscriptionKeys();
  await db.prepare(`INSERT INTO push_subscriptions (id, owner_id, endpoint, p256dh, auth, created_at) VALUES ('sub1', 'owner_1', ?, ?, ?, '2026-10-05T09:00:00Z')`).bind(PUSH, keys.p256dh, keys.auth).run();
});

describe('lead-time alerts for a watched drop (Chrome F1, live 14 Oct 22:00 UTC)', () => {
  it('fires T-24h on time, and schedules the next wake for T-1h', async () => {
    const t = deps('2026-10-13T22:00:00Z');
    const r = await runNotificationPass(t.d);
    expect(r).toMatchObject({ created: 1, pushed: 1 });
    expect(r.nextAt?.toISOString()).toBe('2026-10-14T21:00:00.000Z');
    expect(t.pushes()).toBe(1);
    // The push is encrypted (aes128gcm) and VAPID-signed.
    const req = t.requests.find((q) => q.url === PUSH);
    expect(req?.headers.get('content-encoding')).toBe('aes128gcm');
    expect(req?.headers.get('authorization')).toMatch(/^vapid t=.+, k=/);
    expect(req?.headers.get('urgency')).toBe('normal');
  });

  it('never sends the same alert twice', async () => {
    await runNotificationPass(deps('2026-10-13T22:00:00Z').d);
    const again = deps('2026-10-13T22:01:00Z');
    expect((await runNotificationPass(again.d)).created).toBe(0);
    expect(again.pushes()).toBe(0);
  });

  it('T-1h is critical: unconfirmed after 5 minutes it falls back to email', async () => {
    const at = deps('2026-10-14T21:00:00Z');
    const r = await runNotificationPass(at.d);
    expect(r.created).toBe(1);
    expect(at.requests.find((q) => q.url === PUSH)?.headers.get('urgency')).toBe('high');
    expect(r.nextAt?.toISOString()).toBe('2026-10-14T21:05:15.000Z');
    const later = deps('2026-10-14T21:05:15Z');
    await runNotificationPass(later.d);
    expect(later.emails()).toBe(1);
    // Only once.
    const later2 = deps('2026-10-14T21:06:00Z');
    await runNotificationPass(later2.d);
    expect(later2.emails()).toBe(0);
  });

  it('a confirmed receipt cancels the email fallback', async () => {
    await runNotificationPass(deps('2026-10-14T21:00:00Z').d);
    await db.prepare(`UPDATE notification_deliveries SET status = 'confirmed', confirmed_at = '2026-10-14T21:00:05Z' WHERE channel = 'push'`).run();
    const later = deps('2026-10-14T21:06:00Z');
    await runNotificationPass(later.d);
    expect(later.emails()).toBe(0);
  });

  it('does not send a stale "24 hours to go" when the drop is watched late', async () => {
    const late = deps('2026-10-14T19:00:00Z');
    expect((await runNotificationPass(late.d)).created).toBe(0);
    expect((await runNotificationPass(deps('2026-10-14T21:00:00Z').d)).created).toBe(1); // T-1h still fires
  });
});

describe('events become notifications', () => {
  it('a date change on a watched drop is critical; on an unwatched drop it is silent', async () => {
    await db
      .prepare(`INSERT INTO events (type, drop_id, release_id, payload, created_at) VALUES ('date_changed', ?, ?, ?, '2026-10-06T08:00:00Z')`)
      .bind(f1Drop, f1Release, JSON.stringify({ before: { startsAt: '2026-10-15' }, after: { startsAt: '2026-10-22' } }))
      .run();
    await db.prepare(`INSERT INTO events (type, release_id, payload, created_at) VALUES ('date_changed', 'someone-else', '{}', '2026-10-06T08:00:00Z')`).run();
    await runNotificationPass(deps('2026-10-06T08:00:30Z').d);
    expect(await notifications()).toEqual([{ trigger: 'date_changed_watched', critical: 1, title: 'Date moved: 2026 TOPPS Chrome Formula 1' }]);
  });

  it('a failing source always notifies', async () => {
    await db.prepare(`INSERT INTO events (type, source_id, payload, created_at) VALUES ('source_failing', 'zatu', '{"error":"HTTP 503"}', '2026-10-06T08:00:00Z')`).run();
    await runNotificationPass(deps('2026-10-06T08:00:30Z').d);
    expect((await notifications())[0]).toMatchObject({ trigger: 'source_failing', critical: 0 });
  });
});

describe('dead subscriptions', () => {
  it('a 410 marks the subscription dead, sends critical alerts by email, and emails about it once', async () => {
    const t = deps('2026-10-14T21:00:00Z', 410);
    await runNotificationPass(t.d);
    expect(await db.prepare(`SELECT status FROM push_subscriptions WHERE id = 'sub1'`).first('status')).toBe('dead');
    // The T-1h alert went by email straight away, plus one "push stopped" email.
    expect(t.emails()).toBe(2);
    const next = deps('2026-10-14T21:50:00Z', 410);
    await runNotificationPass(next.d);
    expect(next.pushes()).toBe(0);
    expect(next.emails()).toBe(1); // T-10m by email; no second "push stopped" email
  });
});
