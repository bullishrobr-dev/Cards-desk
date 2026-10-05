const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID: time-sortable, 26 characters. */
export function ulid(now = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rand = crypto.getRandomValues(new Uint8Array(16));
  let r = '';
  for (const b of rand) r += CROCKFORD[b % 32];
  return time + r;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? null) : Math.round(((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2);
}

/** Placeholders for an IN (...) list. */
export const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(',');

/** Converts minor units between currencies using ECB rates (1 EUR = rate × currency). */
export function convertMinor(amount: number, from: string, to: string, rates: Record<string, number>): number | null {
  if (from === to) return amount;
  const rf = rates[from];
  const rt = rates[to];
  if (!rf || !rt) return null;
  return Math.round((amount / rf) * rt);
}
