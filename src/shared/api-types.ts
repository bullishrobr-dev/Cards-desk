/** JSON shapes shared by the Worker API and the PWA. */

export type Confidence = 'rumoured' | 'announced' | 'confirmed_date' | 'confirmed_time';
export type Precision = 'time' | 'day' | 'week' | 'month' | 'unknown';
export type ShipFlag = 'yes' | 'no' | 'unknown';

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
}

export interface ProductView {
  id: string;
  configuration: string;
  configurationLabel: string;
  name: string;
  rrp: (Money & { source: 'config' | 'estimated' }) | null;
  listings: ListingView[];
}

export interface DropDetail extends DropSummary {
  observations: Array<{ sourceId: string; sourceLabel: string; startsAt: string | null; precision: Precision; confidence: Confidence; raw: string | null; region: string | null; lastSeenAt: string }>;
  history: Array<{ changedAt: string; oldStartsAt: string | null; newStartsAt: string | null; oldConfidence: string | null; newConfidence: string; sourceId: string }>;
  products: ProductView[];
  costNotes: Array<{ region: 'gi' | 'es'; from: string; text: string; source: string }>;
  watched?: boolean;
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
  kind: 'calendar' | 'signal' | 'reference' | 'shop';
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
