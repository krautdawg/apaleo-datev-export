import { describe, expect, it } from 'vitest';
import { encodeCp1252 } from '../../src/datev/cp1252.js';
import { decodeCsv, detectSeparator, formatCsvLine, parseCsv } from '../../src/mapping/csv.js';
import { MappingError, appendRows, parseMapping, renderMappingFile, type MappingRow, type MappingRowValues } from '../../src/mapping/index.js';
import { EXCEL_ORIGINAL_ROWS, csvBytes, mappingRow, readMappingFixture } from '../helpers/mapping.js';

const HEADER = 'apaleo_account;apaleo_type;apaleo_name;apaleo_vat_percent;datev_account;bu_key;datev_vat_percent;kost1;kost2;comment';
const parse = (bytes: Uint8Array, sachkontenlaenge = 4) => parseMapping(bytes, { path: 'm.csv', sachkontenlaenge });
const values = (row: MappingRow): MappingRowValues => {
  const { line, ...rest } = row;
  expect(line).toBeGreaterThan(0);
  return rest;
};

function loadError(bytes: Uint8Array): MappingError {
  try {
    parse(bytes);
  } catch (error) {
    expect(error).toBeInstanceOf(MappingError);
    return error as MappingError;
  }
  throw new Error('expected a MappingError');
}

describe('encoding', () => {
  it('strips a UTF-8 BOM and decodes UTF-8', () => {
    const decoded = decodeCsv(Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Getränke')]));
    expect(decoded).toEqual({ text: 'Getränke', encoding: 'utf-8', bom: true });
  });

  it('decodes bytes that are not valid UTF-8 as CP1252', () => {
    const decoded = decodeCsv(encodeCp1252('Frühstück – 7 €').bytes);
    expect(decoded).toEqual({ text: 'Frühstück – 7 €', encoding: 'windows-1252', bom: false });
  });

  it('reads UTF-8 without BOM and CP1252 files to the same rows', () => {
    const text = `${HEADER}\r\n5121;Revenues;Getränke;19;8400;;19;;;Vorschlag – prüfen\r\n`;
    const utf8 = parse(new TextEncoder().encode(text));
    const cp1252 = parse(encodeCp1252(text).bytes);
    expect(cp1252.rows).toEqual(utf8.rows);
    expect(utf8.rows[0]).toMatchObject({ apaleoName: 'Getränke', comment: 'Vorschlag – prüfen' });
  });
});

describe('separator', () => {
  it('detects ; or , from the header line, skipping comment lines', () => {
    expect(detectSeparator(`# a, b, c, d\n${HEADER}\n`)).toBe(';');
    expect(detectSeparator('apaleo_account,apaleo_type,datev_account\n1;2;3\n')).toBe(',');
  });

  it('reads a comma-separated file', () => {
    const mapping = parse(csvBytes(['apaleo_account,apaleo_type,datev_account,comment', '1611,Payments,1360,"Karte, Visa"']));
    expect(mapping.rows[0]).toMatchObject({ apaleoAccount: '1611', datevAccount: '1360', comment: 'Karte, Visa' });
  });

  it('accepts the columns in any order and ignores unknown ones with a warning', () => {
    const mapping = parse(csvBytes(['datev_account;Notiz;apaleo_type;apaleo_account', '1360;x;Payments;1611']));
    expect(mapping.rows[0]).toMatchObject({ apaleoAccount: '1611', apaleoType: 'Payments', datevAccount: '1360' });
    expect(mapping.findings.map((f) => f.code)).toEqual(['W-UNKNOWN-COLUMN']);
  });

  it('skips comment lines and rows Excel left with empty cells only', () => {
    const mapping = parse(csvBytes(['# Vorlage skr04-hotel@1', HEADER, '1611;Payments;Visa;;1460;;;;;', ';;;;;;;;;']));
    expect(mapping.rows).toHaveLength(1);
    expect(mapping.skr).toBe('04');
  });
});

describe('Grman layout', () => {
  it('reads ApaleoAccountNumber;DatevAccountNumber;CostCenter;CostCenter2 as rows of any type', () => {
    const mapping = parse(csvBytes(['ApaleoAccountNumber;DatevAccountNumber;CostCenter;CostCenter2', '5011;8300;LOGIS;', '1611;1360;;K2']));
    expect(mapping.layout).toBe('grman');
    expect(mapping.rows.map(values)).toEqual([
      mappingRow({ apaleoAccount: '5011', apaleoType: '*any*', datevAccount: '8300', kost1: 'LOGIS' }),
      mappingRow({ apaleoAccount: '1611', apaleoType: '*any*', datevAccount: '1360', kost2: 'K2' }),
    ]);
  });
});

describe('account length on load', () => {
  it('restores the leading zeros of a 1-3 digit G/L number at Sachkontenlänge 4 with W-PADDED', () => {
    const mapping = parse(csvBytes([HEADER, '9000;House;House;;650;;;;;', '9001;House;House 2;;65;;;;;']));
    expect(mapping.rows.map((r) => r.datevAccount)).toEqual(['0650', '0065']);
    expect(mapping.findings.map((f) => [f.code, f.value])).toEqual([
      ['W-PADDED', '650'],
      ['W-PADDED', '65'],
    ]);
    expect(mapping.findings[0]?.message).toContain('line 2');
  });

  it('never pads at a longer Sachkontenlänge: 1360 stays 1360 at length 5', () => {
    const mapping = parse(csvBytes([HEADER, '1611;Payments;Visa;;1360;;;;;']), 5);
    expect(mapping.rows[0]?.datevAccount).toBe('1360');
    expect(mapping.findings).toEqual([]);
  });

  it('never pads personal accounts', () => {
    const mapping = parse(csvBytes([HEADER, '1400;AccountsReceivable;AR;;100;;;;;']));
    expect(mapping.rows[0]?.datevAccount).toBe('100');
    expect(mapping.findings).toEqual([]);
  });
});

describe('structural errors', () => {
  it('fails on two rows with the same account and type, naming both lines', () => {
    const error = loadError(csvBytes([HEADER, '5011;Revenues;A;7;8300;;;;;', '1611;Payments;Visa;;1360;;;;;', '5011;Revenues;A;7;8400;;;;;']));
    expect(error.message).toContain('lines 2 and 4 both map apaleo account 5011 of type Revenues');
  });

  it('allows the same number with different types, and rate wildcards with different rates', () => {
    const mapping = parse(
      csvBytes([HEADER, '1200;Receivables;;;1410;;;;;', '1200;Payments;;;1360;;;;;', '*;Liabilities;;7;1711;;;;;', '*;Liabilities;;19;1718;;;;;']),
    );
    expect(mapping.rows).toHaveLength(4);
  });

  it('fails on two wildcards for the same rate, written differently', () => {
    const error = loadError(csvBytes([HEADER, '*;Liabilities;;7;1711;;;;;', '*;Liabilities;;"7,0";1711;;;;;']));
    expect(error.message).toContain('lines 2 and 3 both map apaleo account * of type Liabilities at 7,0 %');
  });

  it('rejects a Liabilities wildcard without a rate: VAT-relevant wildcards must name a VAT rate', () => {
    const error = loadError(csvBytes([HEADER, '*;Liabilities;;;1711;;;;;']));
    expect(error.message).toContain('line 2: VAT-relevant wildcards must name a VAT rate');
  });

  it.each(['', '7'])('rejects a Revenues wildcard (rate "%s") because revenue accounts are mapped one by one', (rate) => {
    const error = loadError(csvBytes([HEADER, `*;Revenues;;${rate};8300;;;;;`]));
    expect(error.message).toContain('revenue accounts must be mapped one by one because of VAT');
  });

  it('rejects a header without the required columns and an empty file', () => {
    expect(loadError(csvBytes(['account;datev'])).message).toContain('lacks the column(s) apaleo_account, apaleo_type, datev_account');
    expect(loadError(new Uint8Array()).message).toContain('the file is empty');
  });

  it('reports a broken quote with the file name', () => {
    expect(() => parse(csvBytes([HEADER, '5011;Revenues;"Accommodation;7']))).toThrow(/Cannot read the mapping file m\.csv/);
  });
});

describe('writer', () => {
  it('writes UTF-8 with BOM, ; and CRLF, quoting only where needed', () => {
    const bytes = renderMappingFile(['Vorlage skr03-hotel@1'], [mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', comment: 'a; "b"' })]);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.subarray(3))).toBe(
      `# Vorlage skr03-hotel@1\r\n${HEADER}\r\n5011;Revenues;;;;;;;;"a; ""b"""\r\n`,
    );
    expect(formatCsvLine([' x', 'y\nz', 'plain'])).toBe('" x";"y\nz";plain');
  });

  it('reads back what it wrote', () => {
    const mapping = parse(renderMappingFile([], EXCEL_ORIGINAL_ROWS));
    expect(mapping.rows.map(values)).toEqual(EXCEL_ORIGINAL_ROWS);
    expect(mapping.findings).toEqual([]);
  });

  it('keeps line numbers of multi-line records usable', () => {
    const records = parseCsv('a;b\r\n1;"x\r\ny"\r\n2;3\r\n', ';', 'test');
    expect(records.map((r) => r.line)).toEqual([1, 3, 4]);
  });
});

describe('Excel round trip', () => {
  it('reads the Excel (DE) saved fixture to the same rows as the written original, restoring the class-0 account', () => {
    const original = parse(renderMappingFile([], EXCEL_ORIGINAL_ROWS));
    const saved = parse(readMappingFixture('excel-de-saved.csv'));
    expect(decodeCsv(readMappingFixture('excel-de-saved.csv')).encoding).toBe('windows-1252');
    expect(saved.rows.map(values)).toEqual(original.rows.map(values));
    expect(saved.findings.map((f) => [f.code, f.value])).toEqual([['W-PADDED', '650']]);
  });
});

describe('appendRows', () => {
  it('reads the column order of a header with every cell quoted (LibreOffice "quote all")', () => {
    const quoted =
      '"apaleo_account";"apaleo_type";"apaleo_name";"apaleo_vat_percent";"datev_account";"bu_key";"datev_vat_percent";"kost1";"kost2";"comment"\r\n' +
      '"5011";"Revenues";"Accommodation 7%";"7";"8300";"";"7";"";"";""\r\n';
    const added = mappingRow({ apaleoAccount: '5020', apaleoType: 'Revenues', apaleoName: 'Spa 19%', apaleoVatPercent: '19', datevAccount: '8400' });
    const bytes = appendRows(new TextEncoder().encode(quoted), [added]);
    expect(decodeCsv(bytes).text).toBe(`${quoted}5020;Revenues;Spa 19%;19;8400;;;;;\r\n`);
    const rows = parseMapping(bytes, { path: 'x', sachkontenlaenge: 4 }).rows;
    expect(rows.map((r) => [r.apaleoAccount, r.datevAccount])).toEqual([
      ['5011', '8300'],
      ['5020', '8400'],
    ]);
  });
});
