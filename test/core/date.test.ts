import { describe, expect, it } from 'vitest';
import { addDays, addOneYear, eachDay, isLocalDate, localDateIn, localDateTimeIn, nextDay, parseLocalDate, previousDay } from '../../src/core/date.js';

describe('LocalDate', () => {
  it('accepts real calendar dates only', () => {
    expect(parseLocalDate('2026-10-05')).toEqual({ year: 2026, month: 10, day: 5 });
    expect(isLocalDate('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-29', '2026-13-01', '2026-00-10', '2026-10-32', '2026-1-05', '05.10.2026', '']) {
      expect(isLocalDate(bad), bad).toBe(false);
    }
  });

  it('adds one year, clamping 29 February', () => {
    expect(addOneYear('2026-01-01')).toBe('2027-01-01');
    expect(addOneYear('2028-02-29')).toBe('2029-02-28');
  });

  it('steps back one day across month and year ends', () => {
    expect(previousDay('2027-01-01')).toBe('2026-12-31');
    expect(previousDay('2028-03-01')).toBe('2028-02-29');
    expect(previousDay('2026-10-05')).toBe('2026-10-04');
  });

  it('throws on invalid input to the calculations', () => {
    expect(() => addOneYear('2026-02-30')).toThrow(TypeError);
  });

  it('steps forward one day across month and year ends', () => {
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    expect(nextDay('2028-02-28')).toBe('2028-02-29');
    expect(nextDay('2026-02-28')).toBe('2026-03-01');
    expect(nextDay('2026-10-05')).toBe('2026-10-06');
  });

  it('lists every day of a period with an exclusive end', () => {
    expect(eachDay('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
    expect(eachDay('2026-10-01', '2026-10-01')).toEqual([]);
    expect(() => eachDay('2026-10-02', '2026-10-01')).toThrow(RangeError);
  });

  it('gives the calendar date of an instant in a time zone', () => {
    const lateEvening = new Date('2026-09-15T22:30:00Z');
    expect(localDateIn(lateEvening, 'Europe/Berlin')).toBe('2026-09-16');
    expect(localDateIn(lateEvening, 'UTC')).toBe('2026-09-15');
    expect(localDateIn(new Date('2026-01-01T03:00:00Z'), 'America/New_York')).toBe('2025-12-31');
  });
});

describe('addDays', () => {
  it('moves across month, year and leap-day boundaries in both directions', () => {
    expect(addDays('2026-10-20', -2)).toBe('2026-10-18');
    expect(addDays('2026-03-01', -2)).toBe('2026-02-27');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-11-03', -40)).toBe('2026-09-24');
    expect(addDays('2026-10-20', 0)).toBe('2026-10-20');
  });
});

describe('localDateTimeIn', () => {
  it('writes local time with the offset of that instant, summer and winter', () => {
    expect(localDateTimeIn(new Date('2026-11-03T05:00:12.345Z'), 'Europe/Berlin')).toBe('2026-11-03T06:00:12+01:00');
    expect(localDateTimeIn(new Date('2026-07-01T22:30:00Z'), 'Europe/Berlin')).toBe('2026-07-02T00:30:00+02:00');
    expect(localDateTimeIn(new Date('2026-07-01T22:30:00Z'), 'UTC')).toBe('2026-07-01T22:30:00+00:00');
    expect(localDateTimeIn(new Date('2026-07-01T22:30:00Z'), 'America/St_Johns')).toBe('2026-07-01T20:00:00-02:30');
  });

  it('follows the switch back to winter time', () => {
    // 2026-10-25: 03:00 CEST becomes 02:00 CET at 01:00 UTC.
    expect(localDateTimeIn(new Date('2026-10-25T00:30:00Z'), 'Europe/Berlin')).toBe('2026-10-25T02:30:00+02:00');
    expect(localDateTimeIn(new Date('2026-10-25T01:30:00Z'), 'Europe/Berlin')).toBe('2026-10-25T02:30:00+01:00');
  });
});
