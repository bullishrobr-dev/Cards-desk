import type { Confidence } from '../../shared/config/schema.ts';
import type { Precision } from '../adapters/types.ts';

export interface DateObservation {
  sourceId: string;
  startsAt: string | null;
  precision: Precision;
  confidence: Confidence;
  precedence: number;
  region: string | null;
  lastSeenAt: string;
}

export interface Decision {
  startsAt: string | null;
  precision: Precision;
  confidence: Confidence;
  sourceId: string | null;
}

const CONFIDENCE_RANK: Record<Confidence, number> = { rumoured: 0, announced: 1, confirmed_date: 2, confirmed_time: 3 };
const PRECISION_RANK: Record<Precision, number> = { unknown: 0, month: 1, week: 2, day: 3, time: 4 };
const LOCAL_REGIONS = new Set(['EU', 'UK']);

/**
 * Picks the date that wins among every source's observation. Sources never overwrite each other:
 * each keeps its own observation and this function decides, in order:
 * 1. a dated observation beats an undated one,
 * 2. lower precedence number (official > primary calendar > cross-check > shop),
 * 3. higher confidence, then more precise,
 * 4. a UK/EU date beats another region (the owner buys in Europe),
 * 5. the most recently seen.
 */
export function decide(observations: DateObservation[]): Decision {
  const ranked = [...observations].sort((a, b) => {
    const dated = Number(b.startsAt !== null) - Number(a.startsAt !== null);
    if (dated) return dated;
    if (a.precedence !== b.precedence) return a.precedence - b.precedence;
    const conf = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
    if (conf) return conf;
    const prec = PRECISION_RANK[b.precision] - PRECISION_RANK[a.precision];
    if (prec) return prec;
    const local = Number(LOCAL_REGIONS.has(b.region ?? '')) - Number(LOCAL_REGIONS.has(a.region ?? ''));
    if (local) return local;
    return b.lastSeenAt.localeCompare(a.lastSeenAt);
  });
  const top = ranked[0];
  if (!top) return { startsAt: null, precision: 'unknown', confidence: 'rumoured', sourceId: null };
  // Confidence never exceeds what the winning source can support, and an undated release is
  // at most "announced".
  const confidence = top.startsAt ? top.confidence : CONFIDENCE_RANK[top.confidence] > 1 ? 'announced' : top.confidence;
  return { startsAt: top.startsAt, precision: top.startsAt ? top.precision : 'unknown', confidence, sourceId: top.sourceId };
}

export function decisionChanged(a: Decision, b: Decision): boolean {
  return a.startsAt !== b.startsAt || a.precision !== b.precision || a.confidence !== b.confidence;
}
