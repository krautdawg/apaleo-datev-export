import { describe, expect, it } from 'vitest';
import { BUCHUNGSSTAPEL_COLUMNS, COLUMN, columnAt, FORMAT_VERSION } from '../../src/datev/columns.js';
import { EXTF_HEADER_FIELDS, renderHeaderLine } from '../../src/datev/header.js';
import { octoberHeader, splitFields } from '../helpers/extf.js';

describe('Buchungsstapel columns (format version 13)', () => {
  it('has 125 columns for format version 13', () => {
    expect(FORMAT_VERSION).toBe(13);
    expect(BUCHUNGSSTAPEL_COLUMNS).toHaveLength(125);
  });

  it('starts with the 14 columns from the DATEV format description', () => {
    expect(BUCHUNGSSTAPEL_COLUMNS.slice(0, 14).map((c) => c.name)).toEqual([
      'Umsatz (ohne Soll/Haben-Kz)',
      'Soll/Haben-Kennzeichen',
      'WKZ Umsatz',
      'Kurs',
      'Basis-Umsatz',
      'WKZ Basis-Umsatz',
      'Konto',
      'Gegenkonto (ohne BU-Schlüssel)',
      'BU-Schlüssel',
      'Belegdatum',
      'Belegfeld 1',
      'Belegfeld 2',
      'Skonto',
      'Buchungstext',
    ]);
  });

  it('ends with column 125 "Abw. Skontokonto", added in February 2024', () => {
    expect(columnAt(125).name).toBe('Abw. Skontokonto');
  });

  it('puts cost centres, Herkunft-Kz and Festschreibung at their DATEV positions', () => {
    expect(columnAt(37).name).toBe('KOST1 - Kostenstelle');
    expect(columnAt(38).name).toBe('KOST2 - Kostenstelle');
    expect(columnAt(102).name).toBe('Herkunft-Kz');
    expect(columnAt(114).name).toBe('Festschreibung');
  });

  it('types the filled fields as the design says (BU-Schlüssel is Text)', () => {
    const typed = Object.fromEntries(
      Object.entries(COLUMN).map(([field, position]) => {
        const { type, maxLength } = columnAt(position);
        return [field, maxLength === undefined ? type : `${type}(${maxLength})`];
      }),
    );
    expect(typed).toEqual({
      umsatz: 'Amount',
      sollHaben: 'Text(1)',
      konto: 'Account',
      gegenkonto: 'Account',
      buKey: 'Text(4)',
      belegdatum: 'Date',
      belegfeld1: 'Text(36)',
      belegfeld2: 'Text(12)',
      buchungstext: 'Text(60)',
      kost1: 'Text(36)',
      kost2: 'Text(36)',
      festschreibung: 'Number',
    });
    expect(columnAt(3)).toEqual({ name: 'WKZ Umsatz', type: 'Text', maxLength: 3 });
  });

  it('rejects positions outside 1–125', () => {
    expect(() => columnAt(0)).toThrow(RangeError);
    expect(() => columnAt(126)).toThrow(RangeError);
  });
});

describe('EXTF header fields', () => {
  it('lists all 31 positions, with 7, 23, 25, 26, 28 and 29 empty and 10, 24, 30 as ""', () => {
    expect(EXTF_HEADER_FIELDS).toHaveLength(31);
    const empty = EXTF_HEADER_FIELDS.flatMap((field, i) => (field.type === 'Empty' ? [i + 1] : []));
    expect(empty).toEqual([7, 23, 25, 26, 28, 29]);
    const fields = splitFields(renderHeaderLine(octoberHeader()).line);
    expect([fields[9], fields[23], fields[29]]).toEqual(['""', '""', '""']);
  });

  it('writes "EUR" at 22 and "03" at 27', () => {
    const fields = splitFields(renderHeaderLine(octoberHeader()).line);
    expect(fields[21]).toBe('"EUR"');
    expect(fields[26]).toBe('"03"');
    expect(EXTF_HEADER_FIELDS[21]?.name).toBe('WKZ');
    expect(EXTF_HEADER_FIELDS[26]?.name).toBe('Sachkontenrahmen');
  });
});
