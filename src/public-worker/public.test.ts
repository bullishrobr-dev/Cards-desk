import { beforeEach, describe, expect, it } from 'vitest';
import { createTestD1 } from '../worker/testing/sqlite-d1.ts';
import { handlePublic } from './index.ts';

const RECEIPT = 'r'.repeat(43);
const ICAL = 'i'.repeat(43);
let db: D1Database;
const env = () => ({ DB: db, RECEIPT_TOKEN: RECEIPT, ICAL_TOKEN: ICAL, APP_URL: 'https://app.test' });
const DELIVERY = '01JABCDEFGHJKMNPQRSTVWXYZ0';

beforeEach(async () => {
  db = createTestD1();
  await db.batch([
    db.prepare(`INSERT INTO push_subscriptions (id, owner_id, endpoint, p256dh, auth, created_at) VALUES ('s1', 'owner_1', 'https://push.test/1', 'k', 'a', 'now')`),
    db.prepare(`INSERT INTO notifications (id, owner_id, dedupe_key, trigger, critical, title, body, created_at) VALUES ('n1', 'owner_1', 'k1', 't_minus_60', 1, 'T', 'B', 'now')`),
    db.prepare(`INSERT INTO notification_deliveries (id, notification_id, owner_id, channel, subscription_id, status, sent_at) VALUES (?, 'n1', 'owner_1', 'push', 's1', 'sent', 'now')`).bind(DELIVERY),
  ]);
});

describe('push receipts', () => {
  it('confirms a delivery and stamps the subscription', async () => {
    const res = await handlePublic(new Request(`https://pub.test/push-receipt/${RECEIPT}`, { method: 'POST', body: JSON.stringify({ deliveryId: DELIVERY }) }), env(), new Date('2026-10-14T21:00:05Z'));
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.test');
    expect(await db.prepare(`SELECT status FROM notification_deliveries WHERE id = ?`).bind(DELIVERY).first('status')).toBe('confirmed');
    expect(await db.prepare(`SELECT last_confirmed_at FROM push_subscriptions WHERE id = 's1'`).first('last_confirmed_at')).toBe('2026-10-14T21:00:05.000Z');
  });

  it('404s a wrong token without touching the database', async () => {
    const res = await handlePublic(new Request(`https://pub.test/push-receipt/${'x'.repeat(43)}`, { method: 'POST', body: JSON.stringify({ deliveryId: DELIVERY }) }), env());
    expect(res.status).toBe(404);
    expect(await db.prepare(`SELECT status FROM notification_deliveries WHERE id = ?`).bind(DELIVERY).first('status')).toBe('sent');
  });

  it('rejects junk bodies', async () => {
    const res = await handlePublic(new Request(`https://pub.test/push-receipt/${RECEIPT}`, { method: 'POST', body: '{"deliveryId":"1 OR 1=1"}' }), env());
    expect(res.status).toBe(400);
  });
});

describe('iCal feed', () => {
  it('serves watched drops with a valid calendar and 404s a wrong token', async () => {
    await db.batch([
      db.prepare(`INSERT INTO releases (id, match_key, category, name, name_precedence, subject, origin_source, created_at, updated_at) VALUES ('r1', 'k', 'f1', '2026 Topps Chrome Formula 1', 2, 'chrome formula 1', 'collectosk', 'now', 'now')`),
      db.prepare(`INSERT INTO drops (id, release_id, starts_at, precision, confidence, created_at, updated_at) VALUES ('d1', 'r1', '2026-10-15', 'day', 'confirmed_date', 'now', '2026-10-05T08:00:00Z')`),
      db.prepare(`INSERT INTO drop_date_history (drop_id, new_starts_at, new_precision, new_confidence, source_id, changed_at) VALUES ('d1', '2026-10-15', 'day', 'confirmed_date', 'collectosk', 'now')`),
      db.prepare(`INSERT INTO watchlist (owner_id, target_type, target_id, created_at) VALUES ('owner_1', 'release', 'r1', 'now')`),
    ]);
    const res = await handlePublic(new Request(`https://pub.test/ical/${ICAL}.ics`), env(), new Date('2026-10-05T09:00:00Z'));
    expect(res.headers.get('content-type')).toContain('text/calendar');
    const body = await res.text();
    expect(body).toContain('BEGIN:VCALENDAR\r\n');
    expect(body).toContain('DTSTART;VALUE=DATE:20261015\r\nDTEND;VALUE=DATE:20261016');
    expect(body).toContain('SUMMARY:2026 Topps Chrome Formula 1');
    expect(body).toContain('URL:https://app.test/drop/d1');
    expect(body.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect((await handlePublic(new Request(`https://pub.test/ical/${'z'.repeat(43)}.ics`), env())).status).toBe(404);
  });

  it('has nothing else', async () => {
    expect((await handlePublic(new Request('https://pub.test/'), env())).status).toBe(404);
  });
});
