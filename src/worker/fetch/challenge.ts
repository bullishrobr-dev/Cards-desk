/**
 * Detects bot-protection pages. A challenge is a failure with no data: it must never be parsed
 * as an empty catalogue, or every product would look sold out.
 *
 * Seen in Phase 0:
 * - Shopify/Cloudflare: HTTP 429 or 403, `cf-mitigated: challenge`, "Just a moment..." or
 *   "Verifying your connection".
 * - Imperva Incapsula: HTTP 403 with "Incapsula incident ID", or HTTP 200 with an
 *   `_Incapsula_Resource` iframe (Pokémon Center), or a "Pardon Our Interruption" interstitial.
 * - SiteGround: a meta refresh to `/.well-known/sgcaptcha/`.
 */

export interface ChallengeVerdict {
  challenged: boolean;
  vendor?: 'cloudflare' | 'imperva' | 'siteground' | 'unknown';
  reason?: string;
}

const BODY_MARKERS: Array<{ re: RegExp; vendor: ChallengeVerdict['vendor']; reason: string }> = [
  { re: /<title>\s*Just a moment\.\.\.\s*<\/title>/i, vendor: 'cloudflare', reason: 'Cloudflare "Just a moment" page' },
  { re: /Verifying your connection/i, vendor: 'cloudflare', reason: 'Cloudflare "Verifying your connection" page' },
  { re: /challenges\.cloudflare\.com/i, vendor: 'cloudflare', reason: 'Cloudflare challenge script' },
  { re: /_Incapsula_Resource/i, vendor: 'imperva', reason: 'Imperva challenge iframe' },
  { re: /Incapsula incident ID/i, vendor: 'imperva', reason: 'Imperva block page' },
  { re: /Pardon Our Interruption/i, vendor: 'imperva', reason: 'Imperva interstitial' },
  { re: /\/\.well-known\/sgcaptcha\//i, vendor: 'siteground', reason: 'SiteGround captcha redirect' },
];

export function detectChallenge(
  status: number,
  headers: Headers,
  bodyHead: string,
  expected: 'json' | 'html' | 'xml',
): ChallengeVerdict {
  if (headers.get('cf-mitigated')?.toLowerCase() === 'challenge') {
    return { challenged: true, vendor: 'cloudflare', reason: `cf-mitigated: challenge (HTTP ${status})` };
  }
  if (headers.get('sg-captcha')) {
    return { challenged: true, vendor: 'siteground', reason: 'sg-captcha header' };
  }
  for (const m of BODY_MARKERS) {
    if (m.re.test(bodyHead)) return { challenged: true, vendor: m.vendor, reason: `${m.reason} (HTTP ${status})` };
  }
  // A JSON or XML endpoint answering with HTML is never real data.
  const type = headers.get('content-type') ?? '';
  if (expected !== 'html' && /text\/html/i.test(type) && /^\s*</.test(bodyHead)) {
    return { challenged: true, vendor: 'unknown', reason: `expected ${expected}, got HTML (HTTP ${status})` };
  }
  return { challenged: false };
}
