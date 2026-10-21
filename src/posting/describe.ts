import type { Finding } from '../core/findings.js';
import { formatCents } from '../core/money.js';
import type { AccountRef, LedgerLine } from '../core/source.js';
import type { MappingRow } from '../mapping/index.js';

/**
 * Plain-language pieces of posting findings. Accounts are named by number and
 * type only: the names of guest folios can be guest names.
 */

export function accountText(ref: AccountRef): string {
  return `${ref.number} (${ref.type})`;
}

/** `apaleo entry BSPE0002 of 2026-09-14 (PostCharge, gross 100.00, debit …, credit …)`. */
export function lineText(line: LedgerLine): string {
  return (
    `apaleo entry ${line.sourceEntryNumber} of ${line.businessDate} (${line.command}, gross ${formatCents(line.grossCents)}, ` +
    `debit ${accountText(line.debit)}, credit ${accountText(line.credit)})`
  );
}

/** `mapping line 4 (DATEV 8300)`. */
export function rowText(row: MappingRow): string {
  return `mapping line ${row.line} (DATEV ${row.datevAccount})`;
}

export function percentText(rate: number): string {
  return `${rate} %`;
}

export function lineFinding(code: string, line: LedgerLine, message: string): Finding {
  return { code, message: `${lineText(line)}: ${message}`, value: line.sourceEntryNumber };
}
