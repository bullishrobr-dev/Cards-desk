import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isAllowed, parseRobots } from './robots.ts';
import { detectChallenge } from './challenge.ts';
import { backoffMinutes, nextBackoff } from './backoff.ts';
import { politeFetch } from './polite-fetch.ts';

const fx = (name: string) => readFileSync(`fixtures/fetch/${name}`, 'utf8');
const UA = 'CardDeskDrops/0.1 (personal release tracker)';

describe('robots.txt', () => {
  it('allows Shopify product feeds and blocks the cart (real Zatu file)', () => {
    const p = parseRobots(fx('robots-shopify-zatu.txt'), UA);
    expect(isAllowed(p, '/products.json?limit=50&page=2')).toBe(true);
    expect(isAllowed(p, '/collections/booster-boxes-pokemon/products.json')).toBe(true);
    expect(isAllowed(p, '/cart/shipping_rates.json')).toBe(false);
    expect(isAllowed(p, '/collections/all?sort_by=price')).toBe(false);
  });

  it('applies Zatu Crawl-delay only to the bots it names, not to *', () => {
    expect(parseRobots(fx('robots-shopify-zatu.txt'), UA).crawlDelaySeconds).toBeNull();
    expect(parseRobots(fx('robots-shopify-zatu.txt'), 'AhrefsBot/7.0').crawlDelaySeconds).toBe(10);
  });

  it('allows the collectosk API but not RSS feeds', () => {
    const p = parseRobots(fx('robots-collectosk.txt'), UA);
    expect(isAllowed(p, '/wp-json/wp/v2/pages?slug=new-release-calendar')).toBe(true);
    expect(isAllowed(p, '/new-release-calendar/feed/')).toBe(false);
    expect(isAllowed(p, '/wp-admin/admin-ajax.php')).toBe(true);
    expect(isAllowed(p, '/wp-admin/options.php')).toBe(false);
  });

  it('reads Crawl-Delay 5 on the Pokémon press site', () => {
    expect(parseRobots(fx('robots-press-pokemon.txt'), UA).crawlDelaySeconds).toBe(5);
  });

  it('prefers a group naming our bot over *', () => {
    const p = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: CardDeskDrops\nAllow: /\n', UA);
    expect(isAllowed(p, '/anything')).toBe(true);
  });

  it('longest match wins and $ anchors', () => {
    const p = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a/b\nDisallow: /*.pdf$\n', UA);
    expect(isAllowed(p, '/a/x')).toBe(false);
    expect(isAllowed(p, '/a/b/c')).toBe(true);
    expect(isAllowed(p, '/file.pdf')).toBe(false);
    expect(isAllowed(p, '/file.pdf?x=1')).toBe(true);
  });
});

describe('challenge detection', () => {
  const h = (o: Record<string, string>) => new Headers(o);

  it('flags Shopify/Cloudflare 429 challenges by header', () => {
    expect(detectChallenge(429, h({ 'cf-mitigated': 'challenge', 'content-type': 'text/html' }), '<html>', 'json').challenged).toBe(true);
  });

  it('flags the Cloudflare "Just a moment" page by body', () => {
    const v = detectChallenge(403, h({ 'content-type': 'text/html' }), fx('challenge-cloudflare.html'), 'html');
    expect(v).toMatchObject({ challenged: true, vendor: 'cloudflare' });
  });

  it('flags Imperva even when it answers HTTP 200 (Pokémon Center)', () => {
    const v = detectChallenge(200, h({ 'content-type': 'text/html' }), fx('challenge-incapsula-200.html'), 'html');
    expect(v).toMatchObject({ challenged: true, vendor: 'imperva' });
  });

  it('flags the Imperva interstitial and SiteGround captcha', () => {
    expect(detectChallenge(200, h({}), fx('challenge-incapsula-interstitial.html'), 'html').vendor).toBe('imperva');
    expect(detectChallenge(202, h({}), fx('challenge-sgcaptcha.html'), 'html').vendor).toBe('siteground');
  });

  it('treats HTML from a JSON endpoint as a challenge', () => {
    expect(detectChallenge(200, h({ 'content-type': 'text/html' }), '<!doctype html><p>hi', 'json').challenged).toBe(true);
  });

  it('passes real JSON', () => {
    expect(detectChallenge(200, h({ 'content-type': 'application/json' }), '{"products":[]}', 'json').challenged).toBe(false);
  });
});

describe('back-off', () => {
  it('doubles from 15 minutes and caps at 24 hours', () => {
    expect([0, 1, 2, 3].map(backoffMinutes)).toEqual([15, 30, 60, 120]);
    expect(backoffMinutes(20)).toBe(1440);
  });

  it('respects a longer Retry-After', () => {
    const now = new Date('2026-10-05T10:00:00Z');
    expect(nextBackoff(0, '3600', now).until.toISOString()).toBe('2026-10-05T11:00:00.000Z');
    expect(nextBackoff(0, '5', now).until.toISOString()).toBe('2026-10-05T10:15:00.000Z');
  });
});

describe('politeFetch', () => {
  const fakeFetch = (res: Response, seen: Request[] = []): typeof fetch =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Request(input, init));
      return res;
    }) as typeof fetch;

  it('sends our User-Agent and conditional headers', async () => {
    const seen: Request[] = [];
    await politeFetch(
      { url: 'https://shop.test/products.json', userAgent: UA, expected: 'json', etag: 'W/"x"', lastModified: 'Thu, 01 Oct 2026 13:56:29 GMT' },
      fakeFetch(new Response(null, { status: 304 }), seen),
    );
    expect(seen[0]?.headers.get('user-agent')).toBe(UA);
    expect(seen[0]?.headers.get('if-none-match')).toBe('W/"x"');
    expect(seen[0]?.headers.get('if-modified-since')).toBe('Thu, 01 Oct 2026 13:56:29 GMT');
  });

  it('returns not_modified on 304', async () => {
    const r = await politeFetch({ url: 'https://x.test/', userAgent: UA, expected: 'json' }, fakeFetch(new Response(null, { status: 304 })));
    expect(r.kind).toBe('not_modified');
  });

  it('never returns a challenge page as data', async () => {
    const res = new Response('<html><title>Just a moment...</title>', { status: 429, headers: { 'content-type': 'text/html', 'retry-after': '5' } });
    const r = await politeFetch({ url: 'https://x.test/products.json', userAgent: UA, expected: 'json' }, fakeFetch(res));
    expect(r).toMatchObject({ kind: 'challenge', status: 429, retryAfter: '5' });
  });

  it('returns body and validators on 200', async () => {
    const res = new Response('{"products":[]}', { status: 200, headers: { 'content-type': 'application/json', etag: 'W/"abc"' } });
    const r = await politeFetch({ url: 'https://x.test/products.json', userAgent: UA, expected: 'json' }, fakeFetch(res));
    expect(r).toMatchObject({ kind: 'ok', etag: 'W/"abc"', body: '{"products":[]}' });
  });

  it('reports network errors', async () => {
    const boom = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    expect(await politeFetch({ url: 'https://x.test/', userAgent: UA, expected: 'html' }, boom)).toEqual({ kind: 'network_error', error: 'ECONNRESET' });
  });
});
