import type { RulesConfig } from '../../shared/config/schema.ts';
import { convertMinor, median } from '../ingest/util.ts';
import { dropInstant } from '../time.ts';

/**
 * Hourly housekeeping:
 * - drops whose time has come become "live" (an event the alerting reads), and "past" 3 days later;
 * - products without an RRP get an estimated one: the median of the first price each shop listed,
 *   in GBP, once at least `min_retailers` shops have listed it.
 */
export async function runMaintenance(db: D1Database, rules: RulesConfig, now: Date): Promise<{ wentLive: number; estimated: number }> {
  const ts = now.toISOString();
  const writes: D1PreparedStatement[] = [];

  const open = await db
    .prepare(`SELECT id, release_id, starts_at, precision, status, created_at FROM drops WHERE status IN ('upcoming', 'live') AND starts_at IS NOT NULL AND starts_at <= ?`)
    // Day-precision dates go live at Gibraltar midnight, up to a day before the UTC date: widen
    // the coarse SQL filter by a day and decide exactly below.
    .bind(new Date(now.getTime() + 86400_000).toISOString())
    .all<{ id: string; release_id: string; starts_at: string; precision: string; status: string; created_at: string }>();
  let wentLive = 0;
  for (const d of open.results) {
    const at = dropInstant(d.starts_at, d.precision, rules.owner.timezone);
    if (!at || at > now) continue;
    // Month- or week-precision dates are windows, not moments: they never "go live" by the clock.
    if (d.precision !== 'day' && d.precision !== 'time') continue;
    const stale = now.getTime() - at.getTime() > 3 * 86400_000;
    if (d.status === 'upcoming') {
      // An old date seen for the first time (a back catalogue row) goes straight to "past".
      writes.push(db.prepare(`UPDATE drops SET status = ?, updated_at = ? WHERE id = ?`).bind(stale ? 'past' : 'live', ts, d.id));
      // Only a drop we knew about before it went live raises the event: a release first seen
      // after its date (an old calendar row, back stock) must never trigger a "live now" alert.
      if (Date.parse(d.created_at) <= at.getTime()) {
        wentLive += 1;
        writes.push(
          db.prepare('INSERT INTO events (type, drop_id, release_id, payload, created_at) VALUES (?, ?, ?, ?, ?)').bind('went_live', d.id, d.release_id, JSON.stringify({ starts_at: d.starts_at }), ts),
        );
      }
    } else if (stale) {
      writes.push(db.prepare(`UPDATE drops SET status = 'past', updated_at = ? WHERE id = ?`).bind(ts, d.id));
    }
  }

  // Estimated RRPs.
  const fxRow = await db.prepare('SELECT date FROM fx_rates ORDER BY date DESC LIMIT 1').first<{ date: string }>();
  const rates: Record<string, number> = { EUR: 1 };
  if (fxRow) {
    for (const r of (await db.prepare('SELECT currency, rate FROM fx_rates WHERE date = ?').bind(fxRow.date).all<{ currency: string; rate: number }>()).results) rates[r.currency] = r.rate;
  }
  const firsts = await db
    .prepare(
      `SELECT p.id AS product_id, l.retailer_id, pe.price_minor, pe.currency FROM products p
       JOIN listings l ON l.product_id = p.id
       JOIN price_events pe ON pe.id = (SELECT MIN(id) FROM price_events WHERE listing_id = l.id)
       WHERE p.rrp_minor IS NULL`,
    )
    .all<{ product_id: string; retailer_id: string; price_minor: number; currency: string }>();
  const byProduct = new Map<string, Map<string, number>>();
  for (const f of firsts.results) {
    const gbp = convertMinor(f.price_minor, f.currency, 'GBP', rates);
    if (gbp === null) continue;
    const m = byProduct.get(f.product_id) ?? new Map<string, number>();
    // One price per shop: the cheapest first price among its variants.
    m.set(f.retailer_id, Math.min(m.get(f.retailer_id) ?? Infinity, gbp));
    byProduct.set(f.product_id, m);
  }
  let estimated = 0;
  for (const [productId, perShop] of byProduct) {
    if (perShop.size < rules.rrp.estimate.min_retailers) continue;
    const m = median([...perShop.values()]);
    if (m === null) continue;
    estimated += 1;
    writes.push(db.prepare(`UPDATE products SET rrp_minor = ?, rrp_currency = 'GBP', rrp_source = 'estimated', updated_at = ? WHERE id = ? AND rrp_minor IS NULL`).bind(m, ts, productId));
  }

  if (writes.length) await db.batch(writes);
  return { wentLive, estimated };
}
