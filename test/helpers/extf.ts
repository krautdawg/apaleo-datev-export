import type { ExtfBooking, ExtfHeader } from '../../src/datev/types.js';

/** 2026-11-03 10:15:00.000 in Germany (CET, UTC+1). */
export const FIXED_CLOCK = new Date('2026-11-03T09:15:00.000Z');

/** The header of the spec scenario "Header for a monthly batch". */
export function octoberHeader(overrides: Partial<ExtfHeader> = {}): ExtfHeader {
  return {
    beraternummer: 1234567,
    mandantennummer: 42,
    wjBeginn: '2026-01-01',
    sachkontenlaenge: 4,
    datumVom: '2026-10-01',
    datumBis: '2026-10-31',
    sachkontenrahmen: '03',
    festschreibung: 0,
    erzeugtAm: FIXED_CLOCK,
    ...overrides,
  };
}

/** The scenario header without Festschreibung, to test the default. */
export function headerWithoutFestschreibung(): ExtfHeader {
  const header = octoberHeader();
  delete header.festschreibung;
  return header;
}

/** A valid revenue booking; override what the test is about. */
export function booking(overrides: Partial<ExtfBooking> = {}): ExtfBooking {
  return {
    amountCents: 10_700,
    side: 'S',
    konto: '1360',
    gegenkonto: '8300',
    belegdatum: '2026-10-05',
    ...overrides,
  };
}

/**
 * Splits one DATEV line into raw fields, keeping the quotes, so tests can
 * assert both the value and the quoting. `;` inside quotes does not split.
 */
export function splitFields(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    if (char === ';' && !quoted) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/** The lines of a rendered file, without the final empty string after the last CRLF. */
export function lines(text: string): string[] {
  const all = text.split('\r\n');
  return all.slice(0, -1);
}
