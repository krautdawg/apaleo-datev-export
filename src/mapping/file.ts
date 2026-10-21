import { encodeCp1252 } from '../datev/cp1252.js';
import type { SourceAccount } from '../core/source.js';
import { concatBytes, decodeCsv, detectSeparator, encodeCsvFile, formatCsvLine, parseCsv } from './csv.js';
import type { Template } from './template.js';
import { ANY_TYPE, MAPPING_COLUMNS, ROW_FIELDS, rowKey, type Mapping, type MappingColumn, type MappingRowValues } from './types.js';

/** The comment line on top of a written mapping file. It names the template, so `mapping check` knows the SKR. */
export function mappingHeaderComment(template: Template, sachkontenlaenge: number): string {
  return (
    `apaleo-datev Kontenzuordnung, Vorlage ${template.id}, Sachkontenlänge ${sachkontenlaenge}. ` +
    'Alle Vorschläge mit dem Steuerberater prüfen. Spalte datev_account in Excel als Text formatieren.'
  );
}

function toRecord(row: MappingRowValues): string[] {
  return MAPPING_COLUMNS.map((column) => row[ROW_FIELDS[column]]);
}

/** A complete mapping file: UTF-8 with BOM, `;`, CRLF. */
export function renderMappingFile(comments: readonly string[], rows: readonly MappingRowValues[]): Uint8Array {
  return encodeCsvFile(comments, [[...MAPPING_COLUMNS], ...rows.map(toRecord)]);
}

type KeyFields = Pick<MappingRowValues, 'apaleoAccount' | 'apaleoType' | 'apaleoVatPercent'>;

/** The suggested rows whose key the existing rows do not have yet. */
export function newRows(existing: readonly KeyFields[], suggested: readonly MappingRowValues[]): MappingRowValues[] {
  const keys = new Set(existing.map(rowKey));
  return suggested.filter((row) => !keys.has(rowKey(row)));
}

/**
 * The existing file with the rows appended, byte for byte unchanged before them.
 * The new lines follow the file's encoding, separator, line breaks and column order.
 */
export function appendRows(existing: Uint8Array, rows: readonly MappingRowValues[]): Uint8Array {
  if (rows.length === 0) return existing;
  const { text, encoding } = decodeCsv(existing);
  const separator = detectSeparator(text);
  const lineBreak = text.includes('\r\n') || !text.includes('\n') ? '\r\n' : '\n';
  // Parsed, not split: tools such as LibreOffice quote every header cell.
  const header = parseCsv(text, separator, 'the mapping file')[0]?.fields ?? [];
  const order = header.map((name) => name.trim().toLowerCase());
  const lines = rows.map((row) =>
    formatCsvLine(
      order.map((name) => (Object.hasOwn(ROW_FIELDS, name) ? row[ROW_FIELDS[name as MappingColumn]] : '')),
      separator,
    ),
  );
  const prefix = text === '' || text.endsWith('\n') ? '' : lineBreak;
  const appended = `${prefix}${lines.join(lineBreak)}${lineBreak}`;
  const bytes = encoding === 'utf-8' ? new TextEncoder().encode(appended) : encodeCp1252(appended).bytes;
  return concatBytes(existing, bytes);
}

/**
 * Turns the rows of a Grman export into rows of our layout: each number becomes
 * one row per apaleo type it has in the chart (or stays `*any*` when it is not
 * in the chart); DATEV account and cost centres are kept, BU key and DATEV VAT
 * rate stay empty.
 */
export function convertGrmanRows(mapping: Mapping, accounts: readonly SourceAccount[]): MappingRowValues[] {
  const rows = new Map<string, MappingRowValues>();
  for (const row of mapping.rows) {
    const matches = accounts.filter((a) => a.number === row.apaleoAccount);
    const targets = matches.length > 0 ? matches : [undefined];
    for (const account of targets) {
      const converted: MappingRowValues = {
        apaleoAccount: row.apaleoAccount,
        apaleoType: account?.type ?? ANY_TYPE,
        apaleoName: account?.name ?? '',
        apaleoVatPercent: account?.vat === undefined ? '' : String(account.vat.percent),
        datevAccount: row.datevAccount,
        buKey: '',
        datevVatPercent: '',
        kost1: row.kost1,
        kost2: row.kost2,
        comment: 'Aus dem Grman-Export übernommen: BU-Schlüssel und USt-Satz prüfen.',
      };
      const key = rowKey(converted);
      if (!rows.has(key)) rows.set(key, converted);
    }
  }
  return [...rows.values()];
}
