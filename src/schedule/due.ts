import type { ScheduleConfig } from '../core/config.js';
import { addDays, endOfMonth, localDateIn, nextDay, previousDay, type LocalDate } from '../core/date.js';
import { finalFrom, lastFinalDay, type DateRange } from '../export/index.js';

export interface DuePeriods {
  /** The date of `now` in `schedule.timezone`. */
  today: LocalDate;
  /** Every due and final period inside the catch-up window, oldest first. */
  periods: DateRange[];
  /**
   * Periods the settings make due already but that are not final yet in
   * `schedule.timezone` (see `lastFinalDay`): apaleo can still add postings for
   * their last day until the night audit that closes the following day, so they
   * are exported by the first run after `schedule.finalAfter` two days after
   * their last day.
   */
  waiting: DateRange[];
}

/**
 * The periods due at `now` (design decision 2), a pure function of the clock
 * and the config. `final` is the last final day (`lastFinalDay`): the day
 * before yesterday from `schedule.finalAfter` on, before that the day before.
 * - daily: every day `d` with `d <= today - offsetDays` and `d > today - catchUpDays`,
 *   in `periods` when `d <= final`, else in `waiting`;
 * - monthly: every calendar month whose `dayOfMonth` of the next month is on or
 *   before today, in `waiting` while its last day is after `final`, else in
 *   `periods` when its due date (that day, at the earliest two days after the
 *   month) is after `today - catchUpDays`.
 */
export function duePeriods(now: Date, schedule: ScheduleConfig): DuePeriods {
  const today = localDateIn(now, schedule.timezone);
  const final = lastFinalDay(now, schedule.timezone, schedule.finalAfter);
  // The oldest date still inside the catch-up window.
  const earliest = addDays(today, 1 - schedule.catchUpDays);
  const due =
    schedule.cadence === 'daily'
      ? dueDays(earliest, today, final, schedule.daily.offsetDays)
      : dueMonths(earliest, today, final, schedule.monthly.dayOfMonth);
  return { today, ...due };
}

function dueDays(earliest: LocalDate, today: LocalDate, final: LocalDate, offsetDays: number): Omit<DuePeriods, 'today'> {
  const periods: DateRange[] = [];
  const waiting: DateRange[] = [];
  for (let day = earliest; day <= addDays(today, -offsetDays); day = nextDay(day)) (day <= final ? periods : waiting).push({ from: day, to: day });
  return { periods, waiting };
}

const firstOfMonth = (date: LocalDate) => `${date.slice(0, 7)}-01` as LocalDate;

function dueMonths(earliest: LocalDate, today: LocalDate, final: LocalDate, dayOfMonth: number): Omit<DuePeriods, 'today'> {
  const periods: DateRange[] = [];
  const waiting: DateRange[] = [];
  // From the older of the window start and the last final day, so a month that waits is never missed.
  const start = firstOfMonth(earliest < final ? earliest : final);
  for (let first = start; first <= today; first = nextDay(endOfMonth(first))) {
    const previousMonthEnd = previousDay(first);
    const month = { from: firstOfMonth(previousMonthEnd), to: previousMonthEnd };
    const configured = addDays(first, dayOfMonth - 1);
    if (configured > today) continue;
    if (month.to > final) waiting.push(month);
    else if (maxDate(configured, finalFrom(month.to)) >= earliest) periods.push(month);
  }
  return { periods, waiting };
}

const maxDate = (a: LocalDate, b: LocalDate) => (a > b ? a : b);
