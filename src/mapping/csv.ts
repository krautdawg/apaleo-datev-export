import { CsvError, parse } from 'csv-parse/sync';
import { UserError } from '../core/errors.js';

/**
 * Excel-flavoured CSV: what the tool writes (UTF-8 with BOM, `;`, CRLF) and
 * what Excel and other tools save (CP1252 or UTF-8, `;` or `,`, LF or CRLF).
 * Lines starting with `#` are comments.
 */

export type Separator = ';' | ',';
export type TextEncodingName = 'utf-8' | 'windows-1252';

const BOM = [0xef, 0xbb, 0xbf];
const LINE_BREAK = '\r\n';

export interface DecodedCsv {
  text: string;
  encoding: TextEncodingName;
  bom: boolean;
}

/** Strips a UTF-8 byte-order mark and decodes as UTF-8 if the bytes are valid UTF-8, else as CP1252. */
export function decodeCsv(bytes: Uint8Array): DecodedCsv {
  const bom = BOM.every((byte, i) => bytes[i] === byte);
  const body = bom ? bytes.subarray(BOM.length) : bytes;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding: 'utf-8', bom };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(body), encoding: 'windows-1252', bom };
  }
}

/** Comment lines (starting with `#`), without the `#`. */
export function commentLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('#'))
    .map((line) => line.slice(1).trim());
}

/** `;` or `,`, whichever occurs more often in the header line (the first non-comment line). */
export function detectSeparator(text: string): Separator {
  const header = text.split(/\r?\n/).find((line) => line.trim() !== '' && !line.startsWith('#')) ?? '';
  const count = (char: string) => header.split(char).length - 1;
  return count(',') > count(';') ? ',' : ';';
}

export interface CsvRecord {
  /** Line the record ends on, 1-based. */
  line: number;
  fields: string[];
}

/** Parses CSV text into records, dropping comment lines and records whose cells are all empty. */
export function parseCsv(text: string, separator: Separator, what: string): CsvRecord[] {
  let parsed: { record: string[]; info: { bytes: number } }[];
  try {
    // With `info: true` every record comes as { record, info }; the typings do not model that.
    parsed = parse(text, {
      delimiter: separator,
      comment: '#',
      comment_no_infix: true,
      relax_column_count: true,
      skip_empty_lines: true,
      info: true,
    }) as unknown as typeof parsed;
  } catch (error) {
    if (!(error instanceof CsvError)) throw error;
    throw new UserError(`Cannot read ${what}: ${error.message}`);
  }
  const lineOf = lineCounter(text);
  return parsed
    .filter(({ record }) => record.some((field) => field.trim() !== ''))
    .map(({ record, info }) => ({ line: lineOf(info.bytes), fields: record }));
}

/**
 * The line a record ends on, from the UTF-8 byte offset csv-parse reports after
 * it (its own `info.lines` miscounts CRLF inside quoted cells).
 */
function lineCounter(text: string): (byteOffset: number) => number {
  const bytes = new TextEncoder().encode(text);
  const LF = 0x0a;
  // linesBefore[i] = number of line feeds in bytes[0 .. i).
  const linesBefore = new Uint32Array(bytes.length + 1);
  bytes.forEach((byte, i) => (linesBefore[i + 1] = (linesBefore[i] ?? 0) + (byte === LF ? 1 : 0)));
  return (byteOffset) => {
    const lines = linesBefore[byteOffset] ?? 0;
    return bytes[byteOffset - 1] === LF ? lines : lines + 1;
  };
}

/** One CSV line. A field is quoted only when it holds the separator, a quote, a line break or edge spaces. */
export function formatCsvLine(fields: readonly string[], separator: Separator = ';'): string {
  return fields
    .map((field) =>
      field.includes(separator) || /["\r\n]/.test(field) || field !== field.trim()
        ? `"${field.replaceAll('"', '""')}"`
        : field,
    )
    .join(separator);
}

/** A CSV file as the tool writes it: UTF-8 with BOM, `;`, CRLF after every line. */
export function encodeCsvFile(comments: readonly string[], records: readonly (readonly string[])[]): Uint8Array {
  const lines = [...comments.map((c) => `# ${c}`), ...records.map((r) => formatCsvLine(r))];
  const text = lines.map((line) => `${line}${LINE_BREAK}`).join('');
  return concatBytes(Uint8Array.from(BOM), new TextEncoder().encode(text));
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
