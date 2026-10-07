import { describe, expect, it } from 'vitest';
import { rules } from '../../shared/config/index.ts';
import { deskScore, labelFor, type ScoreInput, type ScoreListing } from './desk-score.ts';

const rates = { EUR: 1, GBP: 0.85373, USD: 1.1298 };
const shop = (o: Partial<ScoreListing> = {}): ScoreListing => ({ priceMinor: 84000, currency: 'GBP', available: false, isPreorder: true, shipsGi: 'yes', shipsEs: 'yes', purchaseLimit: null, ...o });

/** Topps Chrome Formula 1 2026, hobby box at Sports Cards Direct (£840 on 5 Oct). */
const chromeF1 = (o: Partial<ScoreInput> = {}): ScoreInput => ({
  category: 'f1',
  publisher: 'topps',
  line: 'chrome formula 1',
  tier: 'Flagship',
  tierPointsPct: 100,
  scarcity: [],
  players: [],
  products: [{ configuration: 'hobby', rrpMinor: 78352, rrpCurrency: 'GBP', rrpSource: 'estimated', listings: [shop()] }],
  manualTags: [],
  override: null,
  ...o,
});

const pts = (s: ReturnType<typeof deskScore>, id: string) => s.breakdown.find((b) => b.id === id)?.points;
const gate = (s: ReturnType<typeof deskScore>, id: string) => s.gates.find((g) => g.id === id);

describe('labels', () => {
  it('Priority from 75, Watch from 50, otherwise Ignore', () => {
    expect([labelFor(75, rules), labelFor(74, rules), labelFor(50, rules), labelFor(49, rules)]).toEqual(['Priority', 'Watch', 'Watch', 'Ignore']);
  });
});

describe('score components (every point explained)', () => {
  it('flagship Topps hobby box: tier 40 + configuration 20 = 60 (Watch)', () => {
    const s = deskScore(chromeF1(), rules, rates);
    expect(pts(s, 'tier')).toBe(40);
    expect(pts(s, 'configuration')).toBe(20);
    expect(pts(s, 'scarcity')).toBe(0);
    expect(pts(s, 'relevance')).toBe(0);
    expect(s).toMatchObject({ score: 60, label: 'Watch' });
    expect(s.breakdown.every((b) => b.reason.length > 0)).toBe(true);
  });

  it('weights Panini lower than Topps for the same tier', () => {
    const nt = deskScore(chromeF1({ category: 'football', publisher: 'panini', line: 'national treasures', tier: 'Premium', tierPointsPct: 75 }), rules, rates);
    expect(pts(nt, 'tier')).toBe(25.5); // 40 × 75% × 0.85
    expect(nt.breakdown.find((b) => b.id === 'tier')?.reason).toContain('× 0.85 publisher weight');
  });

  it('scores the best box type on offer', () => {
    const s = deskScore(
      chromeF1({
        products: [
          { configuration: 'retail', rrpMinor: null, rrpCurrency: null, rrpSource: null, listings: [shop({ priceMinor: 9700 })] },
          { configuration: 'mega', rrpMinor: null, rrpCurrency: null, rrpSource: null, listings: [shop({ priceMinor: 22700 })] },
        ],
      }),
      rules,
      rates,
    );
    expect(pts(s, 'configuration')).toBe(10); // mega 50% of 20
  });

  it('caps scarcity at 100% and counts shop purchase limits', () => {
    const s = deskScore(chromeF1({ scarcity: ['print_to_order'], products: [{ configuration: 'hobby', rrpMinor: null, rrpCurrency: null, rrpSource: null, listings: [shop({ purchaseLimit: 1 })] }] }), rules, rates);
    expect(pts(s, 'scarcity')).toBe(20);
    expect(s.breakdown.find((b) => b.id === 'scarcity')?.reason).toBe('Print-to-order (100%), Retailer purchase limit (40%)');
  });

  it('relevance from watchlist players or your own tags', () => {
    expect(pts(deskScore(chromeF1({ category: 'football', players: ['Lamine Yamal'] }), rules, rates), 'relevance')).toBe(20);
    const tagged = deskScore(chromeF1({ manualTags: ['chase: Delta Reign'] }), rules, rates);
    expect(pts(tagged, 'relevance')).toBe(20);
    expect(tagged).toMatchObject({ score: 80, label: 'Priority' });
  });

  it('special-set Pokémon booster box', () => {
    const s = deskScore(
      { category: 'pokemon', publisher: 'pokemon', line: '30th celebration', tier: 'Special set', tierPointsPct: 85, scarcity: [], players: [], manualTags: [], override: null, products: [{ configuration: 'booster_box', rrpMinor: 15444, rrpCurrency: 'GBP', rrpSource: 'config', listings: [shop({ priceMinor: 15400 })] }] },
      rules,
      rates,
    );
    expect(s).toMatchObject({ score: 54, label: 'Watch', gated: false });
  });
});

describe('rookie class', () => {
  it('rookie cards on the checklist give half the relevance points; a watchlist player still wins', () => {
    const s = deskScore(chromeF1({ rookies: ['Arvid Lindblad'] }), rules, rates);
    expect(pts(s, 'relevance')).toBe(10);
    expect(s.breakdown.find((b) => b.id === 'relevance')?.reason).toBe('Rookie class: 1 rookie card (Arvid Lindblad)');
    expect(pts(deskScore(chromeF1({ rookies: ['A', 'B', 'C', 'D'], players: ['Lamine Yamal'] }), rules, rates), 'relevance')).toBe(20);
  });
});

describe('hard gates', () => {
  it('above RRP × 1.05 fails: "Above RRP — buy singles instead"', () => {
    const s = deskScore(chromeF1(), rules, rates); // £840 vs £783.52 = 7% over
    expect(s.gated).toBe(true);
    expect(gate(s, 'price')).toMatchObject({ pass: false, detail: 'Above RRP — buy singles instead (cheapest is 7% over)' });
  });

  it('at RRP passes, comparing across currencies', () => {
    const s = deskScore(chromeF1({ products: [{ configuration: 'hobby', rrpMinor: 78352, rrpCurrency: 'GBP', rrpSource: 'estimated', listings: [shop({ priceMinor: 91000, currency: 'EUR', shipsGi: 'no' })] }] }), rules, rates);
    // €910 ≈ £776.89, under the £783.52 RRP.
    expect(gate(s, 'price')?.pass).toBe(true);
    expect(gate(s, 'price')?.detail).toMatch(/^At RRP — fine to rip for fun \(best price 1% under RRP\)$/);
    const named = deskScore(chromeF1({ products: [{ configuration: 'hobby', rrpMinor: 78352, rrpCurrency: 'GBP', rrpSource: 'estimated', listings: [shop({ priceMinor: 91000, currency: 'EUR', shipsGi: 'no', retailer: 'DutchBreakers' })] }] }), rules, rates);
    expect(gate(named, 'price')?.detail).toBe('At RRP — fine to rip for fun (best price 1% under RRP at DutchBreakers, Spain address only)');
  });

  it('ignores prices at shops that ship to neither Gibraltar nor Spain', () => {
    const s = deskScore(chromeF1({ products: [{ configuration: 'hobby', rrpMinor: 78352, rrpCurrency: 'GBP', rrpSource: 'estimated', listings: [shop({ priceMinor: 70000, shipsGi: 'no', shipsEs: 'no' }), shop()] }] }), rules, rates);
    expect(gate(s, 'price')?.pass).toBe(false);
  });

  it('purchasable: Spain-only passes; neither fails; unknown passes flagged; no shop yet passes flagged', () => {
    const only = (gi: ScoreListing['shipsGi'], es: ScoreListing['shipsEs']) =>
      gate(deskScore(chromeF1({ products: [{ configuration: 'hobby', rrpMinor: null, rrpCurrency: null, rrpSource: null, listings: [shop({ shipsGi: gi, shipsEs: es })] }] }), rules, rates), 'purchasable');
    expect(only('no', 'yes')).toMatchObject({ pass: true, flagged: false, detail: 'Ships to Spain only (fallback address)' });
    expect(only('no', 'no')).toMatchObject({ pass: false });
    expect(only('unknown', 'no')).toMatchObject({ pass: true, flagged: true });
    expect(gate(deskScore(chromeF1({ products: [] }), rules, rates), 'purchasable')).toMatchObject({ pass: true, flagged: true, detail: 'No shop lists it yet' });
  });

  it('no RRP yet passes the price gate, flagged', () => {
    const s = deskScore(chromeF1({ products: [{ configuration: 'hobby', rrpMinor: null, rrpCurrency: null, rrpSource: null, listings: [shop()] }] }), rules, rates);
    expect(gate(s, 'price')).toMatchObject({ pass: true, flagged: true });
    expect(s.gated).toBe(false);
  });

  it('a switched-off category fails scope (UFC)', () => {
    expect(gate(deskScore(chromeF1({ category: 'ufc' }), rules, rates), 'scope')).toMatchObject({ pass: false, detail: 'ufc is switched off in the rules' });
  });
});

describe('owner override', () => {
  it('replaces the score and label but keeps what the rules said', () => {
    const s = deskScore(chromeF1({ override: { score: 90, note: 'F1 rookie year' } }), rules, rates);
    expect(s).toMatchObject({ score: 90, rawScore: 60, label: 'Priority', overridden: true, overrideNote: 'F1 rookie year' });
  });
});

describe('copy rules', () => {
  it('never uses "rip for value" or return language', () => {
    const texts = [deskScore(chromeF1(), rules, rates), deskScore(chromeF1({ products: [] }), rules, rates)].flatMap((s) => [...s.gates.map((g) => g.detail), ...s.breakdown.map((b) => b.reason)]);
    expect(texts.join(' ')).not.toMatch(/rip for value|invest|profit|return|flip|guaranteed/i);
  });
});
