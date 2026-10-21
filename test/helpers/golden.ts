import { BUCHUNGSSTAPEL_COLUMNS } from '../../src/datev/columns.js';
import { EXTF_HEADER_FIELDS } from '../../src/datev/header.js';
import { splitFields } from './extf.js';

const decoder = new TextDecoder('windows-1252');
const MAX_REPORTED = 10;

/** Shows CR and LF so a line-end difference is visible. */
function visible(text: string): string {
  return text.replaceAll('\r', '\\r').replaceAll('\n', '\\n');
}

function fieldName(lineNumber: number, index: number): string {
  if (lineNumber === 1) return EXTF_HEADER_FIELDS[index]?.name ?? '?';
  if (lineNumber === 2) return `heading ${index + 1}`;
  return BUCHUNGSSTAPEL_COLUMNS[index]?.name ?? '?';
}

function describeLine(lineNumber: number, expected: string, actual: string): string[] {
  const head = `line ${lineNumber}:`;
  const expectedFields = splitFields(expected.replace(/\r?\n$/, ''));
  const actualFields = splitFields(actual.replace(/\r?\n$/, ''));
  const sameEnding = expected.slice(expected.replace(/\r?\n$/, '').length) === actual.slice(actual.replace(/\r?\n$/, '').length);
  if (expectedFields.length !== actualFields.length || !sameEnding) {
    return [head, `  - expected: ${visible(expected)}`, `  + actual:   ${visible(actual)}`];
  }
  const fields = expectedFields.flatMap((field, i) =>
    field === actualFields[i]
      ? []
      : [`  field ${i + 1} (${fieldName(lineNumber, i)}): expected ${field || '(empty)'}, got ${actualFields[i] || '(empty)'}`],
  );
  return [head, ...fields];
}

/**
 * A readable description of how two CP1252 files differ, line by line and field
 * by field, or undefined when the bytes are identical.
 */
export function describeDifference(expected: Uint8Array, actual: Uint8Array): string | undefined {
  if (expected.length === actual.length && expected.every((byte, i) => byte === actual[i])) return undefined;
  const split = (bytes: Uint8Array) => decoder.decode(bytes).split(/(?<=\n)/);
  const expectedLines = split(expected);
  const actualLines = split(actual);
  const report: string[] = [];
  const count = Math.max(expectedLines.length, actualLines.length);
  for (let i = 0; i < count && report.length < MAX_REPORTED * 3; i++) {
    const [e, a] = [expectedLines[i] ?? '', actualLines[i] ?? ''];
    if (e !== a) report.push(...describeLine(i + 1, e || '(missing line)', a || '(missing line)'));
  }
  if (report.length === 0) report.push('the bytes differ but decode to the same text (check characters outside CP1252)');
  return report.join('\n');
}
