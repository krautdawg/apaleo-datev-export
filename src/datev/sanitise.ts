import type { Finding } from '../core/findings.js';
import { describe, toCp1252Text } from './cp1252.js';
import { labelOf } from './labels.js';

/**
 * Sanitisers never change a value silently: every change becomes a warning
 * that carries the original value, the booking index and the field.
 */
export interface Sanitised {
  value: string;
  warnings: Finding[];
}

interface Location {
  index?: number;
  field: string;
}

const UMLAUTS: Readonly<Record<string, string>> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', ẞ: 'SS' };
const BELEGFELD_DISALLOWED = /[^A-Za-z0-9$&%*+\-/]/g;
const WHITESPACE_CONTROLS = /[\t\n\r\v\f]/g;
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const OTHER_CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Belegfeld 1 and 2: the text is first composed (NFC), so a decomposed `ü` is
 * treated like `ü`; umlauts and ß transliterated (ä → ae), other accents
 * dropped (é → e), spaces become `-`, every character outside
 * `A-Z a-z 0-9 $ & % * + - /` is removed, then the value is cut to `maxLength`.
 */
export function sanitiseBelegfeld(original: string, maxLength: number, at: Location): Sanitised {
  const warnings: Finding[] = [];
  const cleaned = original
    .normalize('NFC')
    .replace(/[äöüÄÖÜßẞ]/g, (char) => UMLAUTS[char] ?? char)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s/g, '-')
    .replace(BELEGFELD_DISALLOWED, '');
  if (cleaned !== original) {
    warnings.push(
      finding('W-EXTF-BELEGFELD', at, original, `may only contain A-Z a-z 0-9 $ & % * + - /, written as "${cleaned}"`),
    );
  }
  return truncate({ value: cleaned, warnings }, maxLength, at, original);
}

/**
 * Free text (Buchungstext, KOST1, KOST2): tabs and line breaks become spaces,
 * other control characters are removed, characters outside CP1252 are
 * transliterated or replaced, then the value is cut to `maxLength`.
 */
export function sanitiseText(original: string, maxLength: number, at: Location): Sanitised {
  const warnings: Finding[] = [];
  const withoutControls = original.replace(WHITESPACE_CONTROLS, ' ').replace(OTHER_CONTROLS, '');
  if (withoutControls !== original) {
    warnings.push(finding('W-EXTF-CONTROL-CHARS', at, original, 'control characters removed'));
  }
  const { text, replaced } = toCp1252Text(withoutControls);
  if (replaced.length > 0) {
    warnings.push(
      finding('W-EXTF-CHARSET', at, original, `${replaced.map(describe).join(', ')} not in Windows-1252, written as "${text}"`),
    );
  }
  return truncate({ value: text, warnings }, maxLength, at, original);
}

function truncate(input: Sanitised, maxLength: number, at: Location, original: string): Sanitised {
  const chars = [...input.value];
  if (chars.length <= maxLength) return input;
  const value = chars.slice(0, maxLength).join('');
  const message = `longer than ${maxLength} characters, cut to "${value}"`;
  return { value, warnings: [...input.warnings, finding('W-EXTF-TRUNCATED', at, original, message)] };
}

function finding(code: string, at: Location, value: string, message: string): Finding {
  const label = labelOf(at.field);
  return { code, ...(at.index === undefined ? {} : { index: at.index }), field: at.field, label, value, message: `${label} ${message}` };
}
