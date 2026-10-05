import { describe, expect, it } from 'vitest';
import { rules } from '../../shared/config/index.ts';
import { baseNormalise, createNormaliser, decodeEntities } from './text.ts';
import { createClassifier } from './classify.ts';

const { classify } = createClassifier(rules);
const SPORTS = { categories: ['football', 'f1'] };
const POKEMON = { categories: ['pokemon'] };

describe('text normalisation', () => {
  it('decodes WooCommerce HTML entities', () => {
    expect(decodeEntities('Panini Prizm FIFA 2025/26 &#8211; Hobby Box')).toBe('Panini Prizm FIFA 2025/26 – Hobby Box');
    expect(decodeEntities('Nico O&#8217;Reilly &amp; co')).toBe('Nico O’Reilly & co');
  });

  it('canonicalises season formats', () => {
    expect(baseNormalise('Topps 2026/ 27 Collectors Tin')).toBe('topps 2026-27 collectors tin');
    expect(baseNormalise('2025/26')).toBe('2025-26');
    expect(baseNormalise('Living Set UCC 25/26')).toBe('living set ucc 2025-26');
    expect(baseNormalise('3/4 pack')).toBe('3 4 pack');
  });

  it('strips accents and apostrophes, and expands synonyms', () => {
    const n = createNormaliser(rules.normalise.synonyms);
    expect(n.text("Breaker's Delight")).toBe('breakers delight');
    expect(n.text('Topps Chrome F1 – Pokémon ETB')).toBe('topps chrome formula 1 pokemon elite trainer box');
    expect(n.text('Topps Stadium Club Chrome UCL')).toBe('topps stadium club chrome uefa champions league');
  });
});

describe('classification: in scope', () => {
  it('Topps Chrome F1 hobby pre-order (Sports Cards Direct)', () => {
    const c = classify({ title: 'Topps Chrome Formula 1 2026 Hobby Box - Pre-Order', productType: 'f1', tags: ['formula 1', 'PRE-ORDER'] }, SPORTS);
    expect(c).toMatchObject({ category: 'f1', publisher: 'topps', season: '2026', configuration: 'hobby', excludedRule: null, tier: 'Flagship' });
    expect(c.subject).toEqual(['1', 'chrome', 'formula']);
  });

  it('collectosk-style name matches the shop subject', () => {
    const c = classify({ title: '2026 TOPPS Chrome Formula 1 Racing Cards' }, SPORTS);
    expect(c.subject).toEqual(['1', 'chrome', 'formula']);
    expect(c.configuration).toBeNull();
  });

  it('UCC Finest hobby with tags (Sports Cards Worldwide)', () => {
    const c = classify({ title: 'Topps Finest UEFA Club Competitions 2025/26 Hobby Box', tags: ['brand:Topps', 'format:Hobby Box', 'sport:Soccer'] }, SPORTS);
    expect(c).toMatchObject({ category: 'football', publisher: 'topps', season: '2025-26', configuration: 'hobby', line: 'finest', excludedRule: null });
  });

  it('collector tins in odd spellings', () => {
    const a = classify({ title: 'Topps 2026/ 27 Collectors Tin - Arsenal' }, SPORTS);
    const b = classify({ title: '2026/27 Topps Chelsea Collector Tin' }, SPORTS);
    expect(a).toMatchObject({ category: 'football', season: '2026-27', configuration: 'collector', excludedRule: null });
    expect(b).toMatchObject({ category: 'football', season: '2026-27', configuration: 'collector' });
  });

  it('Panini hobby via WooCommerce entity-encoded title (SportyCards)', () => {
    const c = classify({ title: 'PREORDER: Panini National Treasures Road to FIFA World Cup 2026 &#8211; Hobby Box' }, SPORTS);
    expect(c).toMatchObject({ category: 'football', publisher: 'panini', configuration: 'hobby', tier: 'Premium', excludedRule: null });
  });

  it('English Pokémon booster box with Zatu taxonomy', () => {
    const c = classify({ title: 'Pokemon TCG: Mega Evolution Delta Reign - Booster Box', productType: 'Trading Card Games', tags: ['Booster Boxes', 'Manual Release Date'] }, POKEMON);
    expect(c).toMatchObject({ category: 'pokemon', publisher: 'pokemon', configuration: 'booster_box', excludedRule: null });
    expect(c.subject).toEqual(['delta', 'evolution', 'mega', 'reign']);
  });

  it('Pokemillon English variant passes, Spanish variant is excluded', () => {
    const ctx = { ...POKEMON, englishMarkers: ['inglés'] };
    const base = { title: 'Booster Bundle Equilibrio Perfecto', productType: 'Perfect Order', tags: ['Español - Inglés', 'Pokémon'] };
    expect(classify({ ...base, variantTitle: 'Inglés' }, ctx).excludedRule).toBeNull();
    expect(classify({ ...base, variantTitle: 'Español' }, ctx).excludedRule).toBe('Other non-English languages');
  });

  it('flags watchlist players', () => {
    const c = classify({ title: 'Topps Chrome UCC 2025/26 Lamine Yamal Edition Hobby Box' }, SPORTS);
    expect(c.players).toEqual(['Lamine Yamal']);
  });
});

describe('classification: noise is excluded, never silently dropped', () => {
  const cases: Array<[string, Parameters<typeof classify>[0], typeof SPORTS, string]> = [
    ['Match Attax', { title: 'Topps Match Attax UCC 2026/27 Mega Tin - New Entries', productType: 'football' }, SPORTS, 'Match Attax / Turbo Attax'],
    ['sticker album', { title: 'Topps Real Madrid Sticker Album 2025/26' }, SPORTS, 'Stickers'],
    ['blaster', { title: 'Panini Select Road To World Cup 2025/26 - Blaster Box' }, SPORTS, 'Retail blasters and hangers'],
    ['single pack from a hobby box', { title: 'Topps Merlin Premier League 2025/26 - Hobby Box (Single Pack)' }, SPORTS, 'Single packs'],
    ['live opening variant', { title: 'Topps Chrome MLS 2026 Hobby Box', variantTitle: 'Abrir en directo' }, SPORTS, 'Group breaks and live openings'],
    ['graded slab', { title: 'Topps Erling Haaland #74 2019-20 Chrome UCL PSA 10' }, SPORTS, 'Graded or single cards'],
    ['hobby case', { title: 'Topps Premier League EPL Soccer 2026/27 Hobby Case', tags: ['sport:Soccer'] }, SPORTS, 'Cases (multiple boxes)'],
    ['Living Set single', { title: 'Wayne Rooney #873 &#8211; Topps Living Set UCC 25/26' }, SPORTS, 'Graded or single cards'],
    ['Japanese booster box', { title: 'Pokemon TCG: JAPANESE Battle Partners sv9 - Booster Box', tags: ['Japanese'] }, POKEMON, 'Japanese-language'],
    ['Korean booster box', { title: 'Pokemon TCG Mega Brave m1L Korean Booster Box (30 Booster Packs)' }, POKEMON, 'Other non-English languages'],
    ['mini tin', { title: 'Pokémon TCG: 30th Celebration Mini Tin', productType: 'tcg', tags: ['pokemon'] }, POKEMON, 'Mini tins'],
    ['3-pack blister', { title: 'Pokémon TCG: Lost Origin (SS11) - 3-Pack Blister - English' }, POKEMON, 'Blisters'],
    ['PET protector looks like a booster box', { title: 'Heimdall® Pokémon PET Protector – English Booster Box 36', productType: 'PET Protector' }, POKEMON, 'Accessories and supplies'],
    ['acrylic display case', { title: 'Heimdall® Pokémon Booster Box Acrylic Display Case – Rhino Strength', productType: 'Acrylic' }, POKEMON, 'Accessories and supplies'],
    ['Chinese single card', { title: 'Pokemon - 30th Celebration - Simplified Chinese - Mew ex - 135/103', productType: 'Single Card' }, POKEMON, 'Graded or single cards'],
    ['damaged ETB', { title: '[ DAÑADA ] ETB Pitch Black ME05 - Inglés', productType: 'ETB Pokémon TCG' }, POKEMON, 'Damaged stock'],
    ['mystery bundle', { title: 'Pokemon Mini Mystery Bundle', productType: 'Pokemon' }, POKEMON, 'Mystery and repacks'],
  ];
  for (const [name, input, ctx, rule] of cases) {
    it(name, () => expect(classify(input, ctx).excludedRule).toBe(rule));
  }

  it('keeps out publishers not in scope (Futera, Daka)', () => {
    expect(classify({ title: 'Daka Real Madrid Final Whistle 2025/26 Hobby Box', tags: ['sport:Soccer'] }, SPORTS).excludedRule).toBe('Publisher not in scope');
  });

  it('does not treat NFL "Chrome Football" as football', () => {
    expect(classify({ title: '2025 Topps Chrome Football Hobby Box', productType: 'Collectible Trading Cards' }, SPORTS).category).toBeNull();
  });

  it('ignores other sports entirely', () => {
    expect(classify({ title: '2025-26 Topps Chrome Basketball Hobby Box', tags: ['Basketball'] }, SPORTS).category).toBeNull();
  });
});
