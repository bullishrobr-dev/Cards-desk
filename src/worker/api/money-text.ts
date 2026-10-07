const SYMBOL: Record<string, string> = { GBP: '£', EUR: '€', USD: '$' };

/** "£415.00", "€485.00"; other currencies as "123.45 CHF". */
export function formatMinorPlain(minor: number, currency: string): string {
  const v = (minor / 100).toFixed(2);
  const s = SYMBOL[currency];
  return s ? `${s}${v}` : `${v} ${currency}`;
}
