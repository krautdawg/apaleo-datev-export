import { describe, expect, it } from 'vitest';
import type { ScheduleConfig } from '../../src/core/config.js';
import { duePeriods } from '../../src/schedule/index.js';

const MONTHLY: ScheduleConfig = { timezone: 'Europe/Berlin', cadence: 'monthly', daily: { offsetDays: 2 }, monthly: { dayOfMonth: 3 }, finalAfter: '06:00', catchUpDays: 40 };
const DAILY: ScheduleConfig = { ...MONTHLY, cadence: 'daily' };

const due = (now: string, schedule: Partial<ScheduleConfig> = {}, base = MONTHLY) => duePeriods(new Date(now), { ...base, ...schedule });
const days = (now: string, schedule: Partial<ScheduleConfig> = {}) => due(now, schedule, DAILY).periods.map((p) => (p.from === p.to ? p.from : `${p.from}..${p.to}`));
const months = (now: string, schedule: Partial<ScheduleConfig> = {}) => due(now, schedule).periods.map((p) => `${p.from}..${p.to}`);
const waiting = (now: string, schedule: Partial<ScheduleConfig> = {}, base = MONTHLY) => due(now, schedule, base).waiting.map((p) => `${p.from}..${p.to}`);

describe('monthly cadence', () => {
  it('makes October due on 3 November at 06:30 in Berlin', () => {
    expect(due('2026-11-03T05:30:00Z').today).toBe('2026-11-03');
    expect(months('2026-11-03T05:30:00Z', { catchUpDays: 31 })).toEqual(['2026-10-01..2026-10-31']);
  });

  it('catches up the month before when its due date is still inside catchUpDays, oldest first', () => {
    // September was due on 2026-10-03, 31 days earlier.
    expect(months('2026-11-03T05:30:00Z')).toEqual(['2026-09-01..2026-09-30', '2026-10-01..2026-10-31']);
    // 2026-10-03 is 40 days before 2026-11-12: outside the window.
    expect(months('2026-11-12T08:00:00Z')).toEqual(['2026-10-01..2026-10-31']);
  });

  it('does not make October due on 2 November, also late in the evening, in Berlin time', () => {
    expect(months('2026-11-02T22:59:59Z', { catchUpDays: 30 })).toEqual([]);
    // One second later it is 3 November 00:00 in Berlin.
    expect(months('2026-11-02T23:00:00Z', { catchUpDays: 30 })).toEqual(['2026-10-01..2026-10-31']);
    // In UTC that instant is still 2 November.
    expect(months('2026-11-02T23:00:00Z', { catchUpDays: 30, timezone: 'UTC' })).toEqual([]);
  });

  it('crosses the year end and handles February', () => {
    expect(months('2027-01-03T09:00:00Z', { catchUpDays: 10 })).toEqual(['2026-12-01..2026-12-31']);
    expect(months('2028-03-05T09:00:00Z', { catchUpDays: 10, monthly: { dayOfMonth: 5 } })).toEqual(['2028-02-01..2028-02-29']);
  });

  it('holds a month back with dayOfMonth 1 until 06:00 on the 2nd, after the night audit that closes the 1st', () => {
    const dayOne = { catchUpDays: 5, monthly: { dayOfMonth: 1 } };
    expect(months('2026-07-31T21:59:59Z', dayOne)).toEqual([]);
    expect(waiting('2026-07-31T21:59:59Z', dayOne)).toEqual([]);
    // 2026-07-31T22:05Z is 2026-08-01 00:05 CEST: July ends yesterday, its last night audit may not have run.
    expect(months('2026-07-31T22:05:00Z', dayOne)).toEqual([]);
    expect(waiting('2026-07-31T22:05:00Z', dayOne)).toEqual(['2026-07-01..2026-07-31']);
    // 2 August 00:05: the night audit that closes 1 August, and can still post to 31 July, may not have run either.
    expect(months('2026-08-01T22:05:00Z', dayOne)).toEqual([]);
    expect(waiting('2026-08-01T22:05:00Z', dayOne)).toEqual(['2026-07-01..2026-07-31']);
    expect(waiting('2026-08-02T03:59:59Z', dayOne)).toEqual(['2026-07-01..2026-07-31']);
    // From 2 August 06:00 in Berlin July is final.
    expect(months('2026-08-02T04:00:00Z', dayOne)).toEqual(['2026-07-01..2026-07-31']);
    expect(waiting('2026-08-02T04:00:00Z', dayOne)).toEqual([]);
  });

  it('holds a dayOfMonth 2 month back until schedule.finalAfter on the 2nd', () => {
    const dayTwo = { catchUpDays: 5, monthly: { dayOfMonth: 2 } };
    // 2026-10-01T22:05Z is 2 October 00:05 in Berlin.
    expect(months('2026-10-01T22:05:00Z', dayTwo)).toEqual([]);
    expect(waiting('2026-10-01T22:05:00Z', dayTwo)).toEqual(['2026-09-01..2026-09-30']);
    expect(months('2026-10-02T04:05:00Z', dayTwo)).toEqual(['2026-09-01..2026-09-30']);
    // An earlier finalAfter moves the cut-off.
    expect(months('2026-10-02T02:30:00Z', { ...dayTwo, finalAfter: '04:30' })).toEqual(['2026-09-01..2026-09-30']);
    expect(months('2026-10-02T02:29:59Z', { ...dayTwo, finalAfter: '04:30' })).toEqual([]);
  });

  it('keeps a month that became final on the 2nd inside the smallest monthly window for two more days', () => {
    const smallest = { catchUpDays: 3, monthly: { dayOfMonth: 1 } };
    for (const now of ['2026-08-02T08:00:00Z', '2026-08-03T08:00:00Z', '2026-08-04T08:00:00Z']) expect(months(now, smallest)).toEqual(['2026-07-01..2026-07-31']);
    expect(months('2026-08-05T08:00:00Z', smallest)).toEqual([]);
  });

  it('never lists a month as waiting with dayOfMonth 3 or later', () => {
    for (const dayOfMonth of [3, 4, 5]) {
      for (const now of ['2026-07-31T22:05:00Z', '2026-08-01T22:05:00Z', '2026-08-02T22:05:00Z', '2026-08-05T08:00:00Z']) {
        expect(waiting(now, { monthly: { dayOfMonth } })).toEqual([]);
      }
    }
  });
});

describe('daily cadence', () => {
  it('makes 2026-10-18 due on 2026-10-20 with offsetDays 2, from 06:00', () => {
    expect(days('2026-10-20T08:00:00Z', { catchUpDays: 5 })).toEqual(['2026-10-16', '2026-10-17', '2026-10-18']);
    // 2026-10-19T22:05Z is 2026-10-20 00:05 CEST: the audit that closes 19 October can still post to 18 October.
    expect(days('2026-10-19T22:05:00Z', { catchUpDays: 5 })).toEqual(['2026-10-16', '2026-10-17']);
    expect(waiting('2026-10-19T22:05:00Z', { catchUpDays: 5 }, DAILY)).toEqual(['2026-10-18..2026-10-18']);
    expect(days('2026-10-20T04:00:00Z', { catchUpDays: 5 }).at(-1)).toBe('2026-10-18');
  });

  it('holds yesterday back with offsetDays 1 until 06:00 the day after', () => {
    const dayMinusOne = { catchUpDays: 5, daily: { offsetDays: 1 } };
    // 2026-10-19T22:05Z is 2026-10-20 00:05 CEST.
    expect(days('2026-10-19T22:05:00Z', dayMinusOne).at(-1)).toBe('2026-10-17');
    expect(waiting('2026-10-19T22:05:00Z', dayMinusOne, DAILY)).toEqual(['2026-10-18..2026-10-18', '2026-10-19..2026-10-19']);
    expect(days('2026-10-20T21:59:59Z', dayMinusOne).at(-1)).toBe('2026-10-18');
    expect(waiting('2026-10-20T21:59:59Z', dayMinusOne, DAILY)).toEqual(['2026-10-19..2026-10-19']);
    // 2026-10-21 06:00 in Berlin: 2026-10-19 is final.
    expect(days('2026-10-21T04:00:00Z', dayMinusOne).at(-1)).toBe('2026-10-19');
    expect(waiting('2026-10-20T08:05:00Z', {}, DAILY)).toEqual([]);
  });

  it('keeps a day inside the smallest daily window until four days after it', () => {
    const smallest = { catchUpDays: 5 };
    for (const now of ['2026-10-20T08:00:00Z', '2026-10-21T08:00:00Z', '2026-10-22T08:00:00Z']) expect(days(now, smallest)).toContain('2026-10-18');
    expect(days('2026-10-23T08:00:00Z', smallest)).not.toContain('2026-10-18');
  });

  it('lists every day of the catch-up window oldest first', () => {
    const list = days('2026-10-20T08:00:00Z');
    expect(list[0]).toBe('2026-09-11'); // 2026-10-20 minus 39 days: d > today - catchUpDays
    expect(list.at(-1)).toBe('2026-10-18');
    expect(list).toHaveLength(38);
  });

  it('crosses month ends and leap days', () => {
    expect(days('2026-03-02T10:00:00Z', { catchUpDays: 5 })).toEqual(['2026-02-26', '2026-02-27', '2026-02-28']);
    expect(days('2028-03-02T10:00:00Z', { catchUpDays: 5, daily: { offsetDays: 1 } }).at(-1)).toBe('2028-02-29');
    expect(waiting('2028-03-01T10:00:00Z', { catchUpDays: 5, daily: { offsetDays: 1 } }, DAILY)).toEqual(['2028-02-29..2028-02-29']);
  });

  it('takes "today" and the 06:00 cut-off in the configured zone around the summer-time changes', () => {
    // 2026-03-29T04:30Z is 06:30 CEST on the day clocks go forward; in UTC it is 04:30, before the cut-off.
    expect(days('2026-03-29T04:30:00Z', { catchUpDays: 5 }).at(-1)).toBe('2026-03-27');
    expect(days('2026-03-29T04:30:00Z', { catchUpDays: 5, timezone: 'UTC' }).at(-1)).toBe('2026-03-26');
    // 2026-10-25T05:00Z is 06:00 CET on the day clocks go back; one second earlier it is 05:59:59.
    expect(days('2026-10-25T05:00:00Z', { catchUpDays: 5 }).at(-1)).toBe('2026-10-23');
    expect(days('2026-10-25T04:59:59Z', { catchUpDays: 5 }).at(-1)).toBe('2026-10-22');
  });

  it('is a pure function of the clock and the config', () => {
    expect(due('2026-10-20T08:00:00Z', {}, DAILY)).toEqual(due('2026-10-20T08:00:00Z', {}, DAILY));
  });
});
