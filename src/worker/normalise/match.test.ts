import { describe, expect, it } from 'vitest';
import { rules } from '../../shared/config/index.ts';
import { createClassifier } from './classify.ts';
import { matchRelease, seasonsCompatible } from './match.ts';

const clf = createClassifier(rules);
const subj = (title: string, categories: string[]) => {
  const c = clf.classify({ title }, { categories });
  return { subject: c.subject, season: c.season };
};
const cand = (id: string, title: string, categories: string[]) => ({ id, ...subj(title, categories) });

describe('seasons', () => {
  it.each([
    ['2026', '2026', true],
    ['2025-26', '2026', true],
    ['2026', '2026-27', true],
    ['2025-26', '2026-27', false],
    ['2026', '2027', false],
    [null, '2026', true],
  ])('%s vs %s → %s', (a, b, ok) => expect(seasonsCompatible(a, b)).toBe(ok));
});

describe('release matching on real titles', () => {
  const sports = ['football', 'f1'];
  const f1 = cand('chrome-f1', '2026 TOPPS Chrome Formula 1 Racing Cards', sports);
  const carbon = cand('carbon-f1', '2026 TOPPS Carbon Formula 1 Racing Cards', sports);
  const scc = cand('scc-ucl', '2025-26 TOPPS Stadium Club Chrome UEFA Champions League', sports);
  const tin = cand('arsenal-tin', '2026-27 TOPPS Arsenal FC Collector Tin', sports);
  const nt = cand('nt-wc', '2025-26 PANINI National Treasures Road to FIFA World Cup 26 Soccer Cards', sports);
  const all = [f1, carbon, scc, tin, nt];
  const { lines } = clf.matchTokens('f1');

  it('matches a shop hobby box to the collectosk release', () => {
    const s = subj('Topps Chrome Formula 1 2026 Hobby Box - Pre-Order', sports);
    expect(matchRelease(s.subject, s.season, all, new Set(), lines)).toMatchObject({ kind: 'match', id: 'chrome-f1' });
  });

  it('does not match Chrome F1 to Carbon F1', () => {
    const s = subj('Topps Chrome Formula 1 2026 Mega Box', sports);
    expect(matchRelease(s.subject, s.season, [carbon], new Set(), lines)).toEqual({ kind: 'none' });
  });

  it('expands UCL and matches Stadium Club Chrome', () => {
    const s = subj('Topps Stadium Club Chrome UCL 2025/26 Hobby Box', sports);
    expect(matchRelease(s.subject, s.season, all, new Set(), clf.matchTokens('football').lines)).toMatchObject({ kind: 'match', id: 'scc-ucl' });
  });

  it('matches "Collectors Tin - Arsenal" with odd season spacing', () => {
    const s = subj('Topps 2026/ 27 Collectors Tin - Arsenal', sports);
    expect(matchRelease(s.subject, s.season, all)).toMatchObject({ kind: 'match', id: 'arsenal-tin' });
  });

  it('matches a shorter shop title inside a verbose calendar name', () => {
    const s = subj('PREORDER: Panini National Treasures Road to FIFA World Cup 2026 – Hobby Box', sports);
    expect(matchRelease(s.subject, s.season, all)).toMatchObject({ kind: 'match', id: 'nt-wc' });
  });

  it('refuses a different season of the same line', () => {
    const s = subj('2026-27 TOPPS Stadium Club Chrome UEFA Champions League Hobby', sports);
    expect(matchRelease(s.subject, s.season, [scc])).toEqual({ kind: 'none' });
  });

  it('keeps Sapphire apart from plain Chrome', () => {
    const s = subj('Topps Chrome Sapphire Formula 1 2026', sports);
    expect(matchRelease(s.subject, s.season, [f1], new Set(), lines)).toEqual({ kind: 'none' });
  });
});

describe('Pokémon matching with series words', () => {
  const pk = ['pokemon'];
  const { series, lines } = clf.matchTokens('pokemon');
  const delta = cand('delta', 'Pokémon TCG: Mega Evolution—Delta Reign', pk);
  const base = cand('me-base', 'Pokémon TCG: Mega Evolution', pk);
  const serebii = cand('serebii-delta', 'Pokémon TCG: Delta Reign', pk);

  it('matches a shop booster box to the set, not to the base set', () => {
    const s = subj('Pokemon TCG: Mega Evolution Delta Reign - Booster Box', pk);
    expect(matchRelease(s.subject, s.season, [base, delta], series, lines)).toMatchObject({ kind: 'match', id: 'delta' });
  });

  it('never puts a new set into the base set when the set is unknown', () => {
    const s = subj('Pokemon TCG: Mega Evolution Delta Reign - Booster Box', pk);
    expect(matchRelease(s.subject, s.season, [base], series, lines)).toEqual({ kind: 'none' });
  });

  it('matches the base set itself', () => {
    const s = subj('Pokemon TCG: Mega Evolution - Booster Box', pk);
    expect(matchRelease(s.subject, s.season, [base, delta], series, lines)).toMatchObject({ kind: 'match', id: 'me-base' });
  });

  it('matches Serebii\'s short set name to the press name', () => {
    expect(matchRelease(serebii.subject, null, [delta, base], series, lines)).toMatchObject({ kind: 'match', id: 'delta' });
  });

  it('matches the Pokémon Center ETB title to the set', () => {
    const s = subj('Pokémon TCG: Mega Evolution—Delta Reign Pokémon Center Elite Trainer Box', pk);
    expect(matchRelease(s.subject, s.season, [base, delta], series, lines)).toMatchObject({ kind: 'match', id: 'delta' });
  });

  it('reports ties as ambiguous', () => {
    const a = { id: 'a', subject: ['delta', 'reign'], season: null };
    const b = { id: 'b', subject: ['delta', 'reign'], season: null };
    expect(matchRelease(['delta', 'reign'], null, [a, b])).toEqual({ kind: 'ambiguous', ids: ['a', 'b'] });
  });
});
