import type { ChartIndex } from '../core/chart.js';
import type { PostingConfig } from '../core/config.js';
import type { AccountRef, LedgerLine } from '../core/source.js';
import type { MappingRow } from '../mapping/index.js';

/** The German label of an apaleo command, the first word of the Buchungstext. */
const COMMAND_LABELS: Readonly<Record<string, string>> = {
  PostCharge: 'Erlös',
  PostPayment: 'Zahlung',
  PostPrepayment: 'Anzahlung',
  MoveLineItem: 'Umbuchung',
  PostToAccountsReceivables: 'Forderung',
  PostToLossOfAccountsReceivables: 'Forderungsverlust',
  PostPrepaymentVat: 'USt Anzahlung',
};
const DEFAULT_COMMAND_LABEL = 'Buchung';

/**
 * Fixed labels for guest, booking and per-reservation accounts: their names may
 * contain the guest's name (a folio called "Müller, Hans"), which must never
 * reach the DATEV file.
 */
const GUEST_ACCOUNT_LABELS: Readonly<Record<string, string>> = {
  Receivables: 'Gastforderung',
  AccountsReceivable: 'Debitor',
  Liabilities: 'Anzahlung Gast',
};

const BUCHUNGSTEXT_LENGTH = 60;

export function commandLabel(command: string): string {
  return COMMAND_LABELS[command] ?? DEFAULT_COMMAND_LABEL;
}

/**
 * The name of an account as it may appear in the Buchungstext. For Receivables,
 * AccountsReceivable and Liabilities accounts outside the global ledger (or with
 * a parent), the leaf name may be a guest's name: they get the name of their
 * global parent account, else a fixed label.
 */
export function accountLabel(ref: AccountRef, chart: ChartIndex): string {
  const fixed = GUEST_ACCOUNT_LABELS[ref.type];
  if (fixed === undefined) return ref.name;
  const find = (number: string) => {
    const found = chart.find(number, ref.type);
    return found?.type === ref.type ? found : undefined;
  };
  const own = find(ref.number);
  const parentNumber = own ? own.parentNumber : ref.parentNumber;
  if (own?.ledger === 'global' && parentNumber === undefined) return ref.name;
  const parent = parentNumber === undefined ? undefined : find(parentNumber);
  return parent?.ledger === 'global' ? parent.name : fixed;
}

/**
 * `<command label> <account label>`, cut to the 60 characters DATEV allows. When
 * the account label already starts with the command label (`Anzahlung Gast` on a
 * prepayment), it stands alone.
 */
export function buchungstext(line: LedgerLine, labelled: AccountRef, chart: ChartIndex): string {
  const command = commandLabel(line.command);
  const account = accountLabel(labelled, chart);
  const text = account.startsWith(`${command} `) ? account : `${command} ${account}`;
  return text.slice(0, BUCHUNGSTEXT_LENGTH).trim();
}

/** The receipt number when configured and present, else the reference. Never an account name. */
export function belegfeld1(line: LedgerLine, mode: PostingConfig['belegfeld1']): string {
  const receipt = line.receipt.number.trim();
  return mode === 'receipt' && receipt !== '' ? receipt : line.reference;
}

/** KOST1 and KOST2: each the first non-empty value of the rows, in the order given. */
export function costCentres(rows: readonly MappingRow[]): { kost1?: string; kost2?: string } {
  const first = (field: 'kost1' | 'kost2') => rows.map((row) => row[field]).find((value) => value !== '');
  const kost1 = first('kost1');
  const kost2 = first('kost2');
  return { ...(kost1 === undefined ? {} : { kost1 }), ...(kost2 === undefined ? {} : { kost2 }) };
}
