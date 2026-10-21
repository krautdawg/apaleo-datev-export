/**
 * A calendar date without time or time zone, written `YYYY-MM-DD`.
 * ISO strings compare correctly with `<` and `>`.
 */
export type LocalDate = `${number}-${number}-${number}`;

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

/** Splits a valid `YYYY-MM-DD` date, or returns undefined for anything else (including 2026-02-30). */
export function parseLocalDate(value: string): DateParts | undefined {
  const match = LOCAL_DATE.exec(value);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  return { year, month, day };
}

export function isLocalDate(value: string): value is LocalDate {
  return parseLocalDate(value) !== undefined;
}

export function toLocalDate({ year, month, day }: DateParts): LocalDate {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` as LocalDate;
}

/** The same day one year later, clamped to the end of the month (2028-02-29 → 2029-02-28). */
export function addOneYear(date: LocalDate): LocalDate {
  const parts = mustParse(date);
  const year = parts.year + 1;
  return toLocalDate({ year, month: parts.month, day: Math.min(parts.day, daysInMonth(year, parts.month)) });
}

/** The day before a date. */
export function previousDay(date: LocalDate): LocalDate {
  const { year, month, day } = mustParse(date);
  if (day > 1) return toLocalDate({ year, month, day: day - 1 });
  if (month > 1) return toLocalDate({ year, month: month - 1, day: daysInMonth(year, month - 1) });
  return toLocalDate({ year: year - 1, month: 12, day: 31 });
}

/** The day after a date. */
export function nextDay(date: LocalDate): LocalDate {
  const { year, month, day } = mustParse(date);
  if (day < daysInMonth(year, month)) return toLocalDate({ year, month, day: day + 1 });
  if (month < 12) return toLocalDate({ year, month: month + 1, day: 1 });
  return toLocalDate({ year: year + 1, month: 1, day: 1 });
}

/** The date `days` days later (or earlier, for a negative number). */
export function addDays(date: LocalDate, days: number): LocalDate {
  const { year, month, day } = mustParse(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return toLocalDate({ year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() });
}

/** The last day of the date's month. */
export function endOfMonth(date: LocalDate): LocalDate {
  const { year, month } = mustParse(date);
  return toLocalDate({ year, month, day: daysInMonth(year, month) });
}

/** Every day from `from` (inclusive) to `toExclusive`. Empty when both are equal. */
export function eachDay(from: LocalDate, toExclusive: LocalDate): LocalDate[] {
  if (toExclusive < from) throw new RangeError(`The period end ${toExclusive} lies before its start ${from}`);
  const days: LocalDate[] = [];
  for (let day = from; day < toExclusive; day = nextDay(day)) days.push(day);
  return days;
}

/** The calendar date of an instant in an IANA time zone, for example `Europe/Berlin`. */
export function localDateIn(instant: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return toLocalDate({ year: part('year'), month: part('month'), day: part('day') });
}

/**
 * An instant as local time in an IANA time zone with its UTC offset, to the
 * second: `2026-11-03T06:00:12+01:00`.
 */
export function localDateTimeIn(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  const [year, month, day, hour, minute, second] = [part('year'), part('month'), part('day'), part('hour'), part('minute'), part('second')];
  const wholeSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  const offsetMinutes = Math.round((Date.UTC(year, month - 1, day, hour, minute, second) - wholeSeconds) / 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${pad(Math.floor(absolute / 60), 2)}:${pad(absolute % 60, 2)}`;
  return `${toLocalDate({ year, month, day })}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}${offset}`;
}

/** The calendar date and the minutes since local midnight of an instant in an IANA time zone. */
export function localClockIn(instant: Date, timeZone: string): { date: LocalDate; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return { date: localDateIn(instant, timeZone), minutes: part('hour') * 60 + part('minute') };
}

/** `HH:MM` (00:00 to 23:59) as minutes since midnight, or undefined for anything else. */
export function parseClockTime(value: string): number | undefined {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

function mustParse(date: LocalDate): DateParts {
  const parts = parseLocalDate(date);
  if (!parts) throw new TypeError(`Not a valid date: ${date}`);
  return parts;
}

function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}
