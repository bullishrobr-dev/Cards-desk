import type { RulesConfig, ShipFlag } from '../../shared/config/schema.ts';
import type { DeskScore, RrpSource } from '../../shared/api-types.ts';
import { placeholders } from '../ingest/util.ts';
import { deskScore, type ScoreInput, type ScoreProduct } from './desk-score.ts';

const CHUNK = 90;

/** Runs one IN-query per chunk of ids (D1 caps bound parameters at 100). */
async function inChunks<T>(db: D1Database, ids: string[], sql: (ph: string) => string, lead: unknown[] = []): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const res = await db.prepare(sql(placeholders(chunk.length))).bind(...lead, ...chunk).all<T>();
    out.push(...res.results);
  }
  return out;
}

const parseList = (json: string | null): string[] => {
  try {
    const v = JSON.parse(json ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

export interface OwnerMarks {
  tags: Map<string, string[]>;
  overrides: Map<string, { score: number; note: string | null }>;
}

/**
 * Builds the Desk Score input for each release: the release's tier, players and scarcity, its
 * box types with RRPs (the owner's RRP wins), live listings with the shop's GI/ES flags, and
 * the owner's tags and override. Five reads per chunk of 90 releases.
 */
export async function loadScoreInputs(db: D1Database, releaseIds: string[], ownerId: string): Promise<{ inputs: Map<string, ScoreInput>; marks: OwnerMarks }> {
  const ids = [...new Set(releaseIds)];
  const inputs = new Map<string, ScoreInput>();
  const marks: OwnerMarks = { tags: new Map(), overrides: new Map() };
  if (!ids.length) return { inputs, marks };

  const [releases, products, listings, tags, overrides] = await Promise.all([
    inChunks<{ id: string; category: string; publisher: string | null; line: string | null; tier: string | null; tier_points_pct: number; players: string | null; scarcity: string | null; rookies: string | null }>(
      db,
      ids,
      (ph) => `SELECT id, category, publisher, line, tier, tier_points_pct, players, scarcity, rookies FROM releases WHERE id IN (${ph})`,
    ),
    inChunks<{ id: string; release_id: string; configuration: string; rrp_minor: number | null; rrp_currency: string | null; rrp_source: 'config' | 'published' | 'estimated' | null; own_minor: number | null; own_currency: string | null }>(
      db,
      ids,
      (ph) =>
        `SELECT p.id, p.release_id, p.configuration, p.rrp_minor, p.rrp_currency, p.rrp_source, o.rrp_minor AS own_minor, o.currency AS own_currency
         FROM products p LEFT JOIN rrp_overrides o ON o.product_id = p.id AND o.owner_id = ?
         WHERE p.release_id IN (${ph})`,
      [ownerId],
    ),
    inChunks<{ product_id: string; price_minor: number | null; currency: string; available: number; is_preorder: number; purchase_limit: number | null; scarcity: string | null; retailer: string; ships_gi: ShipFlag; ships_es: ShipFlag }>(
      db,
      ids,
      (ph) =>
        `SELECT l.product_id, l.price_minor, l.currency, l.available, l.is_preorder, l.purchase_limit, l.scarcity, ret.name AS retailer, ret.ships_gi, ret.ships_es
         FROM listings l JOIN products p ON p.id = l.product_id JOIN retailers ret ON ret.id = l.retailer_id
         WHERE l.gone_at IS NULL AND p.release_id IN (${ph})`,
    ),
    inChunks<{ release_id: string; tag: string }>(db, ids, (ph) => `SELECT release_id, tag FROM manual_tags WHERE owner_id = ? AND release_id IN (${ph}) ORDER BY created_at`, [ownerId]),
    inChunks<{ release_id: string; score: number; note: string | null }>(db, ids, (ph) => `SELECT release_id, score, note FROM score_overrides WHERE owner_id = ? AND release_id IN (${ph})`, [ownerId]),
  ]);

  for (const t of tags) marks.tags.set(t.release_id, [...(marks.tags.get(t.release_id) ?? []), t.tag]);
  for (const o of overrides) marks.overrides.set(o.release_id, { score: o.score, note: o.note });

  const productsByRelease = new Map<string, Array<ScoreProduct & { id: string }>>();
  const productById = new Map<string, ScoreProduct>();
  for (const p of products) {
    const own = p.own_minor !== null && p.own_currency !== null;
    const sp: ScoreProduct & { id: string } = {
      id: p.id,
      configuration: p.configuration,
      rrpMinor: own ? p.own_minor : p.rrp_minor,
      rrpCurrency: own ? p.own_currency : p.rrp_currency,
      rrpSource: own ? ('owner' satisfies RrpSource) : p.rrp_source,
      listings: [],
    };
    productById.set(p.id, sp);
    productsByRelease.set(p.release_id, [...(productsByRelease.get(p.release_id) ?? []), sp]);
  }
  const listingScarcity = new Map<ScoreProduct, string[]>();
  for (const l of listings) {
    const p = productById.get(l.product_id);
    if (!p) continue;
    p.listings.push({
      priceMinor: l.price_minor,
      currency: l.currency,
      available: Boolean(l.available),
      isPreorder: Boolean(l.is_preorder),
      shipsGi: l.ships_gi,
      shipsEs: l.ships_es,
      purchaseLimit: l.purchase_limit,
      retailer: l.retailer,
    });
    listingScarcity.set(p, [...(listingScarcity.get(p) ?? []), ...parseList(l.scarcity)]);
  }

  for (const r of releases) {
    const prods = productsByRelease.get(r.id) ?? [];
    const scarcity = new Set([...parseList(r.scarcity), ...prods.flatMap((p) => listingScarcity.get(p) ?? [])]);
    inputs.set(r.id, {
      category: r.category,
      publisher: r.publisher,
      line: r.line,
      tier: r.tier,
      tierPointsPct: r.tier_points_pct,
      scarcity: [...scarcity],
      players: parseList(r.players),
      rookies: parseList(r.rookies),
      products: prods.map(({ id: _id, ...p }) => p),
      manualTags: marks.tags.get(r.id) ?? [],
      override: marks.overrides.get(r.id) ?? null,
    });
  }
  return { inputs, marks };
}

/** Desk Scores for a set of releases, keyed by release id. */
export async function scoreReleases(db: D1Database, rules: RulesConfig, rates: Record<string, number>, releaseIds: string[], ownerId: string): Promise<Map<string, DeskScore>> {
  const { inputs } = await loadScoreInputs(db, releaseIds, ownerId);
  return new Map([...inputs].map(([id, input]) => [id, deskScore(input, rules, rates)]));
}
