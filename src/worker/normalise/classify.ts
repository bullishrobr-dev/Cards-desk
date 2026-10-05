import type { RulesConfig } from '../../shared/config/schema.ts';
import { createNormaliser, singular, type Normaliser } from './text.ts';

export interface ClassifyInput {
  title: string;
  variantTitle?: string | null;
  productType?: string | null;
  tags?: string[];
  vendor?: string | null;
}

export interface ClassifyContext {
  /** Categories this source can produce (from config/sources.yaml). */
  categories: string[];
  /** Shop-specific markers that confirm English-language stock. */
  englishMarkers?: string[];
}

export interface Classification {
  category: string | null;
  publisher: string | null;
  season: string | null;
  configuration: string | null;
  line: string | null;
  tier: string | null;
  tierPointsPct: number;
  excludedRule: string | null;
  scarcity: string[];
  players: string[];
  /** Tokens that identify the release (no publisher, season, box type or noise). */
  subject: string[];
}

interface CompiledCategory {
  id: string;
  match: string[];
  matchTaxonomy: string[];
  exclude: Array<{ rule: string; keywords: string[] }>;
  publishers: Array<{ id: string; aliases: string[] }>;
  tiers: Array<{ tier: string; pct: number; lines: string[] }>;
  configurations: Array<{ id: string; keywords: string[] }>;
}

export interface Classifier {
  classify(input: ClassifyInput, ctx: ClassifyContext): Classification;
  normaliser: Normaliser;
}

export function createClassifier(rules: RulesConfig): Classifier {
  const n = createNormaliser(rules.normalise.synonyms);
  const kw = (list: string[]) => list.map((k) => n.keyword(k)).filter(Boolean);
  const noise = new Set(kw(rules.normalise.noise).flatMap((k) => k.split(' ')));
  const globalExclude = rules.global_exclude.map((r) => ({ rule: r.rule, keywords: kw(r.keywords) }));

  const categories = new Map<string, CompiledCategory>();
  for (const [id, c] of Object.entries(rules.categories)) {
    if (!c.enabled) continue;
    categories.set(id, {
      id,
      match: kw(c.match),
      matchTaxonomy: kw(c.match_taxonomy),
      exclude: c.exclude.map((e) => ({ rule: e.rule, keywords: kw(e.keywords) })),
      publishers: c.publishers.map((p) => ({ id: p, aliases: kw(rules.publishers[p]?.aliases ?? [p]) })),
      tiers: c.tiers.map((t) => ({ tier: t.tier, pct: t.points_pct, lines: kw(t.lines) })),
      configurations: c.configurations.map((cfg) => ({ id: cfg.id, keywords: kw(cfg.keywords) })),
    });
  }
  const scarcity = rules.scarcity.signals.map((s) => ({ id: s.id, keywords: kw(s.keywords) }));
  const players = rules.relevance.watchlist_players.map((p) => ({ name: p, key: n.keyword(p) }));

  function classify(input: ClassifyInput, ctx: ClassifyContext): Classification {
    const titleText = n.text(input.title);
    const main = n.text([input.title, input.variantTitle ?? '', input.productType ?? ''].join(' '));
    const taxonomy = n.text([input.productType ?? '', ...(input.tags ?? []), input.vendor ?? ''].join(' '));

    const empty: Classification = {
      category: null, publisher: null, season: null, configuration: null, line: null, tier: null,
      tierPointsPct: 0, excludedRule: null, scarcity: [], players: [], subject: [],
    };

    // 1. Category: the allowed category with the most keyword hits.
    let best: { c: CompiledCategory; hits: number } | null = null;
    for (const id of ctx.categories) {
      const c = categories.get(id);
      if (!c) continue;
      const hits = c.match.filter((k) => n.has(main, k)).length + c.matchTaxonomy.filter((k) => n.has(taxonomy, k)).length;
      if (hits > 0 && (!best || hits > best.hits)) best = { c, hits };
    }
    if (!best) return empty;
    const cat = best.c;

    // 2. Exclusions: global first, then the category's own.
    let excludedRule: string | null = null;
    for (const r of [...globalExclude, ...cat.exclude]) {
      if (r.keywords.some((k) => n.has(main, k))) {
        excludedRule = r.rule;
        break;
      }
    }
    if (!excludedRule && ctx.englishMarkers?.length) {
      const markers = kw(ctx.englishMarkers);
      if (!markers.some((m) => n.has(main, m))) excludedRule = 'Not confirmed English-language';
    }

    // 3. Publisher: an alias in the title or vendor; a single-publisher category defaults to it.
    const vendorText = n.text(input.vendor ?? '');
    let publisher = cat.publishers.find((p) => p.aliases.some((a) => n.has(main, a) || n.has(vendorText, a)))?.id ?? null;
    if (!publisher && cat.publishers.length === 1) publisher = cat.publishers[0]?.id ?? null;
    if (!publisher && !excludedRule) excludedRule = 'Publisher not in scope';

    // 4. Season: "2025-26" or a bare year.
    const season = titleText.match(/\b20\d\d-\d\d\b/)?.[0] ?? titleText.match(/\b20\d\d\b/)?.[0] ?? null;

    // 5. Configuration: first listed (strongest) whose keyword appears.
    let configuration: string | null = null;
    let configPhrase: string | null = null;
    for (const cfg of cat.configurations) {
      const hit = cfg.keywords.find((k) => n.has(main, k));
      if (hit) {
        configuration = cfg.id;
        configPhrase = hit;
        break;
      }
    }

    // 6. Line and tier: the longest matching line phrase across all tiers.
    let line: string | null = null;
    let tier: string | null = null;
    let tierPointsPct = 0;
    for (const t of cat.tiers) {
      for (const l of t.lines) {
        if (n.has(titleText, l) && (!line || l.length > line.length)) {
          line = l;
          tier = t.tier;
          tierPointsPct = t.pct;
        }
      }
    }

    // 7. Subject tokens for release matching.
    const drop = new Set<string>(noise);
    for (const p of cat.publishers) for (const a of p.aliases) for (const t of a.split(' ')) drop.add(t);
    if (configPhrase) for (const t of configPhrase.split(' ')) drop.add(t);
    for (const m of ctx.englishMarkers ?? []) for (const t of n.keyword(m).split(' ')) drop.add(t);
    const subject = [
      ...new Set(
        titleText
          .split(' ')
          .filter((t) => t && !drop.has(t) && !/^20\d\d(-\d\d)?$/.test(t) && t !== '#')
          .map(singular),
      ),
    ].sort();

    return {
      category: cat.id,
      publisher,
      season,
      configuration,
      line,
      tier,
      tierPointsPct,
      excludedRule,
      scarcity: scarcity.filter((s) => s.keywords.some((k) => n.has(main, k))).map((s) => s.id),
      players: players.filter((p) => n.has(main, p.key)).map((p) => p.name),
      subject,
    };
  }

  return { classify, normaliser: n };
}
