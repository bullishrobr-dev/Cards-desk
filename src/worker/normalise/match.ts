/**
 * Deterministic release matching. A title matches a release when one subject is contained in the
 * other and the overlap is large enough; series words ("mega evolution", "scarlet violet") never
 * count as the distinguishing part, so "Mega Evolution Delta Reign" does not fall into the base
 * "Mega Evolution" set. Ties and near-ties are reported as ambiguous for the LLM pass.
 */

export interface Candidate {
  id: string;
  subject: string[];
  season: string | null;
}

export type MatchResult =
  | { kind: 'match'; id: string; score: number }
  | { kind: 'ambiguous'; ids: string[] }
  | { kind: 'none' };

const MIN_SCORE = 0.5;
const TIE_MARGIN = 0.05;

export function seasonsCompatible(a: string | null, b: string | null): boolean {
  if (!a || !b || a === b) return true;
  const years = (s: string): number[] => {
    const m = s.match(/^(\d{4})(?:-(\d{2}))?$/);
    if (!m) return [];
    const first = Number(m[1]);
    return m[2] ? [first, Math.floor(first / 100) * 100 + Number(m[2])] : [first];
  };
  const ya = years(a);
  const yb = years(b);
  // Two different two-part seasons ("2025-26" vs "2026-27") never match.
  if (ya.length === 2 && yb.length === 2) return false;
  return ya.some((y) => yb.includes(y));
}

export function matchRelease(
  subject: string[],
  season: string | null,
  candidates: Candidate[],
  seriesTokens: ReadonlySet<string> = new Set(),
  lineTokens: ReadonlySet<string> = new Set(),
): MatchResult {
  const mine = new Set(subject);
  const core = (s: Iterable<string>) => [...s].filter((t) => !seriesTokens.has(t));
  const myCore = core(mine);
  const scored: Array<{ id: string; score: number }> = [];

  for (const c of candidates) {
    if (!seasonsCompatible(season, c.season)) continue;
    const theirs = new Set(c.subject);
    const theirCore = core(theirs);
    // A bare series name only matches a title that is also just the series.
    if ((myCore.length === 0) !== (theirCore.length === 0)) continue;
    const inter = [...mine].filter((t) => theirs.has(t)).length;
    const contained = inter === theirs.size || inter === mine.size;
    if (!contained || inter === 0) continue;
    // Extra words on either side that name a different product line rule the match out
    // ("Chrome Sapphire" is not "Chrome").
    const extra = [...mine].filter((t) => !theirs.has(t)).concat([...theirs].filter((t) => !mine.has(t)));
    if (extra.some((t) => lineTokens.has(t))) continue;
    const score = inter / Math.max(mine.size, theirs.size);
    if (score >= MIN_SCORE) scored.push({ id: c.id, score });
  }

  if (scored.length === 0) return { kind: 'none' };
  scored.sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (!best) return { kind: 'none' };
  if (second && best.score - second.score < TIE_MARGIN) {
    return { kind: 'ambiguous', ids: scored.filter((s) => best.score - s.score < TIE_MARGIN).map((s) => s.id) };
  }
  return { kind: 'match', id: best.id, score: best.score };
}

export function releaseKey(category: string, season: string | null, subject: string[]): string {
  return `${category}|${season ?? ''}|${[...subject].sort().join(' ')}`;
}
