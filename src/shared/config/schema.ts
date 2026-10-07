import { z } from 'zod';

/**
 * Schemas for config/rules.yaml (buying rules) and config/sources.yaml (where data comes from).
 * Both files are parsed and validated at build time by tools/vite-plugin-yaml-config.ts, so an
 * invalid edit fails the build instead of reaching production.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const pct = z.number().min(0).max(100);

export const ShipFlag = z.enum(['yes', 'no', 'unknown']);
export type ShipFlag = z.infer<typeof ShipFlag>;

export const Confidence = z.enum(['rumoured', 'announced', 'confirmed_date', 'confirmed_time']);
export type Confidence = z.infer<typeof Confidence>;

const Weights = z
  .object({
    tier: z.number().int().min(0),
    configuration: z.number().int().min(0),
    scarcity: z.number().int().min(0),
    relevance: z.number().int().min(0),
  })
  .refine((w) => w.tier + w.configuration + w.scarcity + w.relevance === 100, {
    message: 'score weights must add up to 100',
  });

/** An exclusion rule. Keywords wrapped in slashes ("/#[a-z0-9]/") are regular expressions. */
const ExcludeRule = z.object({
  rule: z.string(),
  keywords: z.array(z.string().min(1)).min(1),
  /** Only applies when no box configuration was recognised. */
  when_no_configuration: z.boolean().default(false),
});

/** A keyword rule matched case- and accent-insensitively against a normalised title. */
const Keywords = z.array(z.string().min(1)).default([]);

const Category = z.object({
  label: z.string(),
  enabled: z.boolean(),
  /** Publishers allowed in this category (keys of `publishers`). */
  publishers: z.array(z.string()).min(1),
  /** Titles must match at least one of these to be classified into the category. */
  match: Keywords,
  /** Shop product types and tags that also place an item in the category. */
  match_taxonomy: Keywords,
  /** Titles matching any of these are excluded from the category, with the rule shown in the UI. */
  exclude: z.array(ExcludeRule).default([]),
  /** Exclude items whose box type is not recognised (used for Pokémon). */
  require_configuration: z.boolean().default(false),
  /** Series names shared by many releases; ignored when telling releases apart. */
  series: Keywords,
  /** Only these product languages are in scope. */
  languages: z.array(z.string()).default(['en']),
  weights: Weights,
  /** Product lines by tier. Points are a share of `weights.tier`. */
  tiers: z
    .array(
      z.object({
        tier: z.string(),
        points_pct: pct,
        lines: z.array(z.string().min(1)),
      }),
    )
    .default([]),
  /** Box configurations, strongest first. Points are a share of `weights.configuration`. */
  configurations: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        points_pct: pct,
        keywords: z.array(z.string().min(1)).min(1),
      }),
    )
    .default([]),
});

export const RulesConfig = z.object({
  version: z.literal(1),
  owner: z.object({
    timezone: z.string(),
    /** Ship-to regions in order of preference. Country and province only, never an address. */
    ship_to: z
      .array(
        z.object({
          region: z.enum(['gi', 'es']),
          label: z.string(),
          country: z.string().length(2),
          province: z.string().optional(),
          priority: z.number().int().min(1),
        }),
      )
      .min(1),
  }),
  /** Informational cost notes shown next to prices. Never folded into the RRP gate. */
  cost_notes: z.array(
    z.object({
      id: z.string(),
      applies_to: z.object({
        region: z.enum(['gi', 'es']),
        from: z.enum(['uk', 'eu', 'non_eu', 'any']),
      }),
      text: z.string(),
      source: z.string().url(),
      verified_at: isoDate,
    }),
  ),
  rrp: z.object({
    /** Sealed product passes the gate when price <= RRP x tolerance. */
    tolerance: z.number().min(1).max(2),
    /** How an RRP is estimated when neither config nor the owner has given one. */
    estimate: z.object({
      method: z.literal('median_first_seen'),
      min_retailers: z.number().int().min(1),
    }),
    /** Known RRPs per category and configuration, each with its evidence. */
    known: z
      .array(
        z.object({
          category: z.string(),
          configuration: z.string(),
          currency: z.enum(['GBP', 'EUR', 'USD']),
          amount: z.number().positive(),
          source: z.string().url(),
          verified_at: isoDate,
          note: z.string().optional(),
        }),
      )
      .default([]),
  }),
  publishers: z.record(
    z.string(),
    z.object({
      label: z.string(),
      aliases: z.array(z.string().min(1)).min(1),
      /** Multiplier applied to tier points. Topps/Fanatics is weighted higher than Panini. */
      tier_multiplier: z.number().min(0).max(1.5),
    }),
  ),
  categories: z.record(z.string(), Category),
  normalise: z.object({
    synonyms: z.record(z.string(), z.string()),
    noise: z.array(z.string()),
  }),
  /** Exclusions that apply to every category (non-sealed items, graded slabs, etc.). */
  global_exclude: z.array(ExcludeRule),
  scarcity: z.object({
    signals: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        points_pct: pct,
        keywords: Keywords,
      }),
    ),
  }),
  relevance: z.object({
    /** Players whose presence in a checklist or title makes a sports product relevant. */
    watchlist_players: z.array(z.string().min(1)),
    rookie_class_points_pct: pct,
    watchlist_player_points_pct: pct,
    manual_tag_points_pct: pct,
  }),
  labels: z.object({
    priority_min: z.number().int(),
    watch_min: z.number().int(),
  }),
  cadence: z.object({
    calendar_minutes: z.number().int().positive(),
    retailer_minutes: z.number().int().positive(),
    hot_minutes: z.number().int().positive(),
    final_minutes: z.number().int().positive(),
    hot_window_hours: z.number().positive(),
    final_window_hours: z.number().positive(),
    shipping_check_minutes: z.number().int().positive(),
    enrichment_minutes: z.number().int().positive(),
    enrichment_horizon_days: z.number().int().positive(),
  }),
  alerts: z.object({
    lead_times_minutes: z.array(z.number().int().positive()),
    critical: z.array(z.string()),
    receipt_timeout_minutes: z.number().int().positive(),
    source_failures_before_alert: z.number().int().min(1),
    weekly_brief: z.object({
      weekday: z.number().int().min(0).max(6),
      local_time: z.string().regex(/^\d{2}:\d{2}$/),
      days_ahead: z.number().int().positive(),
    }),
  }),
});
export type RulesConfig = z.infer<typeof RulesConfig>;

const Evidence = z.object({
  value: ShipFlag,
  verified_at: isoDate.optional(),
  /** What the check returned, e.g. "RM Intl Tracked £19.99". Human-readable, shown in the UI. */
  note: z.string().optional(),
});

const PreorderRule = z.object({
  tags: z.array(z.string()).default([]),
  title_prefixes: z.array(z.string()).default([]),
  title_suffixes: z.array(z.string()).default([]),
  title_contains: z.array(z.string()).default([]),
  /** Regex (source string) that extracts a release date from body text. */
  body_date_regex: z.string().optional(),
});

const Retailer = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  country: z.string().length(2),
  currency: z.enum(['GBP', 'EUR', 'USD']),
  base_url: z.string().url(),
  platform: z.enum(['shopify', 'woocommerce', 'magento-panini']),
  enabled: z.boolean(),
  categories: z.array(z.string()).min(1),
  /** Paths polled, relative to base_url. Shopify defaults to the full catalogue. */
  paths: z.array(z.string()).default(['/products.json']),
  crawl_delay_seconds: z.number().min(0).default(2),
  ships_gi: Evidence,
  ships_es: Evidence,
  preorder: PreorderRule.default({
    tags: [],
    title_prefixes: [],
    title_suffixes: [],
    title_contains: [],
  }),
  /** Markers that identify English-language Pokémon stock at this shop. */
  english_markers: z.array(z.string()).default([]),
  notes: z.string().optional(),
});
export type Retailer = z.infer<typeof Retailer>;

const Source = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string(),
  adapter: z.string(),
  role: z.enum(['calendar', 'signal', 'reference']),
  enabled: z.boolean(),
  categories: z.array(z.string()),
  urls: z.array(z.string().url()).min(1),
  cadence_minutes: z.number().int().positive(),
  crawl_delay_seconds: z.number().min(0).default(2),
  /** Highest confidence this source can assign to a date. */
  max_confidence: Confidence,
  /** Lower number wins when sources disagree on a date. */
  precedence: z.number().int().min(1),
  notes: z.string().optional(),
});
export type Source = z.infer<typeof Source>;

export const SourcesConfig = z
  .object({
    version: z.literal(1),
    user_agent: z.string().min(10),
    sources: z.array(Source),
    retailers: z.array(Retailer),
  })
  .superRefine((cfg, ctx) => {
    const ids = [...cfg.sources.map((s) => s.id), ...cfg.retailers.map((r) => r.id)];
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length) ctx.addIssue({ code: 'custom', message: `duplicate source ids: ${dupes.join(', ')}` });
  });
export type SourcesConfig = z.infer<typeof SourcesConfig>;
