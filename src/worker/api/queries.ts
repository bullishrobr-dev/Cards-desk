import type { RulesConfig, SourcesConfig } from '../../shared/config/schema.ts';
import type { Confidence, DeskScore, DropDetail, DropSummary, ListingHistoryPoint, ListingView, MarketView, Money, Precision, ProductView, RrpSource, ShipFlag, SourceHealth } from '../../shared/api-types.ts';
import { convertMinor, placeholders } from '../ingest/util.ts';
import { addMinutes, dropInstant, localDate } from '../time.ts';
import { loadScoreInputs } from '../score/load.ts';
import { deskScore } from '../score/desk-score.ts';

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
  image_url: string | null;
  product_image_url: string | null;
}

const DROP_COLUMNS = `d.id, d.release_id, r.name, r.category, r.publisher, r.season, r.tier, d.starts_at, d.precision, d.confidence, d.status`;

async function listingsFor(db: D1Database, releaseIds: string[]): Promise<ListingRow[]> {
  const out: ListingRow[] = [];
  for (let i = 0; i < releaseIds.length; i += 90) {
    const chunk = releaseIds.slice(i, i + 90);
    const res = await db
      .prepare(
        `SELECT l.id, p.release_id, p.id AS product_id, p.configuration, p.rrp_minor, p.rrp_currency, l.price_minor, l.currency,
                l.available, l.is_preorder, ret.id AS retailer_id, ret.name AS retailer, ret.ships_gi, ret.ships_es,
                l.image_url, p.image_url AS product_image_url
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

/** The owner's view of a set of drops: Desk Scores, pins, watched releases and tags. */
interface OwnerView {
  desk: Map<string, DeskScore>;
  /** Release photo from its box types (collectosk), best box type first. */
  images: Map<string, string>;
  tags: Map<string, string[]>;
  pinned: Set<string>;
  watched: Set<string>;
}

async function ownerView(db: D1Database, rules: RulesConfig, rates: Rates, releaseIds: string[], ownerId: string): Promise<OwnerView> {
  const [{ inputs, marks }, pins, watch, images] = await Promise.all([
    loadScoreInputs(db, releaseIds, ownerId),
    db.prepare('SELECT drop_id FROM pins WHERE owner_id = ?').bind(ownerId).all<{ drop_id: string }>(),
    db.prepare(`SELECT target_id FROM watchlist WHERE owner_id = ? AND target_type = 'release'`).bind(ownerId).all<{ target_id: string }>(),
    releaseImages(db, releaseIds, rules),
  ]);
  return {
    desk: new Map([...inputs].map(([id, input]) => [id, deskScore(input, rules, rates)])),
    images,
    tags: marks.tags,
    pinned: new Set(pins.results.map((p) => p.drop_id)),
    watched: new Set(watch.results.map((w) => w.target_id)),
  };
}

/** One photo per release from its box types, preferring the highest-scoring box (hobby, booster box). */
async function releaseImages(db: D1Database, releaseIds: string[], rules: RulesConfig): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const rank = new Map<string, number>();
  for (const c of Object.values(rules.categories)) for (const cfg of c.configurations) rank.set(cfg.id, Math.max(rank.get(cfg.id) ?? 0, cfg.points_pct));
  const best = new Map<string, number>();
  for (let i = 0; i < releaseIds.length; i += 90) {
    const chunk = releaseIds.slice(i, i + 90);
    const rows = await db
      .prepare(`SELECT release_id, configuration, image_url FROM products WHERE image_url IS NOT NULL AND release_id IN (${placeholders(chunk.length)})`)
      .bind(...chunk)
      .all<{ release_id: string; configuration: string; image_url: string }>();
    for (const r of rows.results) {
      const score = rank.get(r.configuration) ?? 0;
      if (score > (best.get(r.release_id) ?? -1)) {
        best.set(r.release_id, score);
        out.set(r.release_id, r.image_url);
      }
    }
  }
  return out;
}

const NO_SCORE: DeskScore = { score: 0, rawScore: 0, label: 'Ignore', gated: false, gates: [], breakdown: [], overridden: false, overrideNote: null };

function summarise(d: DropRow, listings: ListingRow[], region: 'gi' | 'es' | null, rates: Rates, tz: string, view: OwnerView): DropSummary {
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
    desk: view.desk.get(d.release_id) ?? NO_SCORE,
    imageUrl: view.images.get(d.release_id) ?? mine.find((l) => l.image_url)?.image_url ?? null,
    pinned: view.pinned.has(d.id),
    watched: view.watched.has(d.release_id),
  };
}

export interface DropQuery {
  view: 'upcoming' | 'live' | 'watchlist';
  category: string | null;
  region: 'gi' | 'es' | null;
  /** Keep only these Desk Score labels. */
  labels?: Array<DeskScore['label']> | null;
}

/**
 * Upcoming: dated drops in the next 120 days, then undated (TBD) ones. Live: drops now live.
 * Watchlist: upcoming or live drops you watch or pinned, at any distance. Pins sort first.
 */
export async function listDrops(db: D1Database, rules: RulesConfig, q: DropQuery, now: Date, ownerId: string): Promise<DropSummary[]> {
  const conditions = [`d.kind = 'release'`, q.view === 'live' ? `d.status = 'live'` : q.view === 'upcoming' ? `d.status = 'upcoming'` : `d.status IN ('upcoming', 'live')`];
  const binds: unknown[] = [];
  if (q.view === 'watchlist') {
    conditions.push(`(d.release_id IN (SELECT target_id FROM watchlist WHERE owner_id = ? AND target_type = 'release') OR d.id IN (SELECT drop_id FROM pins WHERE owner_id = ?))`);
    binds.push(ownerId, ownerId);
  }
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
  const releaseIds = rows.results.map((r) => r.release_id);
  const [listings, view] = await Promise.all([listingsFor(db, releaseIds), ownerView(db, rules, rates, releaseIds, ownerId)]);
  let out = rows.results.map((d) => summarise(d, listings, q.region, rates, rules.owner.timezone, view));
  // A region filter keeps drops buyable there, plus calendar-only drops with no shop listing yet.
  if (q.region) out = out.filter((d) => d.shopCount === 0 || (q.region === 'gi' ? d.shipsGi : d.shipsEs) || d.bestPrice !== null);
  if (q.labels?.length) out = out.filter((d) => q.labels?.includes(d.desk.label));
  // Pinned first; otherwise the date order from the query is kept (sort is stable).
  return out.sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

export async function dropDetail(db: D1Database, rules: RulesConfig, cfg: SourcesConfig, id: string, ownerId: string): Promise<DropDetail | null> {
  const d = await db.prepare(`SELECT ${DROP_COLUMNS} FROM drops d JOIN releases r ON r.id = d.release_id WHERE d.id = ?`).bind(id).first<DropRow>();
  if (!d) return null;
  const rates = await latestRates(db);
  const [obs, hist, listingRows, products] = await Promise.all([
    db.prepare('SELECT source_id, starts_at, precision, confidence, raw, region, last_seen_at FROM drop_observations WHERE drop_id = ? ORDER BY precedence, source_id').bind(id).all<{ source_id: string; starts_at: string | null; precision: Precision; confidence: Confidence; raw: string | null; region: string | null; last_seen_at: string }>(),
    db.prepare('SELECT changed_at, old_starts_at, new_starts_at, old_confidence, new_confidence, source_id FROM drop_date_history WHERE drop_id = ? ORDER BY id').bind(id).all<{ changed_at: string; old_starts_at: string | null; new_starts_at: string | null; old_confidence: string | null; new_confidence: string; source_id: string }>(),
    db
      .prepare(
        `SELECT l.id, l.product_id, l.url, l.raw_title, l.price_minor, l.currency, l.available, l.is_preorder, l.last_changed_at, l.image_url,
                ret.id AS retailer_id, ret.name AS retailer, ret.country, ret.ships_gi, ret.ships_gi_verified_at, ret.ships_gi_note,
                ret.ships_es, ret.ships_es_verified_at, ret.ships_es_note
         FROM listings l JOIN products p ON p.id = l.product_id JOIN retailers ret ON ret.id = l.retailer_id
         WHERE p.release_id = ? AND l.gone_at IS NULL ORDER BY ret.ships_gi = 'yes' DESC, l.price_minor`,
      )
      .bind(d.release_id)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT p.id, p.configuration, p.name, p.image_url, COALESCE(o.rrp_minor, p.rrp_minor) AS rrp_minor, COALESCE(o.currency, p.rrp_currency) AS rrp_currency,
                CASE WHEN o.rrp_minor IS NOT NULL THEN 'owner' ELSE p.rrp_source END AS rrp_source
         FROM products p LEFT JOIN rrp_overrides o ON o.product_id = p.id AND o.owner_id = ?
         WHERE p.release_id = ?`,
      )
      .bind(ownerId, d.release_id)
      .all<{ id: string; configuration: string; name: string; image_url: string | null; rrp_minor: number | null; rrp_currency: string | null; rrp_source: RrpSource | null }>(),
  ]);
  const labels = new Map([...cfg.sources.map((s) => [s.id, s.label] as const), ...cfg.retailers.map((r) => [r.id, r.name] as const)]);
  const history = await listingHistory(db, listingRows.results.map((l) => l.id as string));
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
        history: history.get(l.id as string) ?? [],
        imageUrl: (l.image_url as string | null) ?? null,
      }));
    return {
      id: p.id,
      configuration: p.configuration,
      configurationLabel: configLabel(p.configuration),
      name: p.name,
      rrp: p.rrp_minor !== null && p.rrp_currency && p.rrp_source ? { ...money(p.rrp_minor, p.rrp_currency, rates), source: p.rrp_source } : null,
      imageUrl: p.image_url ?? listings.find((l) => l.imageUrl)?.imageUrl ?? null,
      listings,
    };
  });

  const [allListings, view, enrich] = await Promise.all([
    listingsFor(db, [d.release_id]),
    ownerView(db, rules, rates, [d.release_id], ownerId),
    db
      .prepare(
        `SELECT r.players, r.rookies, r.checklist_cards, r.enriched_at,
                (SELECT o.url FROM drop_observations o WHERE o.drop_id = ? AND o.source_id = 'collectosk') AS url
         FROM releases r WHERE r.id = ?`,
      )
      .bind(id, d.release_id)
      .first<{ players: string | null; rookies: string | null; checklist_cards: number | null; enriched_at: string | null; url: string | null }>(),
  ]);
  const list = (j: string | null | undefined): string[] => {
    try {
      const v = JSON.parse(j ?? '[]') as unknown;
      return Array.isArray(v) ? (v as string[]) : [];
    } catch {
      return [];
    }
  };
  const market = await marketFor(db, d.release_id, productViews, rates, configLabel);
  return {
    ...summarise(d, allListings, null, rates, rules.owner.timezone, view),
    market,
    tags: view.tags.get(d.release_id) ?? [],
    checklist: enrich?.enriched_at
      ? { cards: enrich.checklist_cards, rookies: list(enrich.rookies), players: list(enrich.players), readAt: enrich.enriched_at, url: enrich.url }
      : null,
    observations: obs.results.map((o) => ({ sourceId: o.source_id, sourceLabel: labels.get(o.source_id) ?? o.source_id, startsAt: o.starts_at, precision: o.precision, confidence: o.confidence, raw: o.raw, region: o.region, lastSeenAt: o.last_seen_at })),
    history: hist.results.map((h) => ({ changedAt: h.changed_at, oldStartsAt: h.old_starts_at, newStartsAt: h.new_starts_at, oldConfidence: h.old_confidence, newConfidence: h.new_confidence, sourceId: h.source_id })),
    products: productViews,
    costNotes: rules.cost_notes.map((n) => ({ region: n.applies_to.region, from: n.applies_to.from, text: n.text, source: n.source })),
  };
}

/** Cardmarket prices for a release, per box type, with up to 90 days of history. Two reads. */
async function marketFor(db: D1Database, releaseId: string, products: ProductView[], rates: Rates, configLabel: (c: string) => string): Promise<MarketView[]> {
  const rows = (
    await db
      .prepare(`SELECT external_id, name, configuration, currency, low_minor, trend_minor, avg_minor, as_of FROM market_prices WHERE release_id = ? AND source = 'cardmarket' ORDER BY configuration`)
      .bind(releaseId)
      .all<{ external_id: string; name: string; configuration: string; currency: string; low_minor: number | null; trend_minor: number | null; avg_minor: number | null; as_of: string }>()
  ).results;
  if (!rows.length) return [];
  const hist = (
    await db
      .prepare(`SELECT external_id, date, trend_minor, low_minor FROM market_price_history WHERE source = 'cardmarket' AND external_id IN (${placeholders(rows.length)}) AND date >= ? ORDER BY date`)
      .bind(...rows.map((r) => r.external_id), addMinutes(new Date(), -90 * 1440).toISOString().slice(0, 10))
      .all<{ external_id: string; date: string; trend_minor: number | null; low_minor: number | null }>()
  ).results;
  return rows.map((r) => {
    const rrp = products.find((p) => p.configuration === r.configuration)?.rrp ?? null;
    const m = (v: number | null) => (v === null ? null : money(v, r.currency, rates));
    return {
      source: 'cardmarket' as const,
      name: r.name,
      configuration: r.configuration,
      configurationLabel: configLabel(r.configuration),
      low: m(r.low_minor),
      trend: m(r.trend_minor),
      avg: m(r.avg_minor),
      trendVsRrp: r.trend_minor !== null && rrp ? ratio(r.trend_minor, r.currency, rrp.minor, rrp.currency, rates) : null,
      asOf: r.as_of,
      // Product page URLs are not in the data files and the site is behind a bot check, so a deep
      // link could not be verified: link the home page and show the exact product name.
      url: 'https://www.cardmarket.com/',
      history: hist.filter((h) => h.external_id === r.external_id).map((h) => ({ date: h.date, trendMinor: h.trend_minor, lowMinor: h.low_minor })),
    };
  });
}

const HISTORY_POINTS = 30;

/** Price and stock changes per listing, merged by time; the latest HISTORY_POINTS kept. Two reads. */
async function listingHistory(db: D1Database, listingIds: string[]): Promise<Map<string, ListingHistoryPoint[]>> {
  const out = new Map<string, ListingHistoryPoint[]>();
  for (let i = 0; i < listingIds.length; i += 90) {
    const chunk = listingIds.slice(i, i + 90);
    const ph = placeholders(chunk.length);
    const [prices, stock] = await Promise.all([
      db.prepare(`SELECT listing_id, at, price_minor, ratio_to_rrp FROM price_events WHERE listing_id IN (${ph})`).bind(...chunk).all<{ listing_id: string; at: string; price_minor: number; ratio_to_rrp: number | null }>(),
      db.prepare(`SELECT listing_id, at, available FROM stock_events WHERE listing_id IN (${ph})`).bind(...chunk).all<{ listing_id: string; at: string; available: number }>(),
    ]);
    const merged = new Map<string, Map<string, ListingHistoryPoint>>();
    const point = (id: string, at: string) => {
      const m = merged.get(id) ?? new Map<string, ListingHistoryPoint>();
      merged.set(id, m);
      const p = m.get(at) ?? { at, priceMinor: null, available: null, ratio: null };
      m.set(at, p);
      return p;
    };
    for (const p of prices.results) Object.assign(point(p.listing_id, p.at), { priceMinor: p.price_minor, ratio: p.ratio_to_rrp });
    for (const s of stock.results) point(s.listing_id, s.at).available = Boolean(s.available);
    for (const [id, m] of merged) out.set(id, [...m.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-HISTORY_POINTS));
  }
  return out;
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
