import { describe, expect, it } from 'vitest';
import { renderHeaderLine, validateHeader } from '../../src/datev/header.js';
import type { ExtfHeader } from '../../src/datev/types.js';
import { headerWithoutFestschreibung, octoberHeader, splitFields } from '../helpers/extf.js';

function errors(overrides: Partial<ExtfHeader>) {
  return validateHeader(octoberHeader(overrides));
}

describe('header line', () => {
  it('renders the monthly batch of the spec scenario', () => {
    const { line, warnings } = renderHeaderLine(octoberHeader());
    expect(line.startsWith(
      '"EXTF";700;21;"Buchungsstapel";13;20261103101500000;;"RE";"apaleo-datev-export";"";1234567;42;20260101;4;20261001;20261031;',
    )).toBe(true);
    const fields = splitFields(line);
    expect(fields).toHaveLength(31);
    expect(fields[21]).toBe('"EUR"');
    expect(fields[26]).toBe('"03"');
    expect(warnings).toEqual([]);
  });

  it('writes the whole line, quoting text, "" at 10, 24 and 30, and leaving other reserved fields empty', () => {
    const { line } = renderHeaderLine(octoberHeader({ bezeichnung: 'apaleo 10/2026', diktatkuerzel: 'AD' }));
    expect(line).toBe(
      '"EXTF";700;21;"Buchungsstapel";13;20261103101500000;;"RE";"apaleo-datev-export";"";1234567;42;20260101;4;20261001;20261031;"apaleo 10/2026";"AD";1;0;0;"EUR";;"";;;"03";;;"";""',
    );
  });

  it('defaults Festschreibung to 0 and writes 1 when asked', () => {
    expect(splitFields(renderHeaderLine(headerWithoutFestschreibung()).line)[20]).toBe('0');
    expect(splitFields(renderHeaderLine(octoberHeader({ festschreibung: 1 })).line)[20]).toBe('1');
  });

  it('replaces characters outside CP1252 in text fields with a warning', () => {
    const { line, warnings } = renderHeaderLine(octoberHeader({ bezeichnung: 'Hotel 🛏' }));
    expect(splitFields(line)[16]).toBe('"Hotel ?"');
    expect(warnings).toEqual([expect.objectContaining({ code: 'W-EXTF-CHARSET', field: 'bezeichnung', value: 'Hotel 🛏' })]);
  });

  it('writes a decomposed umlaut in a text field as the CP1252 umlaut without a warning', () => {
    const { line, warnings } = renderHeaderLine(octoberHeader({ bezeichnung: 'Ru\u0308ckbuchung' }));
    expect(splitFields(line)[16]).toBe('"Rückbuchung"');
    expect(warnings).toEqual([]);
  });
});

describe('header validation', () => {
  it('accepts the scenario header', () => {
    expect(errors({})).toEqual([]);
  });

  it('rejects Sachkontenlänge 9, naming the field and the range 4–8', () => {
    expect(errors({ sachkontenlaenge: 9 })).toEqual([
      expect.objectContaining({ code: 'E-EXTF-HEADER', field: 'sachkontenlaenge', message: expect.stringContaining('4–8') }),
    ]);
    expect(errors({ sachkontenlaenge: 3 })).toHaveLength(1);
    expect(errors({ sachkontenlaenge: 8 })).toEqual([]);
  });

  it.each([
    ['beraternummer', 1000],
    ['beraternummer', 10_000_000],
    ['beraternummer', 1234.5],
    ['mandantennummer', 0],
    ['mandantennummer', 100_000],
  ] as const)('rejects %s %d', (field, value) => {
    expect(errors({ [field]: value })).toEqual([expect.objectContaining({ field })]);
  });

  it('accepts the range ends', () => {
    expect(errors({ beraternummer: 1001, mandantennummer: 1 })).toEqual([]);
    expect(errors({ beraternummer: 9_999_999, mandantennummer: 99_999 })).toEqual([]);
  });

  it('rejects a period that crosses the fiscal year', () => {
    const findings = errors({ wjBeginn: '2026-01-01', datumVom: '2026-12-15', datumBis: '2027-01-15' });
    expect(findings).toEqual([
      expect.objectContaining({ code: 'E-EXTF-PERIOD', message: expect.stringContaining('must stay inside one fiscal year') }),
    ]);
  });

  it('rejects a period that starts before WJ-Beginn', () => {
    expect(errors({ wjBeginn: '2026-11-01' })).toEqual([expect.objectContaining({ code: 'E-EXTF-PERIOD' })]);
  });

  it('accepts a period inside a fiscal year that does not start in January', () => {
    expect(errors({ wjBeginn: '2026-07-01', datumVom: '2027-06-01', datumBis: '2027-06-30' })).toEqual([]);
    expect(errors({ wjBeginn: '2026-07-01', datumVom: '2027-06-01', datumBis: '2027-07-01' })).toHaveLength(1);
  });

  it('rejects Datum vom after Datum bis', () => {
    expect(errors({ datumVom: '2026-10-31', datumBis: '2026-10-01' })).toEqual([
      expect.objectContaining({ code: 'E-EXTF-PERIOD', message: expect.stringContaining('after') }),
    ]);
  });

  it('rejects invalid dates', () => {
    expect(errors({ datumBis: '2026-10-32' as ExtfHeader['datumBis'] })).toEqual([
      expect.objectContaining({ field: 'datumBis', message: expect.stringContaining('valid date') }),
    ]);
  });

  it.each([
    ['bezeichnung', 'x'.repeat(31)],
    ['herkunft', 'ABC'],
    ['exportiertVon', 'x'.repeat(26)],
    ['diktatkuerzel', 'ABC'],
    ['diktatkuerzel', 'ab'],
    ['sachkontenrahmen', '3'],
  ] as const)('rejects %s "%s"', (field, value) => {
    expect(errors({ [field]: value })).toEqual([expect.objectContaining({ code: 'E-EXTF-HEADER', field })]);
  });

  it.each([
    ['bezeichnung', 'Okt\r\n2026'],
    ['bezeichnung', 'Okt\t2026'],
    ['herkunft', 'R\n'],
    ['exportiertVon', 'apaleo\u0000'],
    ['diktatkuerzel', 'AD\n'],
    ['sachkontenrahmen', '03\r\n'],
  ] as const)('rejects control characters in %s %j', (field, value) => {
    const findings = errors({ [field]: value });
    expect(findings).toEqual([expect.objectContaining({ code: 'E-EXTF-HEADER', field, value })]);
  });

  it('names the problem in plain words, without internal field names', () => {
    expect(errors({ bezeichnung: 'Okt\r\n2026' })).toEqual([
      expect.objectContaining({
        label: 'Bezeichnung',
        message: 'Bezeichnung must not contain line breaks, tabs or other control characters, got "Okt\\r\\n2026"',
      }),
    ]);
    expect(errors({ sachkontenlaenge: 9 })[0]?.message).toMatch(/^Sachkontenlänge /);
  });

  it('counts a decomposed umlaut as one character', () => {
    expect(errors({ bezeichnung: 'u\u0308'.repeat(30) })).toEqual([]);
  });

  it('accepts the maximum text lengths', () => {
    expect(errors({ bezeichnung: 'x'.repeat(30), herkunft: 'XY', exportiertVon: 'x'.repeat(25), diktatkuerzel: 'AB' })).toEqual([]);
  });

  it('rejects Festschreibung other than 0 or 1', () => {
    expect(errors({ festschreibung: 2 as 0 })).toEqual([expect.objectContaining({ field: 'festschreibung' })]);
  });

  it('rejects an invalid clock value', () => {
    expect(errors({ erzeugtAm: new Date(Number.NaN) })).toEqual([expect.objectContaining({ field: 'erzeugtAm' })]);
  });

  it('collects every header problem at once', () => {
    expect(errors({ beraternummer: 1, mandantennummer: 0, sachkontenlaenge: 9, festschreibung: 2 as 0 })).toHaveLength(4);
  });
});
