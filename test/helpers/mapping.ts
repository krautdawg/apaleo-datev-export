import { readFileSync } from 'node:fs';
import { parseMapping, renderMappingFile, type Mapping, type MappingRowValues } from '../../src/mapping/index.js';

/** A mapping row with every column empty except the given ones. */
export function mappingRow(values: Partial<MappingRowValues> & Pick<MappingRowValues, 'apaleoAccount' | 'apaleoType'>): MappingRowValues {
  return {
    apaleoName: '',
    apaleoVatPercent: '',
    datevAccount: '',
    buKey: '',
    datevVatPercent: '',
    kost1: '',
    kost2: '',
    comment: '',
    ...values,
  };
}

/** A mapping as `loadMapping` returns it for a file written from these rows. */
export function mappingOf(rows: readonly MappingRowValues[], sachkontenlaenge = 4, comments: string[] = []): Mapping {
  return parseMapping(renderMappingFile(comments, rows), { path: 'mapping.csv', sachkontenlaenge });
}

/** Mapping CSV text with `;` and CRLF, as UTF-8 bytes. */
export function csvBytes(lines: readonly string[]): Uint8Array {
  return new TextEncoder().encode(lines.map((line) => `${line}\r\n`).join(''));
}

export function readMappingFixture(name: string): Uint8Array {
  return readFileSync(new URL(`../fixtures/mapping/${name}`, import.meta.url));
}

/**
 * The rows written by `renderMappingFile` that `test/fixtures/mapping/excel-de-saved.csv`
 * holds after an Excel (DE) save: umlauts, an en dash, a separator and quotes inside
 * comments, a cost centre, a rate wildcard and a class-0 account with a leading zero.
 */
export const EXCEL_ORIGINAL_ROWS: readonly MappingRowValues[] = [
  mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', apaleoName: 'Accommodation 7%', apaleoVatPercent: '7', datevAccount: '8300', datevVatPercent: '7', comment: 'Vorschlag: Erlöse 7 % USt (Logis)' }),
  mappingRow({ apaleoAccount: '5111', apaleoType: 'Revenues', apaleoName: 'Frühstück Speisen 7%', apaleoVatPercent: '7', datevAccount: '8300', datevVatPercent: '7', comment: 'Speisen; eigenes Konto mit Kanzlei klären' }),
  mappingRow({ apaleoAccount: '5121', apaleoType: 'Revenues', apaleoName: 'Getränke 19%', apaleoVatPercent: '19', datevAccount: '8400', datevVatPercent: '19', kost1: 'BAR', kost2: 'F&B' }),
  mappingRow({ apaleoAccount: '1611', apaleoType: 'Payments', apaleoName: 'Visa', datevAccount: '1360', comment: 'Karte "Visa" über Geldtransit' }),
  mappingRow({ apaleoAccount: '9000', apaleoType: 'House', apaleoName: 'House', datevAccount: '0650', comment: 'Testwert – Klasse-0-Konto mit führender Null' }),
  mappingRow({ apaleoAccount: '*', apaleoType: 'Liabilities', apaleoVatPercent: '7', datevAccount: '1711', datevVatPercent: '7', comment: 'Anzahlungen 7 %' }),
  mappingRow({ apaleoAccount: '1400', apaleoType: 'AccountsReceivable', apaleoName: 'Accounts Receivable', datevAccount: '10000', comment: 'Sammeldebitor' }),
  mappingRow({ apaleoAccount: '3501', apaleoType: 'CityTaxes', apaleoName: 'City Tax 0%', apaleoVatPercent: '0', comment: 'Gast schuldet: 1590, 0 %. Betrieb schuldet: Erlös 7 % – mit Steuerberater entscheiden.' }),
];
