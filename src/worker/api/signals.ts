import type { RulesConfig } from '../../shared/config/schema.ts';
import type { SectorSignals } from '../../shared/api-types.ts';
import { convertMinor, median } from '../ingest/util.ts';
import { formatMinorPlain } from './money-text.ts';
import { latestRates } from './queries.ts';
import { addMinutes } from '../time.ts';

/** A price move worth showing: at least this much up or down from the previous price. */
const MOVE_THRESHOLD = 0.1;
const MAX_MOVES = 40;

interface Transition {
  listing_id: string;
  at: string;
  available: number;
  prev_available: number | null;
  prev_at: string | null;
  first_seen_at: string;
  category: string;
  release: string;
  drop_id: string | null;
  retailer: string;
}

/**
 * Sector signals from the market data captured since day one: how fast in-scope boxes sell
 * out, where listed asking prices sit against RRP (in stock or not), and the recent sell-outs, restocks and price moves.
 * Three reads, aggregated in SQL where the volume is (window functions over the event tables).
 */
export async function sectorSignals(db: D1Database, rules: RulesConfig, now: Date, days: number): Promise<SectorSignals> {
  const since = addMinutes(now, -days * 1440).toISOString();
  const rates = await latestRates(db);
  const [transitions, prices, current] = await Promise.all([
    db
      .prepare(
        `WITH s AS (
           SELECT se.listing_id, se.at, se.available,
                  LAG(se.available) OVER w AS prev_available, LAG(se.at) OVER w AS prev_at
           FROM stock_events se WINDOW w AS (PARTITION BY se.listing_id ORDER BY se.at, se.id)
         )
         SELECT s.listing_id, s.at, s.available, s.prev_available, s.prev_at, l.first_seen_at,
                r.category, r.name AS release, (SELECT d.id FROM drops d WHERE d.release_id = r.id AND d.kind = 'release') AS drop_id, ret.name AS retailer
         FROM s JOIN listings l ON l.id = s.listing_id JOIN products p ON p.id = l.product_id
         JOIN releases r ON r.id = p.release_id JOIN retailers ret ON ret.id = l.retailer_id
         WHERE s.at >= ? AND s.prev_available IS NOT NULL AND s.available != s.prev_available
         ORDER BY s.at DESC`,
      )
      .bind(since)
      .all<Transition>(),
    db
      .prepare(
        `WITH e AS (
           SELECT pe.listing_id, pe.at, pe.price_minor, pe.currency, pe.ratio_to_rrp,
                  LAG(pe.price_minor) OVER (PARTITION BY pe.listing_id ORDER BY pe.at, pe.id) AS prev_price
           FROM price_events pe
         )
         SELECT e.at, e.price_minor, e.prev_price, e.currency, e.ratio_to_rrp, r.name AS release,
                (SELECT d.id FROM drops d WHERE d.release_id = r.id AND d.kind = 'release') AS drop_id, ret.name AS retailer
         FROM e JOIN listings l ON l.id = e.listing_id JOIN products p ON p.id = l.product_id
         JOIN releases r ON r.id = p.release_id JOIN retailers ret ON ret.id = l.retailer_id
         WHERE e.at >= ? AND e.prev_price IS NOT NULL AND e.prev_price > 0
           AND ABS(e.price_minor - e.prev_price) * 1.0 / e.prev_price >= ?
         ORDER BY e.at DESC LIMIT ?`,
      )
      .bind(since, MOVE_THRESHOLD, MAX_MOVES)
      .all<{ at: string; price_minor: number; prev_price: number; currency: string; ratio_to_rrp: number | null; release: string; drop_id: string | null; retailer: string }>(),
    db
      .prepare(
        `SELECT r.category, l.price_minor, l.currency, p.rrp_minor, p.rrp_currency
         FROM listings l JOIN products p ON p.id = l.product_id JOIN releases r ON r.id = p.release_id
         WHERE l.gone_at IS NULL AND l.price_minor IS NOT NULL AND p.rrp_minor IS NOT NULL AND p.rrp_currency IS NOT NULL`,
      )
      .all<{ category: string; price_minor: number; currency: string; rrp_minor: number; rrp_currency: string }>(),
  ]);

  const ratiosByCat = new Map<string, number[]>();
  for (const c of current.results) {
    const rrp = convertMinor(c.rrp_minor, c.rrp_currency, c.currency, rates);
    if (!rrp) continue;
    ratiosByCat.set(c.category, [...(ratiosByCat.get(c.category) ?? []), c.price_minor / rrp]);
  }
  const sellOuts = new Map<string, number[]>();
  for (const t of transitions.results) {
    if (t.available !== 0) continue;
    const from = t.prev_at ?? t.first_seen_at;
    sellOuts.set(t.category, [...(sellOuts.get(t.category) ?? []), (Date.parse(t.at) - Date.parse(from)) / 3_600_000]);
  }
  const tolerance = rules.rrp.tolerance;
  const categories = Object.entries(rules.categories)
    .filter(([, c]) => c.enabled)
    .map(([id, c]) => {
      const ratios = ratiosByCat.get(id) ?? [];
      const hours = sellOuts.get(id) ?? [];
      const m = median(ratios);
      const h = median(hours);
      return {
        category: id,
        label: c.label,
        pricedListings: ratios.length,
        medianRatio: m === null ? null : Math.round(m * 100) / 100,
        aboveTolerance: ratios.length ? Math.round((ratios.filter((r) => r > tolerance).length / ratios.length) * 100) / 100 : null,
        soldOut: hours.length,
        medianHoursToSellOut: h === null ? null : Math.round(h * 10) / 10,
      };
    });

  const moves: SectorSignals['moves'] = [
    ...transitions.results.map((t) => ({
      at: t.at,
      kind: t.available ? ('restock' as const) : ('sold_out' as const),
      dropId: t.drop_id,
      release: t.release,
      retailer: t.retailer,
      detail: t.available ? 'Back in stock' : `Sold out after ${hoursText((Date.parse(t.at) - Date.parse(t.prev_at ?? t.first_seen_at)) / 3_600_000)}`,
    })),
    ...prices.results.map((p) => ({
      at: p.at,
      kind: p.price_minor > p.prev_price ? ('price_up' as const) : ('price_down' as const),
      dropId: p.drop_id,
      release: p.release,
      retailer: p.retailer,
      detail: `${formatMinorPlain(p.prev_price, p.currency)} → ${formatMinorPlain(p.price_minor, p.currency)}${p.ratio_to_rrp ? ` (${p.ratio_to_rrp >= 1 ? '+' : ''}${Math.round((p.ratio_to_rrp - 1) * 100)}% vs RRP)` : ''}`,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_MOVES);

  return { days, categories, moves };
}

function hoursText(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}
