import type { Retailer, RulesConfig, Source, SourcesConfig } from '../../shared/config/schema.ts';
import { nextPageUnit, parseCalendar, parseRetailer, parseShipsTo, PAGE_SIZE } from '../adapters/registry.ts';
import type { ListingObservation, ParseResult, ReleaseObservation, Unit } from '../adapters/types.ts';
import { nextBackoff } from '../fetch/backoff.ts';
import { politeFetch } from '../fetch/polite-fetch.ts';
import { isAllowed, parseRobots, type RobotsPolicy } from '../fetch/robots.ts';
import { ingestListings, ingestReleases, type IngestStats } from '../ingest/ingest.ts';
import type { Classifier } from '../normalise/classify.ts';
import { addMinutes } from '../time.ts';
import { MAX_DELAY_SECONDS, type JobMessage, type JobQueue } from './types.ts';

export interface RunnerDeps {
  db: D1Database;
  kv: Pick<KVNamespace, 'get' | 'put'>;
  queue: JobQueue;
  rules: RulesConfig;
  sources: SourcesConfig;
  classifier: Classifier;
  now: Date;
  fetchImpl?: typeof fetch;
}

type Outcome = 'ok' | 'not_modified' | 'failed' | 'challenge' | 'robots_disallowed';

interface UnitState {
  etag: string | null;
  last_modified: string | null;
  backoff_level: number;
  consecutive_failures: number;
  last_success_at: string | null;
  has_more: number;
}

const ROBOTS_TTL_SECONDS = 24 * 3600;

/** robots.txt per host, cached in KV for a day. Unreachable (5xx/challenge) means "don't crawl". */
async function robotsFor(deps: RunnerDeps, url: URL): Promise<RobotsPolicy | 'unreachable'> {
  const key = `robots:${url.host}`;
  const cached = await deps.kv.get(key);
  if (cached) return cached === 'unreachable' ? 'unreachable' : (JSON.parse(cached) as RobotsPolicy);
  const res = await politeFetch({ url: `${url.origin}/robots.txt`, userAgent: deps.sources.user_agent, expected: 'html' }, deps.fetchImpl);
  let value: RobotsPolicy | 'unreachable';
  if (res.kind === 'ok') value = parseRobots(res.body, deps.sources.user_agent);
  else if (res.kind === 'http_error' && res.status >= 400 && res.status < 500) value = { rules: [], crawlDelaySeconds: null }; // RFC 9309: 4xx = allow all
  else value = 'unreachable';
  await deps.kv.put(key, value === 'unreachable' ? 'unreachable' : JSON.stringify(value), { expirationTtl: value === 'unreachable' ? 3600 : ROBOTS_TTL_SECONDS });
  return value;
}

function findSource(deps: RunnerDeps, msg: Extract<JobMessage, { type: 'fetch' }>): { source?: Source; retailer?: Retailer } {
  if (msg.sourceKind === 'calendar') return { source: deps.sources.sources.find((s) => s.id === msg.unit.sourceId) };
  return { retailer: deps.sources.retailers.find((r) => r.id === msg.unit.sourceId) };
}

/**
 * Compares a shop's public ship-to list with what we saw last time. A change to Gibraltar or
 * Spain raises "shipping_reverify": the flags in config came from a manual check and are only
 * changed by a person, never by this hint.
 */
async function checkShipsTo(deps: RunnerDeps, r: Retailer, now: { gi: boolean; es: boolean }) {
  const { db } = deps;
  const ts = deps.now.toISOString();
  const summary = `GI:${now.gi ? 1 : 0},ES:${now.es ? 1 : 0}`;
  const prev = await db.prepare('SELECT meta_ships_to FROM retailers WHERE id = ?').bind(r.id).first<string | null>('meta_ships_to');
  const writes = [db.prepare('UPDATE retailers SET meta_ships_to = ?, meta_checked_at = ? WHERE id = ?').bind(summary, ts, r.id)];
  if (prev && prev !== summary) {
    writes.push(
      db.prepare('INSERT INTO events (type, source_id, payload, created_at) VALUES (?, ?, ?, ?)').bind('shipping_reverify', r.id, JSON.stringify({ before: prev, after: summary, configured: { gi: r.ships_gi.value, es: r.ships_es.value } }), ts),
    );
  }
  await db.batch(writes);
}

export async function runFetchJob(deps: RunnerDeps, msg: Extract<JobMessage, { type: 'fetch' }>): Promise<{ outcome: Outcome; stats?: IngestStats; error?: string }> {
  const { db, now } = deps;
  const ts = now.toISOString();
  const started = Date.now();
  const unit = msg.unit;
  const { source, retailer } = findSource(deps, msg);
  if (!source && !retailer) return { outcome: 'failed', error: `unknown source ${unit.sourceId}` };

  const state = await db
    .prepare('SELECT etag, last_modified, backoff_level, consecutive_failures, last_success_at, has_more FROM source_state WHERE source_id = ? AND unit_key = ?')
    .bind(unit.sourceId, unit.key)
    .first<UnitState>();
  // A press release page is read once; later news arrives as new pages.
  if (msg.unitKind === 'followup' && state?.last_success_at) return { outcome: 'not_modified' };

  const followUps: Array<{ unit: Unit; kind: 'page' | 'followup' }> = [];
  let outcome: Outcome = 'ok';
  let httpStatus: number | null = null;
  let error: string | null = null;
  let retryAfter: string | null = null;
  let stats: IngestStats | undefined;
  let newEtag: string | null = state?.etag ?? null;
  let newLastModified: string | null = state?.last_modified ?? null;
  let hasMore = state?.has_more ?? 0;

  const url = new URL(unit.url);
  const robots = await robotsFor(deps, url);
  if (robots === 'unreachable') {
    outcome = 'challenge';
    error = 'robots.txt unreachable (blocked or server error); not crawling';
  } else if (!isAllowed(robots, url.pathname + url.search)) {
    outcome = 'robots_disallowed';
    error = `robots.txt disallows ${url.pathname}`;
  } else {
    const res = await politeFetch(
      { url: unit.url, userAgent: deps.sources.user_agent, expected: unit.expected, etag: state?.etag, lastModified: state?.last_modified },
      deps.fetchImpl,
    );
    if (res.kind === 'not_modified') {
      outcome = 'not_modified';
      httpStatus = 304;
    } else if (res.kind === 'challenge') {
      outcome = 'challenge';
      httpStatus = res.status;
      error = res.reason;
      retryAfter = res.retryAfter;
    } else if (res.kind === 'http_error') {
      outcome = 'failed';
      httpStatus = res.status;
      error = `HTTP ${res.status}`;
      retryAfter = res.retryAfter;
    } else if (res.kind === 'network_error') {
      outcome = 'failed';
      error = res.error;
    } else {
      httpStatus = res.status;
      try {
        let parsed: ParseResult;
        const ingestDeps = { db, classifier: deps.classifier, rules: deps.rules, now };
        if (source) {
          parsed = parseCalendar(source, unit, res.body);
          const fx = parsed.items.find((i) => i.kind === 'fx');
          if (fx?.kind === 'fx') {
            await db.batch(Object.entries(fx.rates).map(([cur, rate]) => db.prepare('INSERT OR REPLACE INTO fx_rates (date, currency, rate) VALUES (?, ?, ?)').bind(fx.date, cur, rate)));
          }
          const releases = parsed.items.filter((i): i is ReleaseObservation => i.kind === 'release');
          if (releases.length) stats = await ingestReleases(ingestDeps, { id: source.id, categories: source.categories, precedence: source.precedence }, releases);
          for (const f of parsed.followUps) followUps.push({ unit: f, kind: 'followup' });
        } else if (retailer && unit.key === 'meta') {
          await checkShipsTo(deps, retailer, parseShipsTo(res.body));
        } else if (retailer) {
          parsed = parseRetailer(retailer, unit, res.body);
          stats = await ingestListings(ingestDeps, retailer, parsed.items.filter((i): i is ListingObservation => i.kind === 'listing'));
          for (const f of parsed.followUps) followUps.push({ unit: f, kind: 'page' });
          hasMore = parsed.followUps.length > 0 ? 1 : 0;
        }
        newEtag = res.etag;
        newLastModified = res.lastModified;
      } catch (e) {
        outcome = 'failed';
        error = `parse/ingest: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }
  // A 304 on a full page still means later pages may have changed.
  if (outcome === 'not_modified' && hasMore && retailer && msg.unitKind !== 'listing') followUps.push({ unit: nextPageUnit(unit), kind: 'page' });

  const failed = outcome === 'failed' || outcome === 'challenge' || outcome === 'robots_disallowed';
  const failures = failed ? (state?.consecutive_failures ?? 0) + 1 : 0;
  const backoff = failed ? nextBackoff(state?.backoff_level ?? 0, retryAfter, now) : null;
  const writes: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO source_state (source_id, unit_key, unit_kind, url, etag, last_modified, next_due_at, backoff_until, backoff_level,
           consecutive_failures, last_attempt_at, last_success_at, last_failure_at, last_error, last_item_count, has_more)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (source_id, unit_key) DO UPDATE SET etag = excluded.etag, last_modified = excluded.last_modified,
           backoff_until = excluded.backoff_until, backoff_level = excluded.backoff_level,
           consecutive_failures = excluded.consecutive_failures, last_attempt_at = excluded.last_attempt_at,
           last_success_at = COALESCE(excluded.last_success_at, source_state.last_success_at),
           last_failure_at = COALESCE(excluded.last_failure_at, source_state.last_failure_at),
           last_error = excluded.last_error, last_item_count = COALESCE(excluded.last_item_count, source_state.last_item_count),
           has_more = excluded.has_more`,
      )
      .bind(
        unit.sourceId,
        unit.key,
        msg.unitKind,
        unit.url,
        newEtag,
        newLastModified,
        // Root and listing units were leased by the dispatcher; pages and follow-ups are never scheduled.
        addMinutes(now, 24 * 60).toISOString(),
        backoff?.until.toISOString() ?? null,
        backoff ? backoff.level : 0,
        failures,
        ts,
        failed ? null : ts,
        failed ? ts : null,
        error,
        stats ? stats.seen : null,
        hasMore,
      ),
    db
      .prepare('INSERT INTO source_runs (source_id, unit_key, started_at, finished_at, outcome, http_status, items_seen, items_changed, error, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(unit.sourceId, unit.key, ts, new Date().toISOString(), outcome, httpStatus, stats?.seen ?? 0, stats?.changed ?? 0, error, Date.now() - started),
  ];
  // Loud failure: crossing the threshold raises one event; recovering raises another.
  const threshold = deps.rules.alerts.source_failures_before_alert;
  if (failed && failures === threshold) {
    writes.push(db.prepare('INSERT INTO events (type, source_id, payload, created_at) VALUES (?, ?, ?, ?)').bind('source_failing', unit.sourceId, JSON.stringify({ unit: unit.key, error, failures }), ts));
  }
  if (!failed && (state?.consecutive_failures ?? 0) >= threshold) {
    writes.push(db.prepare('INSERT INTO events (type, source_id, payload, created_at) VALUES (?, ?, ?, ?)').bind('source_recovered', unit.sourceId, JSON.stringify({ unit: unit.key }), ts));
  }
  // Dispatcher leases keep root/listing cadence; only restore it here when backing off.
  if (backoff && (msg.unitKind === 'root' || msg.unitKind === 'listing')) {
    writes.push(db.prepare('UPDATE source_state SET next_due_at = MAX(next_due_at, ?) WHERE source_id = ? AND unit_key = ?').bind(backoff.until.toISOString(), unit.sourceId, unit.key));
  }
  await db.batch(writes);

  if (followUps.length) {
    const delay = Math.max(source?.crawl_delay_seconds ?? retailer?.crawl_delay_seconds ?? 2, 2);
    await deps.queue.sendBatch(
      followUps.slice(0, 100).map((f, i) => ({
        body: { type: 'fetch', sourceKind: msg.sourceKind, unitKind: f.kind, unit: f.unit },
        delaySeconds: Math.min(delay * (i + 1), MAX_DELAY_SECONDS),
      })),
    );
  }
  return { outcome, stats, ...(error ? { error } : {}) };
}

export { PAGE_SIZE };
