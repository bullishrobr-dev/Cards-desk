import type { RulesConfig, ShipFlag } from '../../shared/config/schema.ts';
import type { DeskScore, GateResult, RrpSource, ScoreComponent } from '../../shared/api-types.ts';
import { convertMinor } from '../ingest/util.ts';

/**
 * Desk Score: the owner's buying rules, enforced and explained.
 *
 * Hard gates (a failing drop is greyed out and never alerts unless watched):
 *   1. in scope: category enabled, publisher in scope, product line not excluded;
 *   2. purchasable to Gibraltar or Spain ("unknown" passes but is flagged);
 *   3. sealed price at or below RRP × tolerance ("Above RRP — buy singles instead").
 *
 * Score 0–100 from per-category weights: product tier, box configuration, scarcity, relevance.
 * Every point carries a reason. A drop scores as its best box type. An owner override replaces
 * the number (the breakdown still shows what the rules said).
 */

export interface ScoreListing {
  priceMinor: number | null;
  currency: string;
  available: boolean;
  isPreorder: boolean;
  shipsGi: ShipFlag;
  shipsEs: ShipFlag;
  purchaseLimit: number | null;
  /** Shop name, used to say where the best price is. */
  retailer?: string;
}

export interface ScoreProduct {
  configuration: string;
  rrpMinor: number | null;
  rrpCurrency: string | null;
  rrpSource: RrpSource | null;
  listings: ScoreListing[];
}

export interface ScoreInput {
  category: string;
  publisher: string | null;
  line: string | null;
  tier: string | null;
  tierPointsPct: number;
  scarcity: string[];
  players: string[];
  products: ScoreProduct[];
  manualTags: string[];
  override: { score: number; note: string | null } | null;
}

const round = (n: number) => Math.round(n * 10) / 10;

export function labelFor(score: number, rules: RulesConfig): DeskScore['label'] {
  if (score >= rules.labels.priority_min) return 'Priority';
  if (score >= rules.labels.watch_min) return 'Watch';
  return 'Ignore';
}

export function deskScore(input: ScoreInput, rules: RulesConfig, rates: Record<string, number>): DeskScore {
  const cat = rules.categories[input.category];
  const gates: GateResult[] = [];

  // Gate 1: scope.
  const publisherOk = input.publisher !== null && (cat?.publishers.includes(input.publisher) ?? false);
  gates.push({
    id: 'scope',
    pass: Boolean(cat?.enabled) && publisherOk,
    flagged: false,
    label: 'In scope',
    detail: !cat?.enabled
      ? `${input.category} is switched off in the rules`
      : !publisherOk
        ? 'Publisher is not in scope for this category'
        : `${cat.label}, ${rules.publishers[input.publisher ?? '']?.label ?? input.publisher}${input.line ? `, ${input.line}` : ''}`,
  });

  // Gate 2: purchasable to Gibraltar or Spain.
  const allListings = input.products.flatMap((p) => p.listings);
  const shipsYes = allListings.some((l) => l.shipsGi === 'yes' || l.shipsEs === 'yes');
  const shipsUnknown = allListings.some((l) => l.shipsGi === 'unknown' || l.shipsEs === 'unknown');
  const giYes = allListings.some((l) => l.shipsGi === 'yes');
  if (allListings.length === 0) {
    gates.push({ id: 'purchasable', pass: true, flagged: true, label: 'Ships to you', detail: 'No shop lists it yet' });
  } else if (shipsYes) {
    gates.push({ id: 'purchasable', pass: true, flagged: false, label: 'Ships to you', detail: giYes ? 'At least one shop ships to Gibraltar' : 'Ships to Spain only (fallback address)' });
  } else if (shipsUnknown) {
    gates.push({ id: 'purchasable', pass: true, flagged: true, label: 'Ships to you', detail: 'Shipping to Gibraltar/Spain is unverified for the shops that list it' });
  } else {
    gates.push({ id: 'purchasable', pass: false, flagged: false, label: 'Ships to you', detail: 'None of the shops that list it ship to Gibraltar or Spain' });
  }

  // Gate 3: price vs RRP, on the cheapest price you can act on at a shop that can ship to you.
  const tolerance = rules.rrp.tolerance;
  let bestRatio: number | null = null;
  let bestAt: ScoreListing | null = null;
  let anyPriced = false;
  for (const p of input.products) {
    if (p.rrpMinor === null || !p.rrpCurrency) continue;
    for (const l of p.listings) {
      if (l.priceMinor === null || (l.shipsGi === 'no' && l.shipsEs === 'no')) continue;
      const rrp = convertMinor(p.rrpMinor, p.rrpCurrency, l.currency, rates);
      if (!rrp) continue;
      anyPriced = true;
      const ratio = l.priceMinor / rrp;
      if (bestRatio === null || ratio < bestRatio) {
        bestRatio = ratio;
        bestAt = l;
      }
    }
  }
  if (!anyPriced || bestRatio === null) {
    gates.push({ id: 'price', pass: true, flagged: true, label: 'At or below RRP', detail: 'No price against a known RRP yet' });
  } else if (bestRatio <= tolerance) {
    const pct = Math.round((bestRatio - 1) * 100);
    const vs = pct < 0 ? `${-pct}% under RRP` : pct === 0 ? 'matches RRP' : `${pct}% over RRP, within tolerance`;
    const where = bestAt?.retailer ? ` at ${bestAt.retailer}${bestAt.shipsGi !== 'yes' && bestAt.shipsEs === 'yes' ? ', Spain address only' : ''}` : '';
    gates.push({ id: 'price', pass: true, flagged: false, label: 'At or below RRP', detail: `At RRP — fine to rip for fun (best price ${vs}${where})` });
  } else {
    gates.push({ id: 'price', pass: false, flagged: false, label: 'At or below RRP', detail: `Above RRP — buy singles instead (cheapest is ${Math.round((bestRatio - 1) * 100)}% over)` });
  }

  // Score.
  const w = cat?.weights ?? { tier: 40, configuration: 20, scarcity: 20, relevance: 20 };
  const breakdown: ScoreComponent[] = [];

  const multiplier = input.publisher ? (rules.publishers[input.publisher]?.tier_multiplier ?? 1) : 1;
  const tierPts = round((w.tier * input.tierPointsPct * multiplier) / 100);
  breakdown.push({
    id: 'tier',
    label: 'Product tier',
    points: Math.min(tierPts, w.tier),
    max: w.tier,
    reason: input.tier
      ? `${input.tier} line (${input.line}): ${input.tierPointsPct}%${multiplier !== 1 ? ` × ${multiplier} publisher weight` : ''}`
      : 'No listed product line recognised',
  });

  // Configuration: the best box type on offer.
  let bestCfg: { id: string; label: string; pct: number } | null = null;
  for (const p of input.products) {
    const cfg = cat?.configurations.find((c) => c.id === p.configuration);
    if (cfg && (!bestCfg || cfg.points_pct > bestCfg.pct)) bestCfg = { id: cfg.id, label: cfg.label, pct: cfg.points_pct };
  }
  breakdown.push({
    id: 'configuration',
    label: 'Box configuration',
    points: bestCfg ? round((w.configuration * bestCfg.pct) / 100) : 0,
    max: w.configuration,
    reason: bestCfg ? `${bestCfg.label}: ${bestCfg.pct}%` : input.products.length ? 'Box type not recognised' : 'No box types listed yet',
  });

  // Scarcity: title signals plus purchase limits seen at shops; capped at 100%.
  const signals = new Set(input.scarcity);
  if (allListings.some((l) => l.purchaseLimit !== null)) signals.add('purchase_limit');
  const hits = rules.scarcity.signals.filter((s) => signals.has(s.id));
  const scarcityPct = Math.min(100, hits.reduce((t, s) => t + s.points_pct, 0));
  breakdown.push({
    id: 'scarcity',
    label: 'Scarcity',
    points: round((w.scarcity * scarcityPct) / 100),
    max: w.scarcity,
    reason: hits.length ? hits.map((s) => `${s.label} (${s.points_pct}%)`).join(', ') : 'No scarcity signal',
  });

  // Relevance: watchlist players in the release, and the owner's manual tags.
  const rel: string[] = [];
  let relPct = 0;
  if (input.players.length) {
    relPct = Math.max(relPct, rules.relevance.watchlist_player_points_pct);
    rel.push(`Watchlist player: ${input.players.join(', ')}`);
  }
  if (input.manualTags.length) {
    relPct = Math.max(relPct, rules.relevance.manual_tag_points_pct);
    rel.push(`Your tag: ${input.manualTags.join(', ')}`);
  }
  breakdown.push({
    id: 'relevance',
    label: 'Relevance',
    points: round((w.relevance * Math.min(100, relPct)) / 100),
    max: w.relevance,
    reason: rel.length ? rel.join('; ') : 'No watchlist player or tag yet (checklists arrive in Phase 3)',
  });

  const rawScore = Math.round(breakdown.reduce((t, c) => t + c.points, 0));
  const score = input.override ? input.override.score : rawScore;
  return {
    score,
    rawScore,
    label: labelFor(score, rules),
    gated: gates.some((g) => !g.pass),
    gates,
    breakdown,
    overridden: input.override !== null,
    overrideNote: input.override?.note ?? null,
  };
}
