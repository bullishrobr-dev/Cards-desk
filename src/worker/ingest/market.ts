import type { MarketBatch, MarketRow } from '../../shared/cardmarket.ts';
import { MARKET_BATCH_SIZE } from '../../shared/cardmarket.ts';
import { matchRelease } from '../normalise/match.ts';
import type { IngestDeps } from './ingest.ts';
import { ulid } from './util.ts';

export interface MarketStats {
  received: number;
  matched: number;
  unmatched: string[];
  productsCreated: number;
}

/** Validates a posted batch; anything off-shape is rejected whole rather than half-stored. */
export function parseMarketBatch(body: unknown): MarketBatch {
  const b = body as Partial<MarketBatch> | null;
  if (!b || b.source !== 'cardmarket' || typeof b.asOf !== 'string' || Number.isNaN(Date.parse(b.asOf)) || !Array.isArray(b.rows)) throw new Error('not a market batch');
  if (b.rows.length > MARKET_BATCH_SIZE) throw new Error(`at most ${MARKET_BATCH_SIZE} rows per batch`);
  const int = (v: unknown) => v === null || (typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 1e9);
  for (const r of b.rows as MarketRow[]) {
    if (!Number.isInteger(r.id) || typeof r.name !== 'string' || r.name.length > 200 || !int(r.lowMinor) || !int(r.trendMinor) || !int(r.avgMinor)) throw new Error(`bad row ${JSON.stringify(r).slice(0, 80)}`);
  }
  return b as MarketBatch;
}

/**
 * Stores a batch of Cardmarket sealed prices, each matched to a Pokémon release and box type with
 * the same classifier and matcher the shops use (never creating a release). Matching runs fresh
 * every day, so a box listed before its release reached our calendars links up once it does.
 * Two D1 calls (one read pair, one batch). Also records the import as the "cardmarket" source's run for Source health.
 */
export async function ingestMarketPrices(deps: IngestDeps, batch: MarketBatch): Promise<MarketStats> {
  const { db, classifier, rules, now } = deps;
  const ts = now.toISOString();
  const date = batch.asOf.slice(0, 10);
  const stats: MarketStats = { received: batch.rows.length, matched: 0, unmatched: [], productsCreated: 0 };
  const [releases, products] = await Promise.all([
    db.prepare(`SELECT id, subject, season, name FROM releases WHERE category = 'pokemon'`).all<{ id: string; subject: string; season: string | null; name: string }>(),
    db.prepare(`SELECT p.release_id, p.configuration FROM products p JOIN releases r ON r.id = p.release_id WHERE r.category = 'pokemon'`).all<{ release_id: string; configuration: string }>(),
  ]);
  const candidates = releases.results.map((r) => ({ id: r.id, subject: r.subject ? r.subject.split(' ') : [], season: r.season }));
  const names = new Map(releases.results.map((r) => [r.id, r.name]));
  const haveProduct = new Set(products.results.map((p) => `${p.release_id}|${p.configuration}`));
  const { series, lines } = classifier.matchTokens('pokemon');

  const writes: D1PreparedStatement[] = [];
  for (const row of batch.rows) {
    // Cardmarket names drop the game ("Surging Sparks Booster Box"); the classifier needs it.
    const c = classifier.classify({ title: `Pokémon ${row.name}` }, { categories: ['pokemon'], listing: true });
    let releaseId: string | null = null;
    if (c.category === 'pokemon' && !c.excludedRule && c.configuration && c.subject.length) {
      const m = matchRelease(c.subject, c.season, candidates, series, lines);
      if (m.kind === 'match') releaseId = m.id;
    }
    if (releaseId) stats.matched += 1;
    else stats.unmatched.push(row.name);
    // A box type Cardmarket sells exists, even before any shop we watch lists it: create the
    // product (with the rules.yaml RRP for that box type, if any) so the Desk Score can count it.
    if (releaseId && c.configuration && !haveProduct.has(`${releaseId}|${c.configuration}`)) {
      haveProduct.add(`${releaseId}|${c.configuration}`);
      stats.productsCreated += 1;
      const known = rules.rrp.known.find((k) => k.category === 'pokemon' && k.configuration === c.configuration);
      const label = rules.categories.pokemon?.configurations.find((x) => x.id === c.configuration)?.label ?? 'Sealed';
      writes.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO products (id, release_id, configuration, name, rrp_minor, rrp_currency, rrp_source, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(ulid(now.getTime()), releaseId, c.configuration, `${names.get(releaseId) ?? row.name} — ${label}`, known ? Math.round(known.amount * 100) : null, known?.currency ?? null, known ? 'config' : null, ts, ts),
      );
    }
    writes.push(
      db
        .prepare(
          `INSERT INTO market_prices (source, external_id, name, release_id, configuration, currency, low_minor, trend_minor, avg_minor, as_of, updated_at)
           VALUES ('cardmarket', ?, ?, ?, ?, 'EUR', ?, ?, ?, ?, ?)
           ON CONFLICT (source, external_id) DO UPDATE SET name = excluded.name, release_id = excluded.release_id,
             configuration = excluded.configuration, low_minor = excluded.low_minor, trend_minor = excluded.trend_minor,
             avg_minor = excluded.avg_minor, as_of = excluded.as_of, updated_at = excluded.updated_at`,
        )
        .bind(String(row.id), row.name, releaseId, releaseId ? c.configuration : null, row.lowMinor, row.trendMinor, row.avgMinor, batch.asOf, ts),
      db
        .prepare(`INSERT OR REPLACE INTO market_price_history (source, external_id, date, low_minor, trend_minor, avg_minor) VALUES ('cardmarket', ?, ?, ?, ?, ?)`)
        .bind(String(row.id), date, row.lowMinor, row.trendMinor, row.avgMinor),
    );
  }
  writes.push(
    db
      .prepare(
        `INSERT INTO source_state (source_id, unit_key, unit_kind, url, next_due_at, last_attempt_at, last_success_at, last_item_count, consecutive_failures, last_error)
         VALUES ('cardmarket', 'import', 'root', 'push:/ingest/market', ?, ?, ?, ?, 0, NULL)
         ON CONFLICT (source_id, unit_key) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, last_success_at = excluded.last_success_at,
           consecutive_failures = 0, last_error = NULL,
           -- Several batches make one day's import: count them all, restarting with each new file.
           last_item_count = CASE WHEN source_state.next_due_at = excluded.next_due_at THEN source_state.last_item_count + excluded.last_item_count ELSE excluded.last_item_count END,
           next_due_at = excluded.next_due_at`,
      )
      .bind(batch.asOf, ts, ts, stats.matched),
    db
      .prepare('INSERT INTO source_runs (source_id, unit_key, started_at, finished_at, outcome, http_status, items_seen, items_changed, error, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind('cardmarket', 'import', ts, ts, 'ok', 200, stats.received, stats.matched, null, 0),
  );
  await db.batch(writes);
  return stats;
}

/** How long without a successful import before the feed counts as failing (a day plus slack). */
export const MARKET_STALE_HOURS = 50;

/**
 * Hourly: a market feed that stopped arriving is a failure, not silence. Once an import has
 * succeeded, every hour past the deadline counts as a failure; the second raises source_failing.
 */
export async function checkMarketFreshness(db: D1Database, threshold: number, now: Date): Promise<void> {
  const row = await db.prepare(`SELECT last_success_at, consecutive_failures FROM source_state WHERE source_id = 'cardmarket' AND unit_key = 'import'`).first<{ last_success_at: string | null; consecutive_failures: number }>();
  if (!row?.last_success_at || now.getTime() - Date.parse(row.last_success_at) < MARKET_STALE_HOURS * 3600_000) return;
  const failures = row.consecutive_failures + 1;
  const ts = now.toISOString();
  const error = `No Cardmarket import since ${row.last_success_at.slice(0, 16).replace('T', ' ')} UTC (check the GitHub Action)`;
  const writes = [
    db.prepare(`UPDATE source_state SET consecutive_failures = ?, last_failure_at = ?, last_error = ? WHERE source_id = 'cardmarket' AND unit_key = 'import'`).bind(failures, ts, error),
  ];
  if (failures === threshold) {
    writes.push(db.prepare('INSERT INTO events (type, source_id, payload, created_at) VALUES (?, ?, ?, ?)').bind('source_failing', 'cardmarket', JSON.stringify({ unit: 'import', error, failures }), ts));
  }
  await db.batch(writes);
}
