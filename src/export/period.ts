import { endOfMonth, isLocalDate, localClockIn, nextDay, parseClockTime, parseLocalDate, previousDay, toLocalDate, type LocalDate } from '../core/date.js';
import { UsageError } from '../core/errors.js';
import type { Finding } from '../core/findings.js';

/** A period of business days, both ends inclusive. */
export interface DateRange {
  from: LocalDate;
  to: LocalDate;
}

/** One file's worth of a period: inside one calendar month and one fiscal year. */
export interface PeriodPart extends DateRange {
  /** `YYYY-MM`, the output folder of the part. */
  month: string;
  /** Start of the fiscal year the part lies in (DATEV header WJ-Beginn). */
  wjBeginn: LocalDate;
}

export const PERIOD_HINT = 'Give the period as --month YYYY-MM or as --from YYYY-MM-DD --to YYYY-MM-DD (both days included).';

/** `--from` and `--to` as an inclusive range, or undefined when neither is given. */
export function parseRangeFlags(from: string | undefined, to: string | undefined): DateRange | undefined {
  if (from === undefined && to === undefined) return undefined;
  if (from === undefined || to === undefined) throw new UsageError('--from and --to go together.');
  for (const [flag, value] of [['--from', from], ['--to', to]] as const) {
    if (!isLocalDate(value)) throw new UsageError(`${flag} must be a date written YYYY-MM-DD, got "${value}".`);
  }
  if (to < from) throw new UsageError(`--to ${to} lies before --from ${from}.`);
  return { from: from as LocalDate, to: to as LocalDate };
}

/** `--month YYYY-MM` as the range of the whole month. */
export function parseMonthFlag(value: string): DateRange {
  const first = `${value}-01`;
  if (!/^\d{4}-\d{2}$/.test(value) || !isLocalDate(first)) {
    throw new UsageError(`--month must be a month written YYYY-MM, for example 2026-10, got "${value}".`);
  }
  return { from: first, to: endOfMonth(first) };
}

/** Exactly one of `--month` and `--from/--to`. */
export function parseExportPeriod(flags: { month?: string | undefined; from?: string | undefined; to?: string | undefined }): DateRange {
  const range = parseRangeFlags(flags.from, flags.to);
  if (flags.month !== undefined && range) throw new UsageError(`Use either --month or --from/--to, not both. ${PERIOD_HINT}`);
  if (flags.month !== undefined) return parseMonthFlag(flags.month);
  if (!range) throw new UsageError(`The export needs a period. ${PERIOD_HINT}`);
  return range;
}

/** The latest fiscal-year start (`monthDay` as `MM-DD`) on or before `date`. */
export function fiscalYearStart(date: LocalDate, monthDay: string): LocalDate {
  const year = Number(date.slice(0, 4));
  const candidate = `${year}-${monthDay}` as LocalDate;
  return candidate <= date ? candidate : (`${year - 1}-${monthDay}` as LocalDate);
}

/**
 * Splits a period at calendar-month boundaries and at the fiscal-year start, so
 * each part becomes one DATEV file that stays inside one month and one fiscal year.
 */
export function splitPeriod(range: DateRange, monthDay: string): PeriodPart[] {
  const parts: PeriodPart[] = [];
  for (let from = range.from; from <= range.to; ) {
    const wjBeginn = fiscalYearStart(from, monthDay);
    const start = parseLocalDate(wjBeginn);
    if (!start) throw new RangeError(`Not a valid fiscal-year start: ${monthDay}`);
    const nextYearStart = toLocalDate({ ...start, year: start.year + 1 });
    const to = [range.to, endOfMonth(from), previousDay(nextYearStart)].reduce((a, b) => (a < b ? a : b));
    parts.push({ from, to, month: from.slice(0, 7), wjBeginn });
    from = nextDay(to);
  }
  return parts;
}

/**
 * The date rules that stand in for the night-audit status apaleo does not
 * publish: a part that reaches today (in the property's time zone) or later is
 * refused, a part that ends yesterday gets a warning.
 */
export function dayRuleFindings(part: DateRange, today: LocalDate, timeZone: string): Finding[] {
  const yesterday = previousDay(today);
  if (part.to >= today) {
    return [
      {
        code: 'E-DAY-NOT-CLOSED',
        message:
          `the period ${part.from} to ${part.to} reaches ${today}, which is today (or later) in ${timeZone}. ` +
          'apaleo has not closed that day with the night audit yet, so postings can still change. ' +
          `Export up to ${previousDay(yesterday)} (the day before yesterday) and run the rest later`,
      },
    ];
  }
  if (part.to === yesterday) {
    return [
      {
        code: 'W-RECENT-DAY',
        message:
          `the period ends yesterday (${yesterday}). The night audit may not have run yet, and later postings for that day ` +
          'are possible; prefer exporting up to the day before yesterday',
      },
    ];
  }
  return [];
}

/**
 * The last day whose postings are final at `instant` in `timeZone`, for the
 * scheduled run. apaleo can still post to day D until the night audit that
 * closes D+1, and that audit runs after midnight, on D+2. So D counts as final
 * from `finalAfter` (local time, `HH:MM`) on D+2: the day before yesterday once
 * the clock has passed `finalAfter`, else the day before that.
 */
export function lastFinalDay(instant: Date, timeZone: string, finalAfter: string): LocalDate {
  const cutoff = parseClockTime(finalAfter);
  if (cutoff === undefined) throw new TypeError(`Not a time HH:MM: ${finalAfter}`);
  const { date, minutes } = localClockIn(instant, timeZone);
  const base = minutes >= cutoff ? date : previousDay(date);
  return previousDay(previousDay(base));
}

/** The first day on which a period that ends on `lastDay` is final (at `finalAfter`): two days later. */
export function finalFrom(lastDay: LocalDate): LocalDate {
  return nextDay(nextDay(lastDay));
}
