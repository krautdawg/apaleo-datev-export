import { UserError } from '../core/errors.js';
import type { Finding } from '../core/findings.js';
import { paddedFinding, restoreLeadingZeros } from './account-length.js';
import { commentLines, decodeCsv, detectSeparator, parseCsv, type CsvRecord } from './csv.js';
import {
  ANY_TYPE,
  GRMAN_COLUMNS,
  MAPPING_COLUMNS,
  ROW_FIELDS,
  VAT_RELEVANT_TYPES,
  WILDCARD,
  parsePercent,
  rowKey,
  type Mapping,
  type MappingColumn,
  type MappingRow,
  type MappingRowValues,
  type Skr,
} from './types.js';

/** A mapping file that cannot be used at all. Lists every problem at once. */
export class MappingError extends UserError {
  override readonly name: string = 'MappingError';

  constructor(
    readonly path: string,
    readonly problems: readonly string[],
  ) {
    super(`Cannot use the mapping file ${path}:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
}

export interface ParseMappingOptions {
  /** Shown in messages. */
  path: string;
  /** Leading zeros are restored only at Sachkontenlänge 4 (see `restoreLeadingZeros`). */
  sachkontenlaenge: number;
}

export interface LoadMappingOptions {
  sachkontenlaenge: number;
  readFile: (path: string) => Promise<Uint8Array>;
}

const REQUIRED_COLUMNS: readonly MappingColumn[] = ['apaleo_account', 'apaleo_type', 'datev_account'];
const TEMPLATE_MARKER = /\bskr0([34])-hotel@\d+/i;

export async function loadMapping(path: string, options: LoadMappingOptions): Promise<Mapping> {
  let bytes: Uint8Array;
  try {
    bytes = await options.readFile(path);
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    throw new UserError(
      missing
        ? `No mapping file at ${path}. Create one with "apaleo-datev init-mapping --property <id> --skr 03|04".`
        : `Cannot read the mapping file ${path}: ${(error as Error).message}`,
    );
  }
  return parseMapping(bytes, { path, sachkontenlaenge: options.sachkontenlaenge });
}

/**
 * Reads a mapping CSV (UTF-8 or CP1252, `;` or `,`, our layout or the Grman
 * export layout). Fails with `MappingError` on a bad header, duplicate keys and
 * wildcard rows the resolution rules do not allow; restored leading zeros are
 * returned as `W-PADDED` findings.
 */
export function parseMapping(bytes: Uint8Array, options: ParseMappingOptions): Mapping {
  const { text } = decodeCsv(bytes);
  const [header, ...records] = parseCsv(text, detectSeparator(text), `the mapping file ${options.path}`);
  if (!header) throw new MappingError(options.path, ['the file is empty; it needs a header line']);

  const { layout, columns, findings } = readHeader(header, options.path);
  const rows: MappingRow[] = [];
  for (const record of records) {
    const row = toRow(record, columns, layout);
    const restored = restoreLeadingZeros(row.datevAccount, row.apaleoType, options.sachkontenlaenge);
    if (restored.padded) {
      const padded = { ...row, datevAccount: restored.account };
      findings.push(paddedFinding(padded, row.datevAccount));
      rows.push(padded);
    } else {
      rows.push(row);
    }
  }

  const problems = structuralProblems(rows);
  if (problems.length > 0) throw new MappingError(options.path, problems);
  const skr = TEMPLATE_MARKER.exec(commentLines(text).join('\n'))?.[1];
  return { path: options.path, layout, rows, findings, ...(skr ? { skr: `0${skr}` as Skr } : {}) };
}

interface Header {
  layout: Mapping['layout'];
  /** Column name per field position; undefined for ignored columns. */
  columns: (MappingColumn | undefined)[];
  findings: Finding[];
}

function readHeader(header: CsvRecord, path: string): Header {
  const names = header.fields.map((field) => field.trim().toLowerCase());
  const findings: Finding[] = [];
  if (names.some((name) => Object.hasOwn(GRMAN_COLUMNS, name))) {
    const columns = names.map((name) => (Object.hasOwn(GRMAN_COLUMNS, name) ? GRMAN_COLUMNS[name] : undefined));
    return { layout: 'grman', columns, findings };
  }
  const known = new Set<string>(MAPPING_COLUMNS);
  const columns = names.map((name) => (known.has(name) ? (name as MappingColumn) : undefined));
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
  if (missing.length > 0) {
    throw new MappingError(path, [
      `the header line lacks the column(s) ${missing.join(', ')}. Expected: ${MAPPING_COLUMNS.join(';')} ` +
        '(or the Grman export header ApaleoAccountNumber;DatevAccountNumber;CostCenter;CostCenter2)',
    ]);
  }
  const duplicate = columns.find((column, i) => column !== undefined && columns.indexOf(column) !== i);
  if (duplicate) throw new MappingError(path, [`the header line names the column ${duplicate} twice`]);
  for (const name of names.filter((n) => n !== '' && !known.has(n))) {
    findings.push({ code: 'W-UNKNOWN-COLUMN', message: `the column "${name}" is not used and is ignored`, value: name });
  }
  return { layout: 'standard', columns, findings };
}

function toRow(record: CsvRecord, columns: Header['columns'], layout: Mapping['layout']): MappingRow {
  const values: Record<keyof MappingRowValues, string> = {
    apaleoAccount: '',
    apaleoType: layout === 'grman' ? ANY_TYPE : '',
    apaleoName: '',
    apaleoVatPercent: '',
    datevAccount: '',
    buKey: '',
    datevVatPercent: '',
    kost1: '',
    kost2: '',
    comment: '',
  };
  record.fields.forEach((field, i) => {
    const column = columns[i];
    if (column) values[ROW_FIELDS[column]] = column === 'comment' || column === 'apaleo_name' ? field : field.trim();
  });
  return { line: record.line, ...values };
}

/** Problems that make the file unusable: incomplete keys, duplicate keys and forbidden wildcards. */
export function structuralProblems(rows: readonly MappingRow[]): string[] {
  const problems: string[] = [];
  const seen = new Map<string, MappingRow>();
  for (const row of rows) {
    const where = `line ${row.line}`;
    if (row.apaleoAccount === '' || row.apaleoType === '') {
      problems.push(`${where}: apaleo_account and apaleo_type must both be filled in`);
      continue;
    }
    const wildcard = wildcardProblem(row);
    if (wildcard) problems.push(`${where}: ${wildcard}`);
    const key = rowKey(row);
    const first = seen.get(key);
    if (first) {
      const rated = row.apaleoAccount === WILDCARD && VAT_RELEVANT_TYPES.has(row.apaleoType);
      const rate = rated ? ` at ${row.apaleoVatPercent} %` : '';
      problems.push(
        `lines ${first.line} and ${row.line} both map apaleo account ${row.apaleoAccount} of type ${row.apaleoType}${rate}; keep one of them`,
      );
    } else {
      seen.set(key, row);
    }
  }
  return problems;
}

function wildcardProblem(row: MappingRow): string | undefined {
  if (row.apaleoAccount !== WILDCARD) return undefined;
  if (row.apaleoType === ANY_TYPE) return 'a wildcard row (*) needs a concrete apaleo_type';
  if (row.apaleoType === 'Revenues') {
    return (
      'revenue accounts must be mapped one by one because of VAT: a wildcard row (*) for Revenues is not allowed. ' +
      'Add a row per apaleo revenue account instead'
    );
  }
  if (!VAT_RELEVANT_TYPES.has(row.apaleoType)) return undefined;
  const rate = parsePercent(row.apaleoVatPercent);
  if (rate === undefined || Number.isNaN(rate)) {
    return (
      `VAT-relevant wildcards must name a VAT rate: the wildcard row (*) for ${row.apaleoType} needs ` +
      'apaleo_vat_percent (one row per rate, for example 7, 19 and 0)'
    );
  }
  return undefined;
}
