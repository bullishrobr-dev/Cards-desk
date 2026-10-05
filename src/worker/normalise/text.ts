/**
 * Title normalisation shared by classification and matching. Both sides of every comparison go
 * through the same function, so config keywords can be written naturally ("Pokémon", "F1",
 * "Breaker's Delight") and still match "POKEMON", "Formula 1" and "Breakers Delight".
 */

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

/** "2025/26", "2025-26", "2026/ 27", "25/26" → "2025-26". */
function canonicaliseSeasons(s: string): string {
  return s
    .replace(/\b(20\d\d)\s*[/\-–]\s*(\d\d)\b/g, '$1_$2')
    .replace(/(^|[^\d/])(\d\d)\/(\d\d)(?![\d/])/g, (m, pre: string, a: string, b: string) =>
      Number(b) === Number(a) + 1 ? `${pre}20${a}_${b}` : m,
    );
}

export function baseNormalise(input: string): string {
  let s = decodeEntities(input).toLowerCase();
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[’'`´]/g, '');
  s = canonicaliseSeasons(s);
  s = s.replace(/[^a-z0-9_#]+/g, ' ');
  return s.replace(/_/g, '-').replace(/\s+/g, ' ').trim();
}

export interface Normaliser {
  /** Normalised text with synonyms expanded. */
  text(input: string): string;
  /** True when `phrase` (already normalised) occurs as whole words in `text`. */
  has(text: string, phrase: string): boolean;
  /** Normalise a config keyword the same way as titles. */
  keyword(k: string): string;
}

export function createNormaliser(synonyms: Record<string, string>): Normaliser {
  // Longest synonyms first so "formula one" wins over a shorter overlapping key.
  const pairs = Object.entries(synonyms)
    .map(([k, v]) => [baseNormalise(k), baseNormalise(v)] as const)
    .sort((a, b) => b[0].length - a[0].length);

  const expand = (s: string): string => {
    let out = ` ${s} `;
    for (const [from, to] of pairs) out = out.split(` ${from} `).join(` ${to} `);
    return out.trim().replace(/\s+/g, ' ');
  };

  return {
    text: (input) => expand(baseNormalise(input)),
    keyword: (k) => expand(baseNormalise(k)),
    has: (text, phrase) => phrase.length > 0 && ` ${text} `.includes(` ${phrase} `),
  };
}

/** Crude singular form used only inside match keys, never shown to anyone. */
export function singular(token: string): string {
  return token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token;
}
