import type { RulesConfig, SourcesConfig } from '../../shared/config/schema.ts';
import { calendarRootUnit, collectoskPostUnit, retailerListingUnit, retailerMetaUnit, retailerRootUnits } from '../adapters/registry.ts';
import { addMinutes, dropInstant } from '../time.ts';
import { MAX_DELAY_SECONDS, type JobMessage, type JobQueue } from './types.ts';

/**
 * The 15-minute dispatcher. It only decides what is due and queues it; every fetch runs in its
 * own queue invocation (own CPU and subrequest budget on the Free plan).
 *
 * Cadence:
 * - calendars: their own cadence (daily);
 * - shop catalogues: every 6 h;
 * - individual products whose release is within 48 h (or live in the last 24 h): hourly,
 *   and every 15 min inside the final 2 h;
 * - collectosk product posts of upcoming releases (formats, RRPs, checklist): every 3 days.
 */

interface Planned {
  message: JobMessage;
  host: string;
  crawlDelay: number;
  sourceId: string;
  unitKey: string;
  unitKind: 'root' | 'listing' | 'enrich';
  url: string;
  cadenceMinutes: number;
}

export interface DispatchDeps {
  db: D1Database;
  queue: JobQueue;
  rules: RulesConfig;
  sources: SourcesConfig;
  now: Date;
  /** Whether the LLM pass is configured (ANTHROPIC_API_KEY set). */
  llmEnabled: boolean;
}

export async function dispatch(deps: DispatchDeps): Promise<{ queued: number; seeded: number }> {
  const { db, queue, rules, sources, now } = deps;
  const ts = now.toISOString();
  const planned: Planned[] = [];

  // 1. Root units from config: calendars and shop catalogues.
  const roots: Planned[] = [];
  for (const s of sources.sources.filter((x) => x.enabled)) {
    const unit = calendarRootUnit(s);
    roots.push({
      message: { type: 'fetch', sourceKind: 'calendar', unitKind: 'root', unit },
      host: new URL(unit.url).host,
      crawlDelay: s.crawl_delay_seconds,
      sourceId: s.id,
      unitKey: unit.key,
      unitKind: 'root',
      url: unit.url,
      cadenceMinutes: s.cadence_minutes,
    });
  }
  for (const r of sources.retailers.filter((x) => x.enabled)) {
    for (const unit of retailerRootUnits(r)) {
      roots.push({
        message: { type: 'fetch', sourceKind: 'retailer', unitKind: 'root', unit },
        host: new URL(unit.url).host,
        crawlDelay: r.crawl_delay_seconds,
        sourceId: r.id,
        unitKey: unit.key,
        unitKind: 'root',
        url: unit.url,
        cadenceMinutes: rules.cadence.retailer_minutes,
      });
    }
    const meta = retailerMetaUnit(r);
    if (meta) {
      roots.push({
        message: { type: 'fetch', sourceKind: 'retailer', unitKind: 'root', unit: meta },
        host: new URL(meta.url).host,
        crawlDelay: r.crawl_delay_seconds,
        sourceId: r.id,
        unitKey: meta.key,
        unitKind: 'root',
        url: meta.url,
        cadenceMinutes: rules.cadence.shipping_check_minutes,
      });
    }
  }

  const state = await db
    .prepare(`SELECT source_id, unit_key, next_due_at, backoff_until FROM source_state WHERE unit_kind IN ('root', 'listing', 'enrich')`)
    .all<{ source_id: string; unit_key: string; next_due_at: string; backoff_until: string | null }>();
  const stateByKey = new Map(state.results.map((s) => [`${s.source_id}|${s.unit_key}`, s]));
  const isDue = (sourceId: string, key: string) => {
    const s = stateByKey.get(`${sourceId}|${key}`);
    if (!s) return true;
    return s.next_due_at <= ts && (!s.backoff_until || s.backoff_until <= ts);
  };
  let seeded = 0;
  for (const r of roots) {
    if (!stateByKey.has(`${r.sourceId}|${r.unitKey}`)) seeded += 1;
    if (isDue(r.sourceId, r.unitKey)) planned.push(r);
  }

  // 2. Hot products: listings of releases going live soon (or just gone live).
  const horizon = addMinutes(now, rules.cadence.hot_window_hours * 60);
  const recent = addMinutes(now, -24 * 60);
  const hot = await db
    .prepare(
      `SELECT l.retailer_id, l.url, l.external_id, d.starts_at, d.precision FROM listings l
       JOIN products p ON p.id = l.product_id JOIN drops d ON d.release_id = p.release_id
       WHERE l.gone_at IS NULL AND d.starts_at IS NOT NULL AND d.starts_at >= ? AND d.starts_at <= ?`,
    )
    .bind(recent.toISOString().slice(0, 10), horizon.toISOString())
    .all<{ retailer_id: string; url: string; external_id: string; starts_at: string; precision: string }>();
  const seenUnits = new Set<string>();
  for (const h of hot.results) {
    const at = dropInstant(h.starts_at, h.precision, rules.owner.timezone);
    if (!at || at > horizon || at < recent) continue;
    const r = sources.retailers.find((x) => x.id === h.retailer_id && x.enabled);
    if (!r) continue;
    const unit = retailerListingUnit(r, h.url, h.external_id);
    if (!unit || seenUnits.has(`${r.id}|${unit.key}`)) continue;
    seenUnits.add(`${r.id}|${unit.key}`);
    const final = Math.abs(at.getTime() - now.getTime()) <= rules.cadence.final_window_hours * 3600_000;
    if (!isDue(r.id, unit.key)) continue;
    planned.push({
      message: { type: 'fetch', sourceKind: 'retailer', unitKind: 'listing', unit },
      host: new URL(unit.url).host,
      crawlDelay: r.crawl_delay_seconds,
      sourceId: r.id,
      unitKey: unit.key,
      unitKind: 'listing',
      url: unit.url,
      cadenceMinutes: final ? rules.cadence.final_minutes : rules.cadence.hot_minutes,
    });
  }

  // 2b. Enrichment: the product post of each upcoming release the collectosk calendar links.
  const ck = sources.sources.find((s) => s.adapter === 'collectosk' && s.enabled);
  if (ck) {
    const posts = await db
      .prepare(
        `SELECT o.url, d.release_id FROM drop_observations o JOIN drops d ON d.id = o.drop_id
         WHERE o.source_id = ? AND o.url IS NOT NULL AND d.kind = 'release' AND d.status = 'upcoming'
           AND (d.starts_at IS NULL OR d.starts_at <= ?)`,
      )
      .bind(ck.id, addMinutes(now, rules.cadence.enrichment_horizon_days * 1440).toISOString())
      .all<{ url: string; release_id: string }>();
    for (const p of posts.results) {
      const unit = collectoskPostUnit(ck, p.url, p.release_id);
      if (!unit || seenUnits.has(`${ck.id}|${unit.key}`) || !isDue(ck.id, unit.key)) continue;
      seenUnits.add(`${ck.id}|${unit.key}`);
      planned.push({
        message: { type: 'fetch', sourceKind: 'calendar', unitKind: 'enrich', unit },
        host: new URL(unit.url).host,
        crawlDelay: ck.crawl_delay_seconds,
        sourceId: ck.id,
        unitKey: unit.key,
        unitKind: 'enrich',
        url: unit.url,
        cadenceMinutes: rules.cadence.enrichment_minutes,
      });
    }
  }

  // 3. Space requests to the same host by its crawl delay.
  const nextSlot = new Map<string, number>();
  const messages: Array<{ body: JobMessage; delaySeconds?: number }> = [];
  for (const p of planned) {
    const slot = nextSlot.get(p.host) ?? 0;
    nextSlot.set(p.host, slot + Math.max(p.crawlDelay, 2));
    messages.push({ body: p.message, delaySeconds: Math.min(slot, MAX_DELAY_SECONDS) });
  }

  // Housekeeping jobs: hourly, in the first tick of the hour.
  if (now.getUTCMinutes() < 15) {
    messages.push({ body: { type: 'maintenance' } });
    if (deps.llmEnabled) messages.push({ body: { type: 'llm' } });
  }

  // 4. Lease what we queued: push next_due_at forward now, so a slow or lost job is retried
  // at its next cadence rather than queued twice. The runner refines it after the run.
  const writes = planned.map((p) =>
    db
      .prepare(
        `INSERT INTO source_state (source_id, unit_key, unit_kind, url, next_due_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (source_id, unit_key) DO UPDATE SET next_due_at = excluded.next_due_at, url = excluded.url`,
      )
      .bind(p.sourceId, p.unitKey, p.unitKind, p.url, addMinutes(now, p.cadenceMinutes).toISOString()),
  );
  if (writes.length) await db.batch(writes);
  for (let i = 0; i < messages.length; i += 100) await queue.sendBatch(messages.slice(i, i + 100));
  return { queued: messages.length, seeded };
}
