/** JSON shapes shared by the Worker API and the PWA. */

export type Confidence = 'rumoured' | 'announced' | 'confirmed_date' | 'confirmed_time';
export type Precision = 'time' | 'day' | 'week' | 'month' | 'unknown';
export type ShipFlag = 'yes' | 'no' | 'unknown';
/** Where an RRP came from: rules.yaml, the median of shop prices, or the owner. */
export type RrpSource = 'config' | 'published' | 'estimated' | 'owner';

export interface Money {
  minor: number;
  currency: string;
  /** Converted with the latest ECB reference rate; null when no rate is stored yet. */
  gbp: number | null;
  eur: number | null;
}

export interface DropSummary {
  id: string;
  releaseId: string;
  name: string;
  category: string;
  publisher: string | null;
  season: string | null;
  tier: string | null;
  startsAt: string | null;
  /** UTC instant the drop goes live (local midnight Gibraltar for day precision). */
  liveAt: string | null;
  precision: Precision;
  confidence: Confidence;
  status: 'upcoming' | 'live' | 'past' | 'cancelled';
  configurations: string[];
  shopCount: number;
  shipsGi: boolean;
  shipsEs: boolean;
  /** Cheapest price at a shop that ships to the selected region (or anywhere). */
  bestPrice: (Money & { retailer: string; configuration: string }) | null;
  /** Price ÷ RRP for the best price, when an RRP is known. */
  priceVsRrp: number | null;
  desk: DeskScore;
  pinned: boolean;
  watched: boolean;
  /** A box photo: the release page's own, else a shop's. Null when nobody has one yet. */
  imageUrl: string | null;
  /** At least one shop lists it as a pre-order. */
  preorder: boolean;
}

export interface ListingView {
  id: string;
  retailerId: string;
  retailer: string;
  country: string;
  url: string;
  title: string;
  price: Money | null;
  available: boolean;
  isPreorder: boolean;
  shipsGi: { value: ShipFlag; verifiedAt: string | null; note: string | null };
  shipsEs: { value: ShipFlag; verifiedAt: string | null; note: string | null };
  priceVsRrp: number | null;
  lastChangedAt: string;
  imageUrl: string | null;
  /** Price and stock changes since first seen, oldest first (up to 30). */
  history: ListingHistoryPoint[];
}

export interface ProductView {
  id: string;
  configuration: string;
  configurationLabel: string;
  name: string;
  rrp: (Money & { source: RrpSource }) | null;
  imageUrl: string | null;
  listings: ListingView[];
}

export interface DropDetail extends DropSummary {
  observations: Array<{ sourceId: string; sourceLabel: string; startsAt: string | null; precision: Precision; confidence: Confidence; raw: string | null; region: string | null; lastSeenAt: string }>;
  history: Array<{ changedAt: string; oldStartsAt: string | null; newStartsAt: string | null; oldConfidence: string | null; newConfidence: string; sourceId: string }>;
  products: ProductView[];
  costNotes: Array<{ region: 'gi' | 'es'; from: string; text: string; source: string }>;
  tags: string[];
  /** Secondary-market prices per box type (Cardmarket, EU, EUR); empty when none matched. */
  market: MarketView[];
  /** From the release's collectosk page; null until it has been read. */
  checklist: { cards: number | null; rookies: string[]; players: string[]; readAt: string; url: string | null } | null;
}

export interface NotificationItem {
  id: string;
  trigger: string;
  critical: number;
  title: string;
  body: string;
  url: string | null;
  created_at: string;
  read_at: string | null;
}

export interface SourceHealth {
  id: string;
  label: string;
  kind: 'calendar' | 'signal' | 'reference' | 'market' | 'shop';
  enabled: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  itemCount: number;
  status: 'ok' | 'failing' | 'never_run' | 'degraded';
}

export interface GateResult {
  id: 'scope' | 'purchasable' | 'price';
  pass: boolean;
  /** Passed, but on missing information (e.g. shipping unknown, no RRP yet). */
  flagged: boolean;
  label: string;
  detail: string;
}

export interface ScoreComponent {
  id: 'tier' | 'configuration' | 'scarcity' | 'relevance';
  label: string;
  points: number;
  max: number;
  reason: string;
}

export interface DeskScore {
  score: number;
  /** What the rules gave before any owner override. */
  rawScore: number;
  label: 'Priority' | 'Watch' | 'Ignore';
  /** Failed a hard gate: shown greyed out, never alerts unless watched. */
  gated: boolean;
  gates: GateResult[];
  breakdown: ScoreComponent[];
  overridden: boolean;
  overrideNote: string | null;
}

/** The weekly brief: the next N days of dated drops, ranked by Desk Score. */
export interface WeeklyBrief {
  /** Local dates (Europe/Gibraltar), inclusive. */
  from: string;
  to: string;
  generatedAt: string;
  priority: number;
  watch: number;
  gated: number;
  drops: DropSummary[];
}

/** One point in a listing's price or stock history. */
export interface ListingHistoryPoint {
  at: string;
  priceMinor: number | null;
  available: boolean | null;
  /** Price ÷ the RRP in force at the time, when one was known. */
  ratio: number | null;
}

/** What shops have done lately, per category: sell-out speed, price against RRP, recent moves. */
export interface SectorSignals {
  days: number;
  categories: Array<{
    category: string;
    label: string;
    /** Listings still on shop sites (in stock or not) whose box type has a known RRP. */
    pricedListings: number;
    /** Median current price ÷ RRP; null when nothing is priced against an RRP. */
    medianRatio: number | null;
    /** Share of those listings above the RRP tolerance (0–1). */
    aboveTolerance: number | null;
    soldOut: number;
    /** Median hours from going on sale (or first seen) to selling out. */
    medianHoursToSellOut: number | null;
  }>;
  moves: Array<{
    at: string;
    kind: 'sold_out' | 'restock' | 'price_up' | 'price_down';
    dropId: string | null;
    release: string;
    retailer: string;
    detail: string;
  }>;
}

export interface MarketView {
  source: 'cardmarket';
  name: string;
  configuration: string;
  configurationLabel: string;
  /** Cheapest listing, sold-price trend and average sold price. */
  low: Money | null;
  trend: Money | null;
  avg: Money | null;
  /** Trend ÷ the box type's RRP, when both are known. */
  trendVsRrp: number | null;
  asOf: string;
  url: string;
  /** Daily trend and low, oldest first (up to 90 days). */
  history: Array<{ date: string; trendMinor: number | null; lowMinor: number | null }>;
}

/** Every notification trigger the owner can switch off, in display order. */
export const NOTIFICATION_TRIGGERS = [
  { id: 'priority_new', label: 'New Priority drop', group: 'Discovery' },
  { id: 'weekly_brief', label: 'Weekly brief (Sunday 18:00)', group: 'Discovery' },
  { id: 't_minus_1440', label: '24 hours before a watched drop', group: 'Watched drops' },
  { id: 't_minus_60', label: '1 hour before', group: 'Watched drops' },
  { id: 't_minus_10', label: '10 minutes before', group: 'Watched drops' },
  { id: 'live', label: 'When it goes live', group: 'Watched drops' },
  { id: 'date_changed_watched', label: 'Date moved', group: 'Watched drops' },
  { id: 'date_update_watched', label: 'Date set or confirmed', group: 'Watched drops' },
  { id: 'restock', label: 'Back in stock', group: 'Watched drops' },
  { id: 'source_failing', label: 'A source keeps failing', group: 'System' },
  { id: 'shipping_reverify', label: "A shop's ship-to list changed", group: 'System' },
] as const;

export interface NotificationPref {
  id: (typeof NOTIFICATION_TRIGGERS)[number]['id'];
  label: string;
  group: string;
  enabled: boolean;
  /** Critical alerts fall back to email when the push is not confirmed. */
  critical: boolean;
}
