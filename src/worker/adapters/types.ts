import type { Confidence } from '../../shared/config/schema.ts';

export type Precision = 'time' | 'day' | 'week' | 'month' | 'unknown';

/** A source's statement that a release exists, with whatever date it gives. */
export interface ReleaseObservation {
  kind: 'release';
  title: string;
  url: string | null;
  /** YYYY-MM-DD for day/week/month precision; full ISO UTC for time precision; null when TBD. */
  date: string | null;
  precision: Precision;
  confidence: Confidence;
  /** The date text exactly as published. */
  rawDate: string;
  /** Category hint from the source's own taxonomy (e.g. collectosk "Soccer"). */
  categoryHint: string | null;
  /** Region the date applies to, when the source says (e.g. Pokémon Center "UK"). */
  region?: string | null;
}

/** One purchasable variant at one shop. */
export interface ListingObservation {
  kind: 'listing';
  externalId: string;
  productExternalId: string;
  title: string;
  variantTitle: string | null;
  productType: string | null;
  tags: string[];
  vendor: string | null;
  url: string;
  priceMinor: number | null;
  currency: string;
  available: boolean;
  isPreorder: boolean;
  releaseText: string | null;
  publishedAt: string | null;
}

export interface FxObservation {
  kind: 'fx';
  date: string;
  rates: Record<string, number>;
}

export type Observation = ReleaseObservation | ListingObservation | FxObservation;

/** A fetchable unit of work: one URL. Follow-ups (next page, a release page) are new units. */
export interface Unit {
  sourceId: string;
  url: string;
  /** Stable key for fetch state, e.g. "/products.json?page=2". */
  key: string;
  expected: 'json' | 'html' | 'xml';
  /** Adapter-specific context carried to the follow-up (e.g. the headline it came from). */
  context?: Record<string, string>;
}

export interface ParseResult {
  items: Observation[];
  followUps: Unit[];
}
