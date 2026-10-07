import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCollectoskPost } from './collectosk-post.ts';

const fixture = (slug: string) => readFileSync(`fixtures/collectosk-post/${slug}.json`, 'utf8');

describe('collectosk product post', () => {
  it('reads every format and its published RRP (Topps Chrome F1 2026)', () => {
    const p = parseCollectoskPost(fixture('2026-topps-chrome-formula-1-racing-cards'));
    expect(p.formats.map((f) => f.title.replace('2026 TOPPS Chrome Formula 1 Racing Cards ', ''))).toEqual(['Hobby Box', 'FDI Box', 'Mega Box', 'Value Blaster Box', 'Logofractor Box', 'Hongbao Box']);
    expect(p.formats[0]?.rrp).toEqual({ EUR: 48500, USD: 46999, GBP: 41500 });
    expect(p.formats[1]?.rrp).toEqual({});
    expect(p.formats[3]?.rrp).toEqual({ EUR: 3500, USD: 3499, GBP: 3000 });
    expect(p.modifiedAt).toMatch(/^2026-/);
  });

  it('reads the checklist: distinct names, rookies by the RC badge only', () => {
    const p = parseCollectoskPost(fixture('2026-topps-chrome-formula-1-racing-cards'));
    expect(p.cardCount).toBeGreaterThan(500);
    expect(p.names).toContain('Lando Norris');
    expect(p.names).toContain('Kimi Antonelli');
    expect(p.names.filter((n) => n === 'Lando Norris')).toHaveLength(1);
    expect(p.rookies).toContain('Arvid Lindblad');
    // "1st" marks a first card, which legends also get: not a rookie.
    expect(p.rookies).not.toContain('Emerson Fittipaldi');
    expect(p.names.every((n) => n.length > 2 && !/\(|\)|^\d/.test(n))).toBe(true);
  });

  it('a football checklist with many rookies, and a partial RRP', () => {
    const p = parseCollectoskPost(fixture('2025-26-topps-stadium-club-chrome-uefa-champions-league-soccer-cards'));
    expect(p.formats.map((f) => f.rrp)).toEqual([{ EUR: 24500, USD: 23999, GBP: 22000 }, { EUR: 3000, GBP: 2500 }]);
    expect(p.rookies).toContain('Max Dowman');
    expect(p.rookies.length).toBeGreaterThan(20);
  });

  it('a post with no checklist or RRP yet', () => {
    const p = parseCollectoskPost(fixture('2026-panini-prizm-black-nwsl-soccer-cards'));
    expect(p).toMatchObject({ cardCount: 0, names: [], rookies: [] });
    expect(p.formats).toEqual([{ title: '2026 PANINI Prizm Black NWSL Soccer Cards Hobby Box', rrp: {} }]);
  });

  it('a missing post is a failure, not an empty result', () => {
    expect(() => parseCollectoskPost('[]')).toThrow(/no post/);
    expect(() => parseCollectoskPost('{"code":"rest_no_route"}')).toThrow(/rest_no_route/);
  });

  it('parses the largest post well inside the Free plan CPU budget', () => {
    const body = fixture('2026-topps-chrome-formula-1-racing-cards');
    parseCollectoskPost(body);
    const t = performance.now();
    for (let i = 0; i < 10; i++) parseCollectoskPost(body);
    expect((performance.now() - t) / 10).toBeLessThan(6);
  });
});
