import { describe, expect, it } from 'vitest';
import { UsageError } from '../../src/core/errors.js';
import { dayRuleFindings, finalFrom, fiscalYearStart, lastFinalDay, parseExportPeriod, splitPeriod } from '../../src/export/index.js';

describe('export period flags', () => {
  it('expands --month to the whole month and keeps --from/--to inclusive', () => {
    expect(parseExportPeriod({ month: '2026-10' })).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(parseExportPeriod({ month: '2028-02' })).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(parseExportPeriod({ from: '2026-09-25', to: '2026-10-05' })).toEqual({ from: '2026-09-25', to: '2026-10-05' });
  });

  it('rejects a missing period, both forms at once and malformed values as usage errors', () => {
    const cases: [Parameters<typeof parseExportPeriod>[0], string][] = [
      [{}, 'The export needs a period. Give the period as --month YYYY-MM or as --from YYYY-MM-DD --to YYYY-MM-DD'],
      [{ month: '2026-10', from: '2026-10-01', to: '2026-10-02' }, 'Use either --month or --from/--to, not both.'],
      [{ month: '2026-13' }, '--month must be a month written YYYY-MM'],
      [{ month: '10/2026' }, '--month must be a month written YYYY-MM'],
      [{ from: '2026-10-01' }, '--from and --to go together.'],
      [{ from: '2026-10-05', to: '2026-10-01' }, '--to 2026-10-01 lies before --from 2026-10-05.'],
      [{ from: '2026-02-30', to: '2026-03-01' }, '--from must be a date written YYYY-MM-DD'],
    ];
    for (const [flags, message] of cases) {
      expect(() => parseExportPeriod(flags)).toThrow(UsageError);
      expect(() => parseExportPeriod(flags)).toThrow(message);
    }
  });
});

describe('splitting a period into files', () => {
  it('splits a range across two months into one part per month', () => {
    expect(splitPeriod({ from: '2026-09-25', to: '2026-10-05' }, '01-01')).toEqual([
      { from: '2026-09-25', to: '2026-09-30', month: '2026-09', wjBeginn: '2026-01-01' },
      { from: '2026-10-01', to: '2026-10-05', month: '2026-10', wjBeginn: '2026-01-01' },
    ]);
  });

  it('keeps a single month whole and crosses the calendar year into a new fiscal year', () => {
    expect(splitPeriod({ from: '2026-10-01', to: '2026-10-31' }, '01-01')).toHaveLength(1);
    expect(splitPeriod({ from: '2026-12-30', to: '2027-01-02' }, '01-01')).toEqual([
      { from: '2026-12-30', to: '2026-12-31', month: '2026-12', wjBeginn: '2026-01-01' },
      { from: '2027-01-01', to: '2027-01-02', month: '2027-01', wjBeginn: '2027-01-01' },
    ]);
  });

  it('takes WJ-Beginn as the latest fiscal-year start on or before the part: 07-01 and 2027-03 give 2026-07-01', () => {
    expect(fiscalYearStart('2027-03-01', '07-01')).toBe('2026-07-01');
    expect(fiscalYearStart('2027-07-01', '07-01')).toBe('2027-07-01');
    expect(splitPeriod({ from: '2027-03-01', to: '2027-03-31' }, '07-01')).toEqual([
      { from: '2027-03-01', to: '2027-03-31', month: '2027-03', wjBeginn: '2026-07-01' },
    ]);
  });

  it('splits at a fiscal-year start inside a month', () => {
    expect(splitPeriod({ from: '2027-06-10', to: '2027-07-20' }, '06-15')).toEqual([
      { from: '2027-06-10', to: '2027-06-14', month: '2027-06', wjBeginn: '2026-06-15' },
      { from: '2027-06-15', to: '2027-06-30', month: '2027-06', wjBeginn: '2027-06-15' },
      { from: '2027-07-01', to: '2027-07-20', month: '2027-07', wjBeginn: '2027-06-15' },
    ]);
  });
});

describe('day rules', () => {
  const part = (to: string) => ({ from: '2026-10-01' as const, to: to as `${number}-${number}-${number}` });

  it('refuses a period that reaches today or later', () => {
    for (const to of ['2026-10-20', '2026-10-31']) {
      const [finding] = dayRuleFindings(part(to), '2026-10-20', 'Europe/Berlin');
      expect(finding?.code).toBe('E-DAY-NOT-CLOSED');
      expect(finding?.message).toContain('today (or later) in Europe/Berlin');
      expect(finding?.message).toContain('not closed that day with the night audit yet');
      expect(finding?.message).toContain('Export up to 2026-10-18');
    }
  });

  it('warns when the period ends yesterday and accepts the day before yesterday silently', () => {
    expect(dayRuleFindings(part('2026-10-19'), '2026-10-20', 'Europe/Berlin').map((f) => f.code)).toEqual(['W-RECENT-DAY']);
    expect(dayRuleFindings(part('2026-10-18'), '2026-10-20', 'Europe/Berlin')).toEqual([]);
  });
});

describe('the last final day for the scheduled run', () => {
  it('is the day before yesterday from finalAfter on, and the day before that until then, in local time', () => {
    // 2026-10-20 05:59:59 and 06:00 in Berlin (CEST, UTC+2).
    expect(lastFinalDay(new Date('2026-10-20T03:59:59Z'), 'Europe/Berlin', '06:00')).toBe('2026-10-17');
    expect(lastFinalDay(new Date('2026-10-20T04:00:00Z'), 'Europe/Berlin', '06:00')).toBe('2026-10-18');
    expect(lastFinalDay(new Date('2026-10-20T04:00:00Z'), 'Asia/Tokyo', '06:00')).toBe('2026-10-18');
    expect(lastFinalDay(new Date('2026-10-20T04:00:00Z'), 'America/New_York', '06:00')).toBe('2026-10-17');
    expect(lastFinalDay(new Date('2026-10-19T22:00:00Z'), 'Europe/Berlin', '00:00')).toBe('2026-10-18');
  });

  it('crosses month and year ends', () => {
    expect(lastFinalDay(new Date('2027-01-01T08:00:00Z'), 'Europe/Berlin', '06:00')).toBe('2026-12-30');
    expect(lastFinalDay(new Date('2027-01-02T04:59:59Z'), 'Europe/Berlin', '06:00')).toBe('2026-12-30');
    expect(finalFrom('2026-12-31')).toBe('2027-01-02');
  });
});
