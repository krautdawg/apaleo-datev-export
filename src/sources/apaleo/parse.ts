import type { z } from 'zod';
import type { LocalDate } from '../../core/date.js';
import { REPORT_PROBLEM_HINT } from '../../core/errors.js';
import { compareDecimals, decimalToCents, negateDecimal, normaliseDecimal, sumDecimals, toCents } from '../../core/money.js';
import type {
  AccountRef,
  AccountTotals,
  Ledger,
  LedgerLine,
  PreciseAmount,
  SourceAccount,
  SourceProperty,
} from '../../core/source.js';
import type {
  SlimFinanceAccount,
  aggregateList,
  chartOfAccounts,
  exportAccount,
  exportTransaction,
  propertyList,
} from './schemas.js';
import { ApaleoError } from './errors.js';

export const SOURCE_NAME = 'apaleo';

type ExportTransaction = z.output<typeof exportTransaction>;

/** Gross may differ from net plus taxes by at most this much (a consistency guard, not a rounding tolerance). */
const MAX_GROSS_DIFFERENCE = '0.005';

/**
 * apaleo's precise amount as plain decimal text. `String(number)` is the
 * shortest text that reads back as the same number: exact for apaleo's eight
 * decimals at hotel amounts (the gross check catches anything else).
 */
function preciseText(amount: number): string {
  return normaliseDecimal(String(amount));
}

/**
 * Converts one export line to the canonical ledger line. The gross amount must
 * be whole cents; net and tax amounts keep apaleo's decimals (up to eight on
 * real data) and are rounded half away from zero for the cent fields. Fails
 * when gross differs from net plus the taxes by more than half a cent.
 */
export function toLedgerLine(item: ExportTransaction, where: string): LedgerLine {
  const entry = `apaleo ${where}, source entry ${item.sourceEntryNumber}`;
  const grossCents = toCents(item.grossAmount, `${entry}, grossAmount`);
  const netPrecise = preciseText(item.netAmount);
  const taxes = (item.taxes ?? []).map((tax) => {
    const amountPrecise = preciseText(tax.amount);
    return { vatType: tax.type, percent: tax.percent, amountPrecise, amountCents: decimalToCents(amountPrecise) };
  });
  const gross = preciseText(item.grossAmount);
  const difference = sumDecimals([gross, negateDecimal(netPrecise), ...taxes.map((tax) => negateDecimal(tax.amountPrecise))]);
  if (compareDecimals(difference.replace(/^-/, ''), MAX_GROSS_DIFFERENCE) > 0) {
    throw new ApaleoError(
      `${entry}: gross ${gross} is not net ${netPrecise} plus the taxes ${taxes.map((tax) => tax.amountPrecise).join(' + ') || '(none)'} ` +
        `(difference ${difference}). ${REPORT_PROBLEM_HINT}`,
    );
  }
  const receipt: LedgerLine['receipt'] = { number: item.receipt.number };
  if (item.receipt.type !== undefined) receipt.type = item.receipt.type;
  return {
    businessDate: item.date as LocalDate,
    postedAt: item.timestamp,
    debit: toAccountRef(item.debitedAccount),
    credit: toAccountRef(item.creditedAccount),
    command: item.command,
    currency: item.currency,
    grossCents,
    netPrecise,
    netCents: decimalToCents(netPrecise),
    taxes,
    receipt,
    reference: item.reference,
    referenceType: item.referenceType,
    sourceEntryNumber: item.sourceEntryNumber,
    source: SOURCE_NAME,
  };
}

function toAccountRef(account: z.output<typeof exportAccount>): AccountRef {
  const ref: AccountRef = { number: account.number, name: account.name, type: account.type };
  if (account.parentNumber) ref.parentNumber = account.parentNumber;
  return ref;
}

const LEDGER_LISTS: readonly [keyof z.output<typeof chartOfAccounts>, Ledger][] = [
  ['globalAccounts', 'global'],
  ['guestAccounts', 'guest'],
  ['externalAccounts', 'external'],
  ['bookingAccounts', 'booking'],
];

/** Flattens the nested chart, keeping which of the four ledgers each account belongs to. */
export function flattenChart(chart: z.output<typeof chartOfAccounts>): SourceAccount[] {
  const result: SourceAccount[] = [];
  const visit = (account: SlimFinanceAccount, ledger: Ledger, containerNumber: string | undefined) => {
    const flat: SourceAccount = {
      number: account.accountNumber,
      name: account.name,
      type: account.type,
      ledger,
      isArchived: account.isArchived,
      hasChildren: account.hasChildren,
    };
    const parentNumber = account.parentNumber || containerNumber;
    if (parentNumber) flat.parentNumber = parentNumber;
    if (account.vat) flat.vat = { type: account.vat.type, percent: account.vat.percent };
    result.push(flat);
    for (const sub of account.subAccounts ?? []) visit(sub, ledger, account.accountNumber);
  };
  for (const [list, ledger] of LEDGER_LISTS) {
    for (const account of chart[list]) visit(account, ledger, undefined);
  }
  return result;
}

export function toProperties(list: z.output<typeof propertyList>): SourceProperty[] {
  return list.properties.map((p) => {
    const property: SourceProperty = { id: p.id, code: p.code, name: p.name, timeZone: p.timeZone, currency: p.currencyCode };
    if (p.location?.countryCode) property.countryCode = p.location.countryCode;
    return property;
  });
}

/** Keeps apaleo's precise amounts as decimal text; no sub-cent guard applies here. */
export function toAccountTotals(list: z.output<typeof aggregateList>, businessDate: LocalDate): AccountTotals {
  return {
    businessDate,
    accounts: list.aggregations.map((item) => ({
      account: toAccountRef(item.account),
      debited: precise(item.debitedAmount),
      credited: precise(item.creditedAmount),
      balance: precise(item.balance),
    })),
    total: {
      debited: precise(list.total.debitedAmount),
      credited: precise(list.total.creditedAmount),
      balance: precise(list.total.balance),
    },
  };
}

/** Totals for a day without transactions (HTTP 204). The currency is unknown, so it is empty. */
export function emptyAccountTotals(businessDate: LocalDate): AccountTotals {
  const zero = { value: '0', currency: '' };
  return { businessDate, accounts: [], total: { debited: zero, credited: zero, balance: zero } };
}

function precise(amount: { amount: number; currency: string }): PreciseAmount {
  return { value: String(amount.amount), currency: amount.currency };
}
