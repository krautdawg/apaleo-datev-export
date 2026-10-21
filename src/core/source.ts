import type { LocalDate } from './date.js';

/**
 * The PMS-neutral source contract. Mapping, posting and export code depend on
 * these types only; each PMS (apaleo today, Mews or Smoobu later) implements
 * `SourceAdapter` in `src/sources/<name>`.
 */

/**
 * Account types use apaleo's names, the most detailed subledger model known so
 * far. Other sources map onto them. Unknown values from a source are kept as
 * strings so mapping validation can report them instead of the parser crashing.
 */
export const ACCOUNT_TYPES = [
  'Revenues',
  'Payments',
  'Liabilities',
  'Receivables',
  'Vat',
  'House',
  'AccountsReceivable',
  'CityTaxes',
  'TransitoryItems',
  'VatOnLiabilities',
  'LossOfAccountsReceivable',
  'SecondCityTax',
  'GuestLevies',
] as const;

export type KnownAccountType = (typeof ACCOUNT_TYPES)[number];
// `string & {}` keeps editor completion for the known names while accepting any string.
export type AccountType = KnownAccountType | (string & {});

/** The four account lists of a subledger. Account numbers can repeat across them. */
export type Ledger = 'global' | 'guest' | 'external' | 'booking';

/** One side (debit or credit) of a ledger line. */
export interface AccountRef {
  number: string;
  name: string;
  type: AccountType;
  /** Missing on top-level accounts and, in apaleo, on per-reservation accounts. */
  parentNumber?: string;
}

export interface LedgerTax {
  /** The source's VAT type, for example `Reduced`, `Normal` or `Without`. */
  vatType: string;
  percent: number;
  /** The source's precise amount as decimal text, any number of decimals (`"2.3789916"`). Negative on allowances and corrections. */
  amountPrecise: string;
  /** `amountPrecise` rounded half away from zero to integer cents. */
  amountCents: number;
}

/**
 * One booked debit/credit pair of the source's subledger. Amounts carry the
 * source's sign (allowances are negative). The gross amount is whole cents;
 * net and tax amounts are kept as the source's precise decimal text and, for
 * cent-based rules, rounded half away from zero to cents. Add precise amounts
 * with `sumDecimals`, never as floating-point numbers.
 */
export interface LedgerLine {
  businessDate: LocalDate;
  /** The ISO timestamp exactly as the source sent it (any number of fractional digits). */
  postedAt: string;
  debit: AccountRef;
  credit: AccountRef;
  /** The business transaction, for example `PostCharge` or `PostPayment`. */
  command: string;
  currency: string;
  grossCents: number;
  /** The source's precise net amount as decimal text (`"12.5210084"`). */
  netPrecise: string;
  /** `netPrecise` rounded half away from zero to integer cents. */
  netCents: number;
  /** Passed through as received; normalisation happens in the posting rules. */
  taxes: LedgerTax[];
  receipt: { type?: string; number: string };
  reference: string;
  /** For example `Guest`, `House`, `External` or `Booking`. */
  referenceType: string;
  /** The source's raw entry number. Not unique: one entry can produce two lines. */
  sourceEntryNumber: string;
  source: string;
}

/** One account of the chart of accounts, flattened. */
export interface SourceAccount {
  number: string;
  name: string;
  type: AccountType;
  parentNumber?: string;
  ledger: Ledger;
  vat?: { type: string; percent: number };
  isArchived: boolean;
  hasChildren: boolean;
}

export interface SourceProperty {
  id: string;
  code: string;
  name: string;
  /** IANA time zone, for example `Europe/Berlin`. */
  timeZone: string;
  currency: string;
  countryCode?: string;
}

/** A precise decimal amount kept as text (more than two decimals allowed). */
export interface PreciseAmount {
  value: string;
  currency: string;
}

export interface AccountTotal {
  account: AccountRef;
  debited: PreciseAmount;
  credited: PreciseAmount;
  balance: PreciseAmount;
}

/** The source's own totals per main account for one business day, for completeness checks. */
export interface AccountTotals {
  businessDate: LocalDate;
  accounts: AccountTotal[];
  total: { debited: PreciseAmount; credited: PreciseAmount; balance: PreciseAmount };
}

export interface SourceAdapter {
  /** Short source name, written into `LedgerLine.source`. */
  readonly name: string;
  listProperties(): Promise<SourceProperty[]>;
  getChartOfAccounts(propertyId: string): Promise<SourceAccount[]>;
  /** Lines of every business day from `from` to `toExclusive`, sorted with `sortLedgerLines`. */
  getLedger(propertyId: string, from: LocalDate, toExclusive: LocalDate): Promise<LedgerLine[]>;
  getAccountTotals(propertyId: string, businessDate: LocalDate): Promise<AccountTotals>;
}

/**
 * Sorts by business date, source entry number and posting time. Ties keep their
 * input order (the sort is stable), so unchanged data always gives the same order.
 */
export function sortLedgerLines(lines: readonly LedgerLine[]): LedgerLine[] {
  const keyed = lines.map((line) => ({ line, instant: instantKey(line.postedAt) }));
  keyed.sort(
    (a, b) =>
      compare(a.line.businessDate, b.line.businessDate) ||
      compare(a.line.sourceEntryNumber, b.line.sourceEntryNumber) ||
      a.instant.seconds - b.instant.seconds ||
      compare(a.instant.fraction, b.instant.fraction),
  );
  return keyed.map(({ line }) => line);
}

const TIMESTAMP = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})$/i;

/** Splits an ISO timestamp into epoch seconds and its fraction, so 7 fractional digits still order correctly. */
function instantKey(timestamp: string): { seconds: number; fraction: string } {
  const match = TIMESTAMP.exec(timestamp);
  const seconds = match ? Date.parse(`${match[1]}${match[3]}`) / 1000 : Number.NaN;
  if (!match || Number.isNaN(seconds)) return { seconds: 0, fraction: timestamp };
  return { seconds, fraction: (match[2] ?? '').padEnd(9, '0') };
}

function compare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
