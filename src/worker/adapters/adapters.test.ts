import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sources } from '../../shared/config/index.ts';
import { parseDate, tableGrid, toMinor } from './parse-utils.ts';
import {
  parseChecklistInsider,
  parseCollectosk,
  parseEcbFx,
  parsePcZendesk,
  parsePressPokemonEuHome,
  parsePressPokemonEuRelease,
  parsePressPokemonNa,
  parseSerebii,
} from './calendars.ts';
import { detectPreorder, parseShopify, parseWooCommerce, shopifyUnit, wooUnit } from './shops.ts';
import type { ListingObservation, ReleaseObservation } from './types.ts';

const fx = (p: string) => readFileSync(`fixtures/${p}`, 'utf8');
const retailer = (id: string) => {
  const r = sources.retailers.find((x) => x.id === id);
  if (!r) throw new Error(id);
  return r;
};
const releases = (items: unknown[]) => items as ReleaseObservation[];
const listings = (items: unknown[]) => items as ListingObservation[];

describe('parse utilities', () => {
  it.each([
    ['2026-10-15', '2026-10-15', 'day'],
    ['November 6, 2026', '2026-11-06', 'day'],
    ['November 6th 2026', '2026-11-06', 'day'],
    ['6 November 2026', '2026-11-06', 'day'],
    ['20/08/2026', '2026-08-20', 'day'],
    ['27/08/2026', '2026-08-27', 'day'],
    ['Early November 2026', '2026-11-01', 'month'],
    ['Mid to late November 2026', '2026-11-01', 'month'],
    ['TBD', null, 'unknown'],
    ['January 9th 1999', '1999-01-09', 'day'],
    ['31/02/2026', null, 'unknown'],
  ])('parseDate(%s)', (raw, date, precision) => {
    expect(parseDate(raw)).toEqual({ date, precision });
  });

  it('converts prices to minor units without float drift', () => {
    expect(toMinor('649.99')).toBe(64999);
    expect(toMinor('0.29')).toBe(29);
    expect(toMinor('')).toBeNull();
  });

  it('expands rowspans in tables', () => {
    const g = tableGrid('<table><tr><td rowspan="2">A</td><td>1</td></tr><tr><td>2</td></tr></table>');
    expect(g).toEqual([['A', '1'], ['A', '2']]);
  });
});

describe('collectosk', () => {
  const r = releases(parseCollectosk(fx('collectosk/response.json'), 'confirmed_date').items);

  it('reads all 52 rows', () => expect(r).toHaveLength(52));

  it('reads Topps Chrome F1 with its date and category', () => {
    const f1 = r.find((x) => x.title.includes('TOPPS Chrome Formula 1'));
    expect(f1).toMatchObject({ date: '2026-10-15', precision: 'day', confidence: 'confirmed_date', categoryHint: 'Racing' });
    expect(f1?.title).toBe('2026 TOPPS Chrome Formula 1');
  });

  it('keeps TBD rows as announced with no date', () => {
    const tbd = r.find((x) => x.title.includes('Carbon Formula 1'));
    expect(tbd).toMatchObject({ date: null, precision: 'unknown', confidence: 'announced', rawDate: 'TBD' });
  });

  it('drops "(Pre-order)" and emoji from names', () => {
    expect(r.some((x) => /pre-?order|🎾|⚽/i.test(x.title))).toBe(false);
  });

  it('fails loudly when the markup changes', () => {
    expect(() => parseCollectosk('{"content":{"rendered":"<p>nothing</p>"}}', 'confirmed_date')).toThrow(/markup changed/);
  });
});

describe('Checklist Insider', () => {
  const r = releases(parseChecklistInsider(fx('checklistinsider/response.html'), 'confirmed_date').items);
  it('strips a bare "Guide" suffix too', () => {
    expect(r.some((x) => /\bGuide$/.test(x.title))).toBe(false);
  });

  it('reads dated releases and strips "Checklist Guide"', () => {
    expect(r.length).toBeGreaterThan(30);
    expect(r[0]).toMatchObject({ title: '2026 Topps Atlassian Williams Racing', date: '2026-10-01', precision: 'day' });
  });
});

describe('Pokémon press (NA)', () => {
  const r = releases(parsePressPokemonNa(fx('press-pokemon-na/response.html'), 'confirmed_date', 'https://press.pokemon.com').items);
  it('reads the schedule newest first', () => {
    expect(r[0]).toMatchObject({ title: 'Pokémon TCG: Mega Evolution—Delta Reign', date: '2026-11-06', confidence: 'confirmed_date' });
    expect(r[0]?.url).toBe('https://press.pokemon.com/en/products/Pokemon-TCG-Mega-EvolutionDelta-Reign');
    expect(r.find((x) => x.title.endsWith('30th Celebration'))?.date).toBe('2026-09-16');
  });
});

describe('Pokémon press (EU)', () => {
  const home = parsePressPokemonEuHome(fx('press-pokemon-eu/response.html'), 'press-pokemon-eu', 'https://pokemon.gamespress.com');

  it('follows TCG headlines only (not TCG Pocket)', () => {
    const delta = home.followUps.find((u) => u.context?.set === 'Mega Evolution—Delta Reign');
    expect(delta?.url).toBe('https://pokemon.gamespress.com/en-GB/MEDIA-ALERT-New-Pokemon-Trading-Card-Game-Mega-EvolutionDelta-Reign-Ex');
    expect(home.followUps.some((u) => /pocket/i.test(u.context?.headline ?? ''))).toBe(false);
  });

  it('reads the release date from the press release, not the prerelease date', () => {
    const unit = home.followUps.find((u) => u.context?.set === 'Mega Evolution—Delta Reign');
    if (!unit) throw new Error('no follow-up');
    const r = releases(parsePressPokemonEuRelease(fx('press-pokemon-eu/release-delta-reign.html'), unit, 'confirmed_date').items);
    expect(r[0]).toMatchObject({ title: 'Pokémon TCG: Mega Evolution—Delta Reign', date: '2026-11-06', region: 'EU' });
  });
});

describe('Pokémon Center pre-order article', () => {
  const r = releases(parsePcZendesk(fx('pc-zendesk/response.json')).items);
  it('keeps UK TCG rows with month-level ship windows', () => {
    const etb = r.find((x) => x.title === 'Pokémon TCG: Mega Evolution—Delta Reign Pokémon Center Elite Trainer Box');
    expect(etb).toMatchObject({ date: '2026-11-01', precision: 'month', confidence: 'announced', region: 'UK', rawDate: 'Early November 2026' });
  });
  it('carries a rowspanned date to every item in the group', () => {
    expect(r.find((x) => x.title.includes('Delta Reign Booster Display Box'))?.rawDate).toBe('Early November 2026');
  });
  it('skips non-TCG merchandise', () => {
    expect(r.some((x) => /plush|polaroid|lego/i.test(x.title))).toBe(false);
  });
});

describe('Serebii', () => {
  const r = releases(parseSerebii(fx('serebii/response.html'), 'announced', 'https://www.serebii.net').items);
  it('reads set names and dates', () => {
    expect(r[0]).toMatchObject({ title: 'Pokémon TCG: Delta Reign', date: '2026-11-06', confidence: 'announced' });
  });
});

describe('ECB reference rates', () => {
  it('reads GBP and USD against EUR', () => {
    const [item] = parseEcbFx(fx('ecb-fx/eurofxref-daily.xml')).items;
    expect(item).toMatchObject({ kind: 'fx' });
    if (item?.kind !== 'fx') throw new Error();
    expect(item.rates.GBP).toBeGreaterThan(0.5);
    expect(item.rates.EUR).toBe(1);
  });
});

describe('Shopify', () => {
  const scd = retailer('sportscardsdirect');
  const unit = shopifyUnit(scd, '/products.json');
  const res = parseShopify(fx('sportscardsdirect/products-0-page1.json'), unit, scd);
  const items = listings(res.items);

  it('emits one listing per variant with price in minor units', () => {
    const f1 = items.find((x) => x.title === 'Topps Chrome Formula 1 2026 Hobby Box - Pre-Order');
    expect(f1).toMatchObject({ priceMinor: 84000, currency: 'GBP', available: false, isPreorder: true, productType: 'f1' });
    expect(f1?.url).toBe('https://www.sportscardsdirect.co.uk/products/topps-chrome-formula-1-2026-hobby-box-pre-order');
  });

  it('asks for the next page when the page is full', () => {
    expect(res.followUps).toEqual([{ ...unit, url: 'https://www.sportscardsdirect.co.uk/products.json?limit=50&page=2', key: '/products.json?page=2' }]);
  });

  it('marks Pokemillon pre-orders by tag and keeps language variants apart', () => {
    const pm = retailer('pokemillon');
    const out = listings(parseShopify(fx('pokemillon/products-0-page1.json'), shopifyUnit(pm, pm.paths[0] ?? ''), pm).items);
    const variants = out.filter((x) => x.title === 'ETB Equilibrio Perfecto | Perfect Order');
    expect(variants.map((v) => v.variantTitle)).toEqual(['Español', 'Inglés']);
    expect(variants[1]?.url).toContain('?variant=');
  });

  it('stops paging on a short page', () => {
    const mc = retailer('metamorph-center');
    expect(parseShopify(fx('metamorph-center/products-0-page1.json'), shopifyUnit(mc, mc.paths[0] ?? ''), mc).followUps).toEqual([]);
  });

  it('rejects a non-catalogue response instead of reporting an empty shop', () => {
    expect(() => parseShopify('{"errors":"Not found"}', unit, scd)).toThrow(/no products array/);
  });
});

describe('pre-order rules', () => {
  it('supports tag prefixes, title prefixes and body dates', () => {
    expect(detectPreorder({ tags: ['pre-order*'], title_prefixes: [], title_suffixes: [], title_contains: [] }, 'x', ['pre-order-Q42026'], '').isPreorder).toBe(true);
    expect(detectPreorder({ tags: [], title_prefixes: ['Pre Order - '], title_suffixes: [], title_contains: [] }, 'Pre Order - 2026 Topps', [], '').isPreorder).toBe(true);
    const v = detectPreorder({ tags: [], title_prefixes: [], title_suffixes: [], title_contains: [], body_date_regex: 'RELEASE DATE:\\s*(\\d{1,2}/\\d{1,2}/\\d{4})' }, 'x', [], 'Box. RELEASE DATE: 27/08/2026.');
    expect(v).toEqual({ isPreorder: true, releaseText: '27/08/2026' });
  });
});

describe('WooCommerce Store API', () => {
  const sc = retailer('sportycards');
  const unit = wooUnit(sc, sc.paths[0] ?? '');
  const res = parseWooCommerce(fx('sportycards/products-0-page1.json'), unit, sc);
  const items = listings(res.items);
  it('reads price from minor units, decodes names and detects PREORDER', () => {
    const nt = items.find((x) => x.title.startsWith('PREORDER: Panini National Treasures'));
    expect(nt).toMatchObject({ priceMinor: 189900, currency: 'EUR', isPreorder: true, available: true });
    expect(nt?.title).toBe('PREORDER: Panini National Treasures Road to FIFA World Cup 2026 – Hobby Box');
  });
  it('pages on', () => expect(res.followUps[0]?.key).toBe('/wp-json/wc/store/v1/products?page=2'));
});
