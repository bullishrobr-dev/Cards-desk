import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { RulesConfig, SourcesConfig } from './schema';
import { rules, sources } from './index';

describe('config files', () => {
  it('rules.yaml is valid', () => {
    expect(rules.version).toBe(1);
    expect(rules.categories.ufc?.enabled).toBe(false);
  });

  it('sources.yaml is valid and every retailer category exists in rules', () => {
    for (const r of sources.retailers) {
      for (const c of r.categories) expect(rules.categories[c], `${r.id} → ${c}`).toBeDefined();
    }
  });

  it('every enabled category publisher is defined', () => {
    for (const [id, c] of Object.entries(rules.categories)) {
      for (const p of c.publishers) expect(rules.publishers[p], `${id} → ${p}`).toBeDefined();
    }
  });

  it('seeds the football watchlist from the brief', () => {
    expect(rules.relevance.watchlist_players).toEqual([
      'Lamine Yamal',
      'Endrick',
      'Pau Cubarsí',
      'Florian Wirtz',
      'Francesco Camarda',
    ]);
  });

  it('keeps Andorra out and Gibraltar first', () => {
    const regions = [...rules.owner.ship_to].sort((a, b) => a.priority - b.priority).map((s) => s.region);
    expect(regions).toEqual(['gi', 'es']);
  });

  it('rejects weights that do not add up to 100', () => {
    const raw = parse(readFileSync('config/rules.yaml', 'utf8'));
    raw.categories.football.weights.tier = 50;
    expect(RulesConfig.safeParse(raw).success).toBe(false);
  });

  it('rejects duplicate source ids', () => {
    const raw = parse(readFileSync('config/sources.yaml', 'utf8'));
    raw.retailers.push({ ...raw.retailers[0] });
    expect(SourcesConfig.safeParse(raw).success).toBe(false);
  });
});
