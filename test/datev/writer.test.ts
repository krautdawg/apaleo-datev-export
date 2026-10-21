import { describe, expect, it } from 'vitest';
import { UserError } from '../../src/core/errors.js';
import {
  buchungsstapelFileName,
  encodeCp1252,
  ExtfValidationError,
  renderBuchungsstapel,
  type ExtfBooking,
  type ExtfHeader,
} from '../../src/datev/index.js';
import { booking, headerWithoutFestschreibung, lines, octoberHeader, splitFields } from '../helpers/extf.js';

function render(bookings: ExtfBooking[], header: ExtfHeader = octoberHeader()) {
  return renderBuchungsstapel({ header, bookings });
}

function renderError(bookings: ExtfBooking[], header?: ExtfHeader): ExtfValidationError {
  try {
    render(bookings, header);
  } catch (error) {
    expect(error).toBeInstanceOf(ExtfValidationError);
    return error as ExtfValidationError;
  }
  throw new Error('expected rendering to fail');
}

function bookingLine(overrides: Partial<ExtfBooking>): string {
  return lines(render([booking(overrides)]).text)[2] ?? '';
}

describe('file layout', () => {
  it('writes header, column headings and one line per booking, each ending in CRLF', () => {
    const { text } = render([booking(), booking({ belegdatum: '2026-10-06' })]);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    const all = lines(text);
    expect(all).toHaveLength(4);
    expect(all[0]?.startsWith('"EXTF";700;21;"Buchungsstapel";13;')).toBe(true);
  });

  it('writes 125 column headings and 125 fields on every booking line', () => {
    const { text } = render([booking(), booking({ buchungstext: 'Text; mit Semikolon', kost1: 'K1', kost2: 'K2' })]);
    const [, headings, ...rows] = lines(text);
    const names = (headings ?? '').split(';');
    expect(names).toHaveLength(125);
    expect(names[0]).toBe('Umsatz (ohne Soll/Haben-Kz)');
    expect(names[124]).toBe('Abw. Skontokonto');
    for (const row of rows) expect(splitFields(row)).toHaveLength(125);
  });

  it('writes an empty batch as header and column headings only', () => {
    expect(lines(render([]).text)).toHaveLength(2);
  });
});

describe('booking line format', () => {
  it('renders the revenue booking of the spec scenario', () => {
    const line = bookingLine({ belegfeld1: 'INV-2026-001', buchungstext: 'Logis 7%' });
    expect(line.startsWith('107,00;"S";;;;;1360;8300;;0510;"INV-2026-001";;;"Logis 7%"')).toBe(true);
    const fields = splitFields(line);
    expect(fields[113]).toBe('0');
    expect([...fields.slice(14, 113), ...fields.slice(114)].every((field) => field === '')).toBe(true);
  });

  it('repeats the header Festschreibung in field 114 of every line', () => {
    const { text } = render([booking(), booking()], octoberHeader({ festschreibung: 1 }));
    expect(lines(text).slice(2).map((line) => splitFields(line)[113])).toEqual(['1', '1']);
    expect(splitFields(lines(render([booking()], headerWithoutFestschreibung()).text)[2] ?? '')[113]).toBe('0');
  });

  it('writes a BU key as quoted text', () => {
    const line = bookingLine({ amountCents: 11_900, konto: '1200', gegenkonto: '8200', buKey: '3', belegdatum: '2026-10-07' });
    const fields = splitFields(line);
    expect(fields[8]).toBe('"3"');
    expect(line.startsWith('119,00;"S";;;;;1200;8200;"3";0710;')).toBe(true);
  });

  it('doubles quotes inside text', () => {
    expect(splitFields(bookingLine({ buchungstext: 'Zimmer "Seeblick"' }))[13]).toBe('"Zimmer ""Seeblick"""');
  });

  it('writes Haben, Belegfeld 2 and cost centres in their columns', () => {
    const fields = splitFields(bookingLine({ side: 'H', belegfeld2: 'RES-17', kost1: 'LOGIS', kost2: 'MUC 01' }));
    expect(fields[1]).toBe('"H"');
    expect(fields[11]).toBe('"RES-17"');
    expect(fields[36]).toBe('"LOGIS"');
    expect(fields[37]).toBe('"MUC 01"');
  });
});

describe('encoding', () => {
  it('encodes ü as 0xFC and € as 0x80 without a warning', () => {
    const { text, warnings } = render([booking({ buchungstext: 'Frühstück 5 €' })]);
    const { bytes, replaced } = encodeCp1252(text);
    expect(bytes).toContain(0xfc);
    expect(bytes).toContain(0x80);
    expect(warnings).toEqual([]);
    expect(replaced).toEqual([]);
    expect([bytes[0], bytes[1]]).toEqual([0x22, 0x45]); // `"E`, no byte-order mark
  });

  it('replaces an emoji, names the booking and the original text, and still produces the file', () => {
    const { text, warnings } = render([booking(), booking({ buchungstext: 'Bett 🛏' })]);
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'W-EXTF-CHARSET', index: 1, field: 'buchungstext', value: 'Bett 🛏' }),
    ]);
    expect(splitFields(lines(text)[3] ?? '')[13]).toBe('"Bett ?"');
    expect(encodeCp1252(text).replaced).toEqual([]);
  });
});

describe('validation errors', () => {
  it('fails once and lists every booking finding with its index', () => {
    const bookings = Array.from({ length: 9 }, () => booking());
    bookings[3] = booking({ amountCents: 0 });
    bookings[7] = booking({ belegdatum: '2026-12-01' });
    const error = renderError(bookings);
    expect(error).toBeInstanceOf(UserError);
    expect(error.findings.map((f) => [f.index, f.field])).toEqual([
      [3, 'amountCents'],
      [7, 'belegdatum'],
    ]);
    expect(error.message).toContain('2 problems');
    // Bookings are numbered from 1 for the user; `index` stays 0-based.
    expect(error.message).toContain('E-EXTF-AMOUNT (booking 4, Umsatz): Umsatz must be between 0,01 and 9.999.999.999,99 EUR, got 0,00 EUR');
    expect(error.message).toContain('E-EXTF-BELEGDATUM (booking 8, Belegdatum)');
    expect(error.message).not.toMatch(/amountCents|belegdatum|flip side/);
  });

  it('rejects a header text field with a line break instead of splitting the header line', () => {
    const error = renderError([booking()], octoberHeader({ bezeichnung: 'Okt\r\n2026' }));
    expect(error.findings).toEqual([expect.objectContaining({ code: 'E-EXTF-HEADER', field: 'bezeichnung' })]);
    expect(error.message).toContain('E-EXTF-HEADER (Bezeichnung)');
  });

  it('rejects Sachkontenlänge 9 before looking at the bookings', () => {
    const error = renderError([booking()], octoberHeader({ sachkontenlaenge: 9 }));
    expect(error.findings).toEqual([expect.objectContaining({ field: 'sachkontenlaenge' })]);
    expect(error.message).toContain('4–8');
  });

  it('rejects a period that crosses the fiscal year', () => {
    const header = octoberHeader({ datumVom: '2026-12-15', datumBis: '2027-01-15' });
    expect(renderError([], header).message).toContain('must stay inside one fiscal year');
  });

  it('never writes a padded account', () => {
    const error = renderError([booking({ konto: '1360', gegenkonto: '83000' })], octoberHeader({ sachkontenlaenge: 5 }));
    expect(error.findings).toEqual([expect.objectContaining({ index: 0, field: 'konto', message: expect.stringContaining('5 digits') })]);
    expect(error.message).not.toContain('01360');
  });
});

describe('file name', () => {
  it('names a monthly file with a suffix', () => {
    expect(buchungsstapelFileName(octoberHeader(), 'MUC')).toBe('EXTF_Buchungsstapel_1234567_42_20261001-20261031_MUC.csv');
  });

  it('names a file without a suffix, the same way every time', () => {
    const name = buchungsstapelFileName(octoberHeader());
    expect(name).toBe('EXTF_Buchungsstapel_1234567_42_20261001-20261031.csv');
    expect(buchungsstapelFileName(octoberHeader({ erzeugtAm: new Date('2030-01-01T00:00:00Z') }))).toBe(name);
  });

  it('rejects a suffix that is not safe in a file name', () => {
    expect(() => buchungsstapelFileName(octoberHeader(), '../x')).toThrow(ExtfValidationError);
    expect(() => buchungsstapelFileName(octoberHeader(), '')).toThrow(ExtfValidationError);
  });
});
