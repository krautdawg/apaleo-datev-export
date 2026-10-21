import { parseLocalDate, type LocalDate } from '../core/date.js';
import type { FieldType } from './columns.js';

export const SEPARATOR = ';';
export const LINE_END = '\r\n';

/** Cents to `#0,00`: decimal comma, two decimals, no thousands separator. 10700 → `107,00`. */
export function formatAmount(cents: number): string {
  const euros = Math.trunc(cents / 100);
  const rest = cents % 100;
  return `${euros},${String(rest).padStart(2, '0')}`;
}

/** Belegdatum as `TTMM`. 2026-10-05 → `0510`. */
export function formatTtmm(date: LocalDate): string {
  const { day, month } = parts(date);
  return `${pad2(day)}${pad2(month)}`;
}

/** Header dates as `YYYYMMDD`. 2026-10-05 → `20261005`. */
export function formatYyyymmdd(date: LocalDate): string {
  const { year, month, day } = parts(date);
  return `${year}${pad2(month)}${pad2(day)}`;
}

/**
 * Width the BU-Schlüssel is left-padded to; 0 writes it as given (`"3"`, `"40"`).
 * DATEV's own sample file writes keys unpadded; see docs/datev-format.md.
 */
export const BU_KEY_PAD = 0;

export function formatBuKey(key: string): string {
  return key.padStart(BU_KEY_PAD, '0');
}

/** Wraps text in double quotes and doubles the quotes inside. */
export function quoteText(text: string): string {
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * Writes one already formatted value of a Buchungsstapel column. Only `Text` is
 * quoted; an empty value is written as nothing, whatever the type.
 */
export function formatField(type: FieldType, value: string | undefined): string {
  if (value === undefined || value === '') return '';
  return type === 'Text' ? quoteText(value) : value;
}

function parts(date: LocalDate) {
  const result = parseLocalDate(date);
  if (!result) throw new TypeError(`Not a valid date: ${date}`);
  return result;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
