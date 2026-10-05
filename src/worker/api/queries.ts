import type { RulesConfig, SourcesConfig } from '../../shared/config/schema.ts';
import type { Confidence, DropDetail, DropSummary, ListingView, Money, Precision, ProductView, ShipFlag, SourceHealth } from '../../shared/api-types.ts';
import { convertMinor, placeholders } from '../ingest/util.ts';
import { addMinutes, dropInstant, localDate } from '../time.ts';

type Rates = Record<string, number>;

export async function latestRates(db: D1Database): Promise<Rates> {
  const rows = await db
    .prepare('SELECT currency, rate FROM fx_rates WHERE date = (SELECT MAX(date) FROM fx_rates)')
    .all<{ currency: string; rate: number }>();
  const rates: Rates = { EUR: 1 };
  for (const r of rows.results) rates[r.currency] = r.rate;
  return rates;
}

export function money(minor: number, currency: string, rates: Rates): Money {
  return { minor, currency, gbp: convertMinor(minor, currency, 'GBP', rates), eur: convertMinor(minor, currency, 'EUR', rates) };
}

interface DropRow {
  id: string;
  release_id: string;
  name: string;
  category: string;
  publisher: string | null;
  season: string | null;
  tier: string | null;
  starts_at: string | null;
  precision: Precision;
  confidence: Confidence;
  status: DropSummary['status'];
}

interface ListingRow {
  id: string;
  release_id: string;
  product_id: string;
  configuration: string;
  rrp_minor: number | null;
  rrp_currency: string | null;
  price_minor: number | null;
  currency: string;
  available: number;
  is_preorder: number;
  retailer_id: string;
  retailer: string;
  ships_gi: ShipFlag;
  ships_es: ShipFlag;
}

const DROP_COLUMNS = `d.id, d.release_id, r.name, r.category, r.publisher, r.season, r.tier, d.starts_at, d.precision, d.confidence, d.status`;

async function listingsFor(db: D1Database, releaseIds: string[]): Promise<ListingRow[]> {
  const out: ListingRow[] = [];
  for (let i = 0; i < releaseIds.length; i += 90) {
    const chunk = releaseIds.slice(i, i + 90);
    const res = await db
      .prepare(
        `SELECT l.id, p.release_id, p.id AS product_id, p.configuration, p.rrp_minor, p.rrp_currency, l.price_minor, l.currency,
                l.available, l.is_preorder, ret.id AS retailer_id, ret.name AS retailer, ret.ships_gi, ret.ships_es
         FROM listings l JOIN products p ON p.id = l.product_id JOIN retailers ret ON ret.id = l.retailer_id
         WHERE l.gone_at IS NULL AND p.release_id IN (${placeholders(chunk.length)})`,
      )
      .bind(...chunk)
      .all<ListingRow>();
    out.push(...res.results);
  }
  return out;
}

/** Ratio of a price to an RRP in any currency; null without an RRP or a rate. */
function ratio(priceMinor: number, priceCurrency: string, rrpMinor: number | null, rrpCurrency: string | null, rates: Rates): number | null {
  if (rrpMinor === null || !rrpCurrency) return null;
  const rrp = convertMinor(rrpMinor, rrpCurrency, priceCurrency, rates);
  return rrp ? Math.round((priceMinor / rrp) * 1000) / 1000 : null;
}

function summarise(d: DropRow, listings: ListingRow[], region: 'gi' | 'es' | null, rates: Rates, tz: string): DropSummary {
  const mine = listings.filter((l) => l.release_id === d.release_id);
  const shipsTo = (l: ListingRow, r: 'gi' | 'es') => (r === 'gi' ? l.ships_gi : l.ships_es) !== 'no';
  const priced = mine.filter((l) => l.price_minor !== null && (!region || shipsTo(l, region)));
  // Prefer prices you can act on (in stock or pre-order open); fall back to any listed price.
  const open = priced.filter((l) => l.available || l.is_preorder);
  const buyable = open.length ? open : priced;
  let best: DropSummary['bestPrice'] = null;
  let bestRatio: number | null = null;
  for (const l of buyable) {
    const m = money(l.price_minor as number, l.currency, rates);
    if (!best || (m.gbp ?? Infinity) < (best.gbp ?? Infinity)) {
      best = { ...m, retailer: l.retailer, configuration: l.configuration };
      bestRatio = ratio(l.price_minor as number, l.currency, l.rrp_minor, l.rrp_currency, rates);
    }
  }
  const live = dropInstant(d.starts_at, d.precision, tz);
  return {
    id: d.id,
    releaseId: d.release_id,
    name: d.name,
    category: d.category,
    publisher: d.publisher,
    season: d.season,
    tier: d.tier,
    startsAt: d.starts_at,
    liveAt: live?.toISOString() ?? null,
    precision: d.precision,
    confidence: d.confidence,
    status: d.status,
    configurations: [...new Set(mine.map((l) => l.configuration))],
    shopCount: new Set(mine.map((l) => l.retailer_id)).size,
    shipsGi: mine.some((l) => l.ships_gi === 'yes'),
    shipsEs: mine.some((l) => l.ships_es === 'yes'),
    bestPrice: best,
    priceVsRrp: bestRatio,
  };
}

export interface DropQuery {
  view: 'upcoming' | 'live';
  category: string | null;
  region: 'gi' | 'es' | null;
}

/** Upcoming: dated drops in the next 120 days, then undated (TBD) ones. Live: drops now live. */
export async function listDrops(db: D1Database, rules: RulesConfig, q: DropQuery, now: Date): Promise<DropSummary[]> {
  const conditions = [`d.kind = 'release'`, q.view === 'live' ? `d.status = 'live'` : `d.status = 'upcoming'`];
  const binds: unknown[] = [];
  if (q.view === 'upcoming') {
    // Not yet live (maintenance flips status hourly; this keeps a just-passed date out meanwhile).
    conditions.push(`(d.starts_at IS NULL OR (d.starts_at <= ? AND d.starts_at >= ?))`);
    binds.push(addMinutes(now, 120 * 1440).toISOString(), localDate(now, rules.owner.timezone));
  }
  if (q.category) {
    conditions.push('r.category = ?');
    binds.push(q.category);
  }
  const rows = await db
    .prepare(`SELECT ${DROP_COLUMNS} FROM drops d JOIN releases r ON r.id = d.release_id WHERE ${conditions.join(' AND ')} ORDER BY d.starts_at IS NULL, d.starts_at, r.name`)
    .bind(...binds)
    .all<DropRow>();
  const rates = await latestRates(db);
  const listings = await listingsFor(db, rows.results.map((r) => r.release_id));
  const out = rows.results.map((d) => summarise(d, listings, q.region, rates, rules.owner.timezone));
  // A region filter keeps drops buyable there, plus calendar-only drops with no shop listing yet.
  return q.region ? out.filter((d) => d.shopCount === 0 || (q.region === 'gi' ? d.shipsGi : d.shipsEs) || d.bestPrice !== null) : out;
}

export async function dropDetail(db: D1Database, rules: RulesConfig, cfg: SourcesConfig, id: string): Promise<DropDetail | null> {
  const d = await db.prepare(`SELECT ${DROP_COLUMNS} FROM drops d JOIN releases r ON r.id = d.release_id WHERE d.id = ?`).bind(id).first<DropRow>();
  if (!d) return null;
  const rates = await latestRates(db);
  const [obs, hist, listingRows, products] = await Promise.all([
    db.prepare('SELECT source_id, starts_at, precision, confidence, raw, region, last_seen_at FROM drop_observations WHERE drop_id = ? ORDER BY precedence, source_id').bind(id).all<{ source_id: string; starts_at: string | null; precision: Precision; confidence: Confidence; raw: string | null; region: string | null; last_seen_at: string }>(),
    db.prepare('SELECT changed_at, old_starts_at, new_starts_at, old_confidence, new_confidence, source_id FROM drop_date_history WHERE drop_id = ? ORDER BY id').bind(id).all<{ changed_at: string; old_starts_at: string | null; new_starts_at: string | null; old_confidence: string | null; new_confidence: string; source_id: string }>(),
    db
      .prepare(
        `SELECT l.id, l.product_id, l.url, l.raw_title, l.price_minor, l.currency, l.available, l.is_preorder, l.last_changed_at,
                ret.id AS retailer_id, ret.name AS retailer, ret.country, ret.ships_gi, ret.ships_gi_verified_at, ret.ships_gi_note,
                ret.ships_es, ret.ships_es_verified_at, ret.ships_es_note
         FROM listings l JOIN products p ON p.id = l.product_id JOIN retailers ret ON ret.id = l.retailer_id
         WHERE p.release_id = ? AND l.gone_at IS NULL ORDER BY ret.ships_gi = 'yes' DESC, l.price_minor`,
      )
      .bind(d.release_id)
      .all<Record<string, unknown>>(),
    db.prepare('SELECT id, configuration, name, rrp_minor, rrp_currency, rrp_source FROM products WHERE release_id = ?').bind(d.release_id).all<{ id: string; configuration: string; name: string; rrp_minor: number | null; rrp_currency: string | null; rrp_source: 'config' | 'estimated' | null }>(),
  ]);
  const labels = new Map([...cfg.sources.map((s) => [s.id, s.label] as const), ...cfg.retailers.map((r) => [r.id, r.name] as const)]);
  const configLabel = (c: string) => rules.categories[d.category]?.configurations.find((x) => x.id === c)?.label ?? 'Sealed (type not recognised)';

  const productViews: ProductView[] = products.results.map((p) => {
    const listings: ListingView[] = listingRows.results
      .filter((l) => l.product_id === p.id)
      .map((l) => ({
        id: l.id as string,
        retailerId: l.retailer_id as string,
        retailer: l.retailer as string,
        country: l.country as string,
        url: l.url as string,
        title: l.raw_title as string,
        price: l.price_minor === null ? null : money(l.price_minor as number, l.currency as string, rates),
        available: Boolean(l.available),
        isPreorder: Boolean(l.is_preorder),
        shipsGi: { value: l.ships_gi as ShipFlag, verifiedAt: (l.ships_gi_verified_at as string) ?? null, note: (l.ships_gi_note as string) ?? null },
        shipsEs: { value: l.ships_es as ShipFlag, verifiedAt: (l.ships_es_verified_at as string) ?? null, note: (l.ships_es_note as string) ?? null },
        priceVsRrp: l.price_minor === null ? null : ratio(l.price_minor as number, l.currency as string, p.rrp_minor, p.rrp_currency, rates),
        lastChangedAt: l.last_changed_at as string,
      }));
    return {
      id: p.id,
      configuration: p.configuration,
      configurationLabel: configLabel(p.configuration),
      name: p.name,
      rrp: p.rrp_minor !== null && p.rrp_currency && p.rrp_source ? { ...money(p.rrp_minor, p.rrp_currency, rates), source: p.rrp_source } : null,
      listings,
    };
  });

  const allListings = await listingsFor(db, [d.release_id]);
  return {
    ...summarise(d, allListings, null, rates, rules.owner.timezone),
    observations: obs.results.map((o) => ({ sourceId: o.source_id, sourceLabel: labels.get(o.source_id) ?? o.source_id, startsAt: o.starts_at, precision: o.precision, confidence: o.confidence, raw: o.raw, region: o.region, lastSeenAt: o.last_seen_at })),
    history: hist.results.map((h) => ({ changedAt: h.changed_at, oldStartsAt: h.old_starts_at, newStartsAt: h.new_starts_at, oldConfidence: h.old_confidence, newConfidence: h.new_confidence, sourceId: h.source_id })),
    products: productViews,
    costNotes: rules.cost_notes.map((n) => ({ region: n.applies_to.region, from: n.applies_to.from, text: n.text, source: n.source })),
  };
}

export async function sourceHealth(db: D1Database, cfg: SourcesConfig): Promise<SourceHealth[]> {
  const rows = await db
    .prepare(
      `SELECT source_id, MAX(last_success_at) AS last_success_at, MAX(last_failure_at) AS last_failure_at,
              MAX(consecutive_failures) AS consecutive_failures,
              SUM(CASE WHEN unit_kind IN ('root', 'page') AND unit_key != 'meta' THEN COALESCE(last_item_count, 0) ELSE 0 END) AS items,
              (SELECT s2.last_error FROM source_state s2 WHERE s2.source_id = s.source_id AND s2.last_error IS NOT NULL ORDER BY s2.last_failure_at DESC LIMIT 1) AS last_error,
              COUNT(*) AS units
       FROM source_state s GROUP BY source_id`,
    )
    .all<{ source_id: string; last_success_at: string | null; last_failure_at: string | null; consecutive_failures: number; items: number; last_error: string | null }>();
  const byId = new Map(rows.results.map((r) => [r.source_id, r]));
  const entries: Array<{ id: string; label: string; kind: SourceHealth['kind']; enabled: boolean }> = [
    ...cfg.sources.map((s) => ({ id: s.id, label: s.label, kind: s.role, enabled: s.enabled })),
    ...cfg.retailers.map((r) => ({ id: r.id, label: r.name, kind: 'shop' as const, enabled: r.enabled })),
  ];
  return entries.map((e) => {
    const r = byId.get(e.id);
    const failures = r?.consecutive_failures ?? 0;
    const status: SourceHealth['status'] = !r ? 'never_run' : failures >= 2 ? 'failing' : failures === 1 ? 'degraded' : 'ok';
    return {
      ...e,
      lastSuccessAt: r?.last_success_at ?? null,
      lastFailureAt: r?.last_failure_at ?? null,
      lastError: r?.last_error ?? null,
      consecutiveFailures: failures,
      itemCount: r?.items ?? 0,
      status,
    };
  });
}
