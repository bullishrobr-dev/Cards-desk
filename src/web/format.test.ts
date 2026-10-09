import { describe, expect, it } from 'vitest';
import { countdown, dateLabel, formatMoney, percentVsRrp, rrpLabel, showCountdown, weekStart } from './format.ts';

describe('date wording', () => {
  it('only states what the precision supports', () => {
    expect(dateLabel('2026-10-15', 'day')).toBe('Expected Thu, 15 Oct 2026');
    expect(dateLabel('2026-11-01', 'month')).toBe('Expected November 2026');
    expect(dateLabel('2026-10-15', 'week')).toBe('Expected week of Mon, 12 Oct 2026');
    expect(dateLabel(null, 'unknown')).toBe('Date to be confirmed');
  });

  it('shows exact times in Gibraltar time', () => {
    expect(dateLabel('2026-10-15T08:00:00Z', 'time')).toBe('Thu, 15 Oct 2026, 10:00 CEST');
  });

  it('weeks start on Monday', () => expect(weekStart('2026-10-18')).toBe('2026-10-12'));
});

describe('countdown', () => {
  it('appears only with a confirmed time', () => {
    expect(showCountdown('time', 'confirmed_time')).toBe(true);
    expect(showCountdown('day', 'confirmed_date')).toBe(false);
    expect(showCountdown('time', 'announced')).toBe(false);
  });
  it('formats days, then hh:mm:ss in the final day', () => {
    expect(countdown(new Date('2026-10-15T10:00:00Z'), new Date('2026-10-13T08:30:00Z'))).toBe('2d 01h 30m');
    expect(countdown(new Date('2026-10-15T10:00:00Z'), new Date('2026-10-15T09:50:05Z'))).toBe('0h 09m 55s');
  });
});

describe('money', () => {
  it('shows the original currency with the other converted', () => {
    expect(formatMoney({ minor: 84000, currency: 'GBP', gbp: 84000, eur: 98392 })).toBe('£840.00 (≈ €983.92)');
    expect(formatMoney({ minor: 2000, currency: 'EUR', gbp: 1707, eur: 2000 })).toBe('€20.00 (≈ £17.07)');
  });
});

describe('RRP wording never implies returns', () => {
  it('uses only the two permitted labels', () => {
    expect(rrpLabel(1.0, 1.05)?.text).toBe('At RRP — fine to rip for fun');
    expect(rrpLabel(1.05, 1.05)?.text).toBe('At RRP — fine to rip for fun');
    expect(rrpLabel(1.06, 1.05)?.text).toBe('Above RRP — buy singles instead');
    expect(rrpLabel(null, 1.05)).toBeNull();
  });
  it('states the gap plainly', () => {
    expect(percentVsRrp(1.3)).toBe('30% over RRP');
    expect(percentVsRrp(0.9)).toBe('10% under RRP');
  });
});

describe('card dates', () => {
  it('reads like a release calendar', async () => {
    const { cardDate, weekRange } = await import('./format.ts');
    expect(cardDate('2026-10-15', 'day')).toBe('Thursday 15 Oct');
    expect(cardDate('2026-11-01', 'month')).toBe('Sometime in November');
    expect(cardDate(null, 'unknown')).toBe('Date to be confirmed');
    expect(weekRange('2026-10-12')).toBe('12 – 18 Oct 2026');
    expect(weekRange('2026-09-28')).toBe('28 Sept – 4 Oct 2026');
  });
});
