import type { VapidKeys } from '@block65/webcrypto-web-push';
import type { RulesConfig } from '../../shared/config/schema.ts';
import { ulid } from '../ingest/util.ts';
import { addMinutes, dropInstant } from '../time.ts';
import { sendEmail, sendPush, type EmailConfig, type PushBody } from './channels.ts';
import { latestRates } from '../api/queries.ts';
import { scoreReleases } from '../score/load.ts';
import { briefMoments, briefSummary, buildBrief } from './brief.ts';

/**
 * Notifications for one owner:
 * 1. turn new shared events into personal notifications (watched drops, failing sources, a
 *    drop newly ranked Priority …);
 * 2. create lead-time alerts (T-24h, T-1h, T-10m) when they fall due;
 * 3. deliver new notifications by Web Push, recording every attempt;
 * 4. email a critical alert whose push is not confirmed within the receipt timeout,
 *    and email once when a push subscription dies.
 * Every step is idempotent (dedupe keys), so running it twice never double-alerts.
 */

export interface EngineDeps {
  db: D1Database;
  rules: RulesConfig;
  ownerId: string;
  now: Date;
  /** Absolute base URL of the app, for links in notifications and email. */
  appUrl: string;
  vapid: VapidKeys | null;
  email: EmailConfig | null;
  fetchImpl?: typeof fetch;
}

export interface NewNotification {
  dedupeKey: string;
  trigger: string;
  title: string;
  body: string;
  url: string;
  eventId: number | null;
}

const LEAD_LABEL: Record<number, string> = { 1440: '24 hours', 60: '1 hour', 10: '10 minutes' };

function isCritical(rules: RulesConfig, trigger: string): boolean {
  return trigger === 'test_critical' || rules.alerts.critical.includes(trigger);
}

async function watchedReleaseIds(db: D1Database, ownerId: string): Promise<Set<string>> {
  const rows = await db.prepare(`SELECT target_id FROM watchlist WHERE owner_id = ? AND target_type = 'release'`).bind(ownerId).all<{ target_id: string }>();
  return new Set(rows.results.map((r) => r.target_id));
}

async function enabledTriggers(db: D1Database, ownerId: string): Promise<(t: string) => boolean> {
  const rows = await db.prepare('SELECT trigger, enabled FROM notification_prefs WHERE owner_id = ?').bind(ownerId).all<{ trigger: string; enabled: number }>();
  const off = new Set(rows.results.filter((r) => !r.enabled).map((r) => r.trigger));
  return (t) => !off.has(t);
}

/** 1. Events → notifications. */
export async function notificationsFromEvents(deps: EngineDeps): Promise<NewNotification[]> {
  const { db, ownerId } = deps;
  const cursor = (await db.prepare('SELECT last_event_id FROM notification_cursor WHERE owner_id = ?').bind(ownerId).first<number>('last_event_id')) ?? 0;
  const events = await db
    .prepare(
      `SELECT e.id, e.type, e.drop_id, e.release_id, e.source_id, e.payload, r.name AS release_name
       FROM events e LEFT JOIN releases r ON r.id = e.release_id WHERE e.id > ? ORDER BY e.id LIMIT 200`,
    )
    .bind(cursor)
    .all<{ id: number; type: string; drop_id: string | null; release_id: string | null; source_id: string | null; payload: string | null; release_name: string | null }>();
  if (events.results.length === 0) return [];
  const watched = await watchedReleaseIds(db, ownerId);
  const out: NewNotification[] = [];
  for (const e of events.results) {
    const p = e.payload ? (JSON.parse(e.payload) as Record<string, unknown>) : {};
    const isWatched = e.release_id !== null && watched.has(e.release_id);
    const dropUrl = e.drop_id ? `${deps.appUrl}/drop/${e.drop_id}` : deps.appUrl;
    const name = e.release_name ?? 'A watched drop';
    if (e.type === 'went_live' && isWatched) {
      out.push({ dedupeKey: `live:${e.drop_id}:${String(p.starts_at)}`, trigger: 'live', title: `Live now: ${name}`, body: 'The release date has arrived. Check the shops.', url: dropUrl, eventId: e.id });
    } else if (e.type === 'date_changed' && isWatched) {
      const before = (p.before as { startsAt?: string } | undefined)?.startsAt ?? 'TBD';
      const after = (p.after as { startsAt?: string } | undefined)?.startsAt ?? 'TBD';
      out.push({ dedupeKey: `event:${e.id}`, trigger: 'date_changed_watched', title: `Date moved: ${name}`, body: `${before} → ${after}`, url: dropUrl, eventId: e.id });
    } else if ((e.type === 'date_set' || e.type === 'confidence_changed') && isWatched) {
      const after = (p.after as { startsAt?: string; confidence?: string } | undefined) ?? {};
      out.push({ dedupeKey: `event:${e.id}`, trigger: 'date_update_watched', title: `Date update: ${name}`, body: `Now ${after.startsAt ?? 'TBD'} (${String(after.confidence ?? '').replace('_', ' ')})`, url: dropUrl, eventId: e.id });
    } else if (e.type === 'restock' && isWatched) {
      out.push({ dedupeKey: `event:${e.id}`, trigger: 'restock', title: `Back in stock: ${name}`, body: `At ${e.source_id ?? 'a shop'}`, url: dropUrl, eventId: e.id });
    } else if (e.type === 'source_failing') {
      out.push({ dedupeKey: `event:${e.id}`, trigger: 'source_failing', title: `Source failing: ${e.source_id}`, body: String(p.error ?? 'Two runs in a row have failed.'), url: `${deps.appUrl}/sources`, eventId: e.id });
    } else if (e.type === 'shipping_reverify') {
      out.push({ dedupeKey: `event:${e.id}`, trigger: 'shipping_reverify', title: `Re-check shipping: ${e.source_id}`, body: `The shop's country list changed (${String(p.before)} → ${String(p.after)}). Re-verify Gibraltar/Spain shipping.`, url: `${deps.appUrl}/sources`, eventId: e.id });
    }
  }
  out.push(...(await newPriorityAlerts(deps, events.results, watched)));
  const last = events.results[events.results.length - 1]?.id ?? cursor;
  await db.prepare('UPDATE notification_cursor SET last_event_id = ? WHERE owner_id = ?').bind(last, ownerId).run();
  return out;
}

/** Events after which a release's Desk Score may have changed. */
const RESCORE_EVENTS = new Set(['release_discovered', 'date_set', 'date_changed', 'confidence_changed', 'restock']);

/**
 * "New Priority drop": once per release, the first time it scores Priority and passes every hard
 * gate. Watched releases are skipped (you already have their alerts); gated ones never alert.
 */
async function newPriorityAlerts(deps: EngineDeps, events: Array<{ type: string; release_id: string | null; release_name: string | null }>, watched: Set<string>): Promise<NewNotification[]> {
  const names = new Map<string, string>();
  for (const e of events) if (e.release_id && RESCORE_EVENTS.has(e.type) && !watched.has(e.release_id)) names.set(e.release_id, e.release_name ?? 'A new drop');
  if (names.size === 0) return [];
  const scores = await scoreReleases(deps.db, deps.rules, await latestRates(deps.db), [...names.keys()], deps.ownerId);
  const ids = [...scores].filter(([, s]) => s.label === 'Priority' && !s.gated).map(([id]) => id);
  if (ids.length === 0) return [];
  const drops = await deps.db
    .prepare(`SELECT id, release_id FROM drops WHERE kind = 'release' AND status IN ('upcoming', 'live') AND release_id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<{ id: string; release_id: string }>();
  return drops.results.map((d) => {
    const s = scores.get(d.release_id);
    const why = s?.breakdown.filter((b) => b.points > 0).map((b) => b.label.toLowerCase()).join(', ');
    return {
      dedupeKey: `priority:${d.release_id}`,
      trigger: 'priority_new',
      title: `New Priority drop: ${names.get(d.release_id)}`,
      body: `Desk Score ${s?.score ?? ''}${why ? ` (${why})` : ''}. Watch it to get countdown alerts.`,
      url: `${deps.appUrl}/drop/${d.id}`,
      eventId: null,
    };
  });
}

interface WatchedDrop {
  drop_id: string;
  release_id: string;
  name: string;
  starts_at: string;
  precision: string;
}

async function watchedDatedDrops(deps: EngineDeps): Promise<WatchedDrop[]> {
  const rows = await deps.db
    .prepare(
      `SELECT d.id AS drop_id, d.release_id, r.name, d.starts_at, d.precision FROM watchlist w
       JOIN drops d ON d.release_id = w.target_id AND d.kind = 'release' JOIN releases r ON r.id = d.release_id
       WHERE w.owner_id = ? AND w.target_type = 'release' AND d.status = 'upcoming' AND d.starts_at IS NOT NULL AND d.precision IN ('day', 'time')`,
    )
    .bind(deps.ownerId)
    .all<WatchedDrop>();
  return rows.results;
}

/** 2. Lead-time alerts that are due now (with a 60 s look-ahead for alarm jitter). */
export async function dueLeadAlerts(deps: EngineDeps): Promise<NewNotification[]> {
  const out: NewNotification[] = [];
  for (const d of await watchedDatedDrops(deps)) {
    const live = dropInstant(d.starts_at, d.precision, deps.rules.owner.timezone);
    if (!live) continue;
    for (const lead of deps.rules.alerts.lead_times_minutes) {
      const at = addMinutes(live, -lead);
      // Due from its time for a short grace period (alarm jitter, a brief outage), never later:
      // watching a drop 3 hours out must not produce a stale "24 hours to go".
      const graceMs = Math.min(30, lead) * 60_000;
      if (at.getTime() <= deps.now.getTime() + 60_000 && deps.now.getTime() <= at.getTime() + graceMs && deps.now < live) {
        out.push({
          dedupeKey: `t_minus_${lead}:${d.drop_id}:${live.toISOString()}`,
          trigger: `t_minus_${lead}`,
          title: `${LEAD_LABEL[lead] ?? `${lead} minutes`} to go: ${d.name}`,
          body: d.precision === 'time' ? `Goes live at ${live.toISOString()}` : 'Release day starts at midnight Gibraltar time.',
          url: `${deps.appUrl}/drop/${d.drop_id}`,
          eventId: null,
        });
      }
    }
  }
  return out;
}

/** How long after its time a missed weekly brief is still sent (a cron tick, a brief outage). */
const BRIEF_GRACE_MS = 90 * 60_000;

/** 2b. The weekly brief push, once per week, within its grace period. */
export async function dueBrief(deps: EngineDeps): Promise<NewNotification[]> {
  const { last } = briefMoments(deps.now, deps.rules);
  if (deps.now.getTime() - last.at.getTime() > BRIEF_GRACE_MS) return [];
  const dedupeKey = `brief:${last.date}`;
  const sent = await deps.db.prepare('SELECT 1 AS x FROM notifications WHERE owner_id = ? AND dedupe_key = ?').bind(deps.ownerId, dedupeKey).first('x');
  if (sent) return [];
  const brief = await buildBrief(deps.db, deps.rules, deps.now, deps.ownerId);
  return [{ dedupeKey, trigger: 'weekly_brief', title: 'Your weekly brief', body: briefSummary(brief), url: `${deps.appUrl}/brief`, eventId: null }];
}

/** When the next lead-time alert falls due, for the Durable Object alarm. */
export async function nextLeadAlertAt(deps: EngineDeps): Promise<Date | null> {
  let next: Date | null = null;
  for (const d of await watchedDatedDrops(deps)) {
    const live = dropInstant(d.starts_at, d.precision, deps.rules.owner.timezone);
    if (!live) continue;
    for (const lead of deps.rules.alerts.lead_times_minutes) {
      const at = addMinutes(live, -lead);
      if (at > deps.now && (!next || at < next)) next = at;
    }
  }
  return next;
}

/** Inserts notifications; the unique dedupe key makes repeats no-ops. Returns the ones that are new. */
async function insertNotifications(deps: EngineDeps, list: NewNotification[]): Promise<Array<NewNotification & { id: string; critical: boolean }>> {
  if (list.length === 0) return [];
  const prefs = await enabledTriggers(deps.db, deps.ownerId);
  const ts = deps.now.toISOString();
  const inserted: Array<NewNotification & { id: string; critical: boolean }> = [];
  for (const n of list.filter((x) => prefs(x.trigger))) {
    const id = ulid(deps.now.getTime());
    const critical = isCritical(deps.rules, n.trigger);
    const res = await deps.db
      .prepare(
        `INSERT OR IGNORE INTO notifications (id, owner_id, dedupe_key, trigger, critical, title, body, url, event_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, deps.ownerId, n.dedupeKey, n.trigger, critical ? 1 : 0, n.title, n.body, n.url, n.eventId, ts)
      .run();
    if (res.meta.changes) inserted.push({ ...n, id, critical });
  }
  return inserted;
}

async function unreadCount(db: D1Database, ownerId: string): Promise<number> {
  return (await db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE owner_id = ? AND read_at IS NULL').bind(ownerId).first<number>('n')) ?? 0;
}

/** 3. Push each new notification to every live subscription. */
async function deliver(deps: EngineDeps, notes: Array<NewNotification & { id: string; critical: boolean }>): Promise<{ pushed: number; emailed: number }> {
  const { db, ownerId } = deps;
  if (notes.length === 0) return { pushed: 0, emailed: 0 };
  const ts = deps.now.toISOString();
  const subs = await db
    .prepare(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE owner_id = ? AND status = 'active'`)
    .bind(ownerId)
    .all<{ id: string; endpoint: string; p256dh: string; auth: string }>();
  // Notifications are inserted before delivery, so this count already includes them.
  const badge = await unreadCount(db, ownerId);
  let pushed = 0;
  let emailed = 0;
  for (const n of notes) {
    let anyPushSent = false;
    if (deps.vapid) {
      for (const s of subs.results) {
        const deliveryId = ulid(deps.now.getTime());
        const body: PushBody = {
          web_push: 8030,
          mutable: true,
          notification: { title: n.title, body: n.body, navigate: n.url, lang: 'en-GB', tag: n.dedupeKey, app_badge: String(badge) },
          delivery_id: deliveryId,
          notification_id: n.id,
        };
        const r = await sendPush(s, body, deps.vapid, { critical: n.critical, ttlSeconds: n.critical ? 3600 : 6 * 3600 }, deps.fetchImpl);
        const status = r.kind === 'sent' ? 'sent' : r.kind === 'dead' ? 'dead_subscription' : 'failed';
        await db
          .prepare('INSERT INTO notification_deliveries (id, notification_id, owner_id, channel, subscription_id, status, http_status, error, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(deliveryId, n.id, ownerId, 'push', s.id, status, r.status, r.kind === 'failed' ? r.error : null, ts)
          .run();
        if (r.kind === 'sent') {
          anyPushSent = true;
          pushed += 1;
          await db.prepare('UPDATE push_subscriptions SET last_sent_at = ? WHERE id = ?').bind(ts, s.id).run();
        } else if (r.kind === 'dead') {
          await db.prepare(`UPDATE push_subscriptions SET status = 'dead', dead_at = ? WHERE id = ? AND status = 'active'`).bind(ts, s.id).run();
        }
      }
    }
    // A critical alert with no push on its way goes straight to email.
    if (n.critical && !anyPushSent && (await emailNotification(deps, n.id, n.title, `${n.body}\n\n${n.url}`))) emailed += 1;
  }
  return { pushed, emailed };
}

async function emailNotification(deps: EngineDeps, notificationId: string, subject: string, text: string): Promise<boolean> {
  if (!deps.email) return false;
  const r = await sendEmail(deps.email, `Card Desk Drops: ${subject}`, text, deps.fetchImpl);
  await deps.db
    .prepare('INSERT INTO notification_deliveries (id, notification_id, owner_id, channel, status, http_status, error, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(ulid(deps.now.getTime()), notificationId, deps.ownerId, 'email', r.ok ? 'sent' : 'failed', r.status, r.error ?? null, deps.now.toISOString())
    .run();
  return r.ok;
}

/** 4a. Critical pushes not confirmed within the timeout fall back to email, once per notification. */
export async function fallbackUnconfirmed(deps: EngineDeps): Promise<number> {
  const { db, ownerId } = deps;
  const cutoff = addMinutes(deps.now, -deps.rules.alerts.receipt_timeout_minutes).toISOString();
  const pending = await db
    .prepare(
      `SELECT n.id, n.title, n.body, n.url FROM notifications n
       WHERE n.owner_id = ? AND n.critical = 1
         AND EXISTS (SELECT 1 FROM notification_deliveries d WHERE d.notification_id = n.id AND d.channel = 'push' AND d.fallback_checked_at IS NULL AND d.sent_at <= ?)
         AND NOT EXISTS (SELECT 1 FROM notification_deliveries d WHERE d.notification_id = n.id AND d.status = 'confirmed')
         AND NOT EXISTS (SELECT 1 FROM notification_deliveries d WHERE d.notification_id = n.id AND d.channel = 'email' AND d.status = 'sent')`,
    )
    .bind(ownerId, cutoff)
    .all<{ id: string; title: string; body: string; url: string }>();
  let sent = 0;
  for (const n of pending.results) {
    if (await emailNotification(deps, n.id, n.title, `${n.body}\n\n${n.url}\n\n(Sent by email because the push notification was not confirmed within ${deps.rules.alerts.receipt_timeout_minutes} minutes.)`)) sent += 1;
  }
  if (pending.results.length) {
    await db
      .prepare(`UPDATE notification_deliveries SET fallback_checked_at = ? WHERE owner_id = ? AND channel = 'push' AND fallback_checked_at IS NULL AND sent_at <= ?`)
      .bind(deps.now.toISOString(), ownerId, cutoff)
      .run();
  }
  return sent;
}

/** 4b. A dead subscription is reported once by email; the app shows a re-subscribe banner. */
export async function reportDeadSubscriptions(deps: EngineDeps): Promise<number> {
  const dead = await deps.db
    .prepare(`SELECT id FROM push_subscriptions WHERE owner_id = ? AND status = 'dead' AND dead_emailed_at IS NULL`)
    .bind(deps.ownerId)
    .all<{ id: string }>();
  if (dead.results.length === 0 || !deps.email) return 0;
  const r = await sendEmail(
    deps.email,
    'Card Desk Drops: push notifications stopped',
    `Your device's push subscription has expired, so alerts can no longer reach it by push. Open the app and tap "Turn on notifications" to re-subscribe.\n\n${deps.appUrl}/settings`,
    deps.fetchImpl,
  );
  if (r.ok) {
    await deps.db.batch(dead.results.map((d) => deps.db.prepare('UPDATE push_subscriptions SET dead_emailed_at = ? WHERE id = ?').bind(deps.now.toISOString(), d.id)));
  }
  return r.ok ? dead.results.length : 0;
}

/** One full pass. Returns when the alarm should next fire. */
export async function runNotificationPass(deps: EngineDeps, extra: NewNotification[] = []): Promise<{ created: number; pushed: number; emailed: number; nextAt: Date | null }> {
  const fromEvents = await notificationsFromEvents(deps);
  const lead = await dueLeadAlerts(deps);
  const brief = await dueBrief(deps);
  const created = await insertNotifications(deps, [...fromEvents, ...lead, ...brief, ...extra]);
  const { pushed, emailed } = await deliver(deps, created);
  const fellBack = await fallbackUnconfirmed(deps);
  await reportDeadSubscriptions(deps);

  // Next wake: the next lead alert, the next weekly brief, or the receipt deadline of a critical push still pending.
  const candidates: Date[] = [briefMoments(deps.now, deps.rules).next];
  const lead2 = await nextLeadAlertAt(deps);
  if (lead2) candidates.push(lead2);
  const oldestPending = await deps.db
    .prepare(
      `SELECT MIN(d.sent_at) AS t FROM notification_deliveries d JOIN notifications n ON n.id = d.notification_id
       WHERE d.owner_id = ? AND n.critical = 1 AND d.channel = 'push' AND d.status = 'sent' AND d.fallback_checked_at IS NULL`,
    )
    .bind(deps.ownerId)
    .first<string | null>('t');
  if (oldestPending) candidates.push(addMinutes(new Date(oldestPending), deps.rules.alerts.receipt_timeout_minutes + 0.25));
  const nextAt = candidates.length ? new Date(Math.min(...candidates.map((d) => d.getTime()))) : null;
  return { created: created.length, pushed, emailed: emailed + fellBack, nextAt };
}
