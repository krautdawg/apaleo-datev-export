import type { ChartIndex } from '../core/chart.js';
import { depositMovement } from '../core/deposits.js';
import type { PostingConfig } from '../core/config.js';
import type { AccountRef, LedgerLine } from '../core/source.js';
import type { MappingRow } from '../mapping/index.js';

/**
 * The German label of an apaleo command, the first word of the Buchungstext
 * of a line that is neither revenue, deposit, payment, debtor transfer nor bad
 * debt (for example a move between two guest folios).
 */
const COMMAND_LABELS: Readonly<Record<string, string>> = {
  MoveLineItem: 'Umbuchung',
  PostToAccountsReceivables: 'Forderung an Debitor',
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

/** apaleo's standard revenue groups (the parent of `RevenueAccommodation_Reduced:7.00`). */
const REVENUE_GROUPS: Readonly<Record<string, string>> = {
  RevenueAccommodation: 'Logis',
  RevenueFoodAndBeverages: 'Speisen und Getränke',
  RevenueNoShow: 'No-Show',
  RevenueCancellationFees: 'Stornogebühr',
  RevenueOther: 'Sonstige Erlöse',
};

/**
 * apaleo's city tax and levy types: money the hotel collects for the
 * municipality, not revenue, so no `Erlös` and no English account name.
 */
const LEVY_LABELS: Readonly<Record<string, string>> = {
  CityTaxes: 'Kurtaxe / City Tax',
  SecondCityTax: 'Kurtaxe / City Tax 2',
  GuestLevies: 'Gästeabgabe',
};

/** apaleo's generic English payment-method names; card brands keep their name. */
const PAYMENT_LABELS: Readonly<Record<string, string>> = {
  'Cash Payment': 'Bar',
  Cash: 'Bar',
  'Cash and ATM': 'Bar',
  'Bank Transfer': 'Überweisung',
  'Direct Debit': 'Lastschrift',
  'Voucher Payment': 'Gutschein',
  'Other Payment': 'Sonstige',
  'Credit Card Payment': 'Kreditkarte',
  'Online banking': 'Onlinebanking',
  'Open Invoice': 'Offene Rechnung',
  Cheque: 'Scheck',
};
const PAYMENT_SUFFIX = / (?:Credit Card Payment|Card Payment|Payment)$/;
const BRAND_SPELLING: Readonly<Record<string, string>> = { MasterCard: 'Mastercard', GiroCard: 'Girocard' };

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
 * The German label of a revenue account: apaleo's standard groups by their
 * German name and the rate (`Logis 7 %`), other accounts by their own name
 * without apaleo's English prefix `Revenues `.
 */
export function revenueLabel(ref: AccountRef, chart: ChartIndex, rate: number): string {
  const numbers = [ref.number.split(/[_:]/)[0] ?? ref.number];
  let parent = chart.find(ref.number, ref.type)?.parentNumber ?? ref.parentNumber;
  while (parent !== undefined && !numbers.includes(parent)) {
    numbers.push(parent);
    parent = chart.find(parent, ref.type)?.parentNumber;
  }
  const group = numbers.map((number) => REVENUE_GROUPS[number]).find((label) => label !== undefined);
  return group ? `${group} ${rate} %` : ref.name.replace(/^Revenues\s+/, '');
}

/** A payment method in German: generic names translated, card brands kept (`Visa Debit Card Payment` → `Visa Debit`). */
export function paymentLabel(name: string): string {
  const fixed = PAYMENT_LABELS[name];
  if (fixed) return fixed;
  const label = name.replace(/^Payment by /, '').replace(PAYMENT_SUFFIX, '');
  return Object.entries(BRAND_SPELLING).reduce((text, [from, to]) => text.replace(from, to), label) || 'Zahlung';
}

/**
 * The Buchungstext (s10 design decision 10), German only and cut to the 60
 * characters DATEV allows. It names the business case from the command, the
 * sign and the account types, then a German label:
 * - revenue: `Erlös` (credited and positive, or debited and negative) or
 *   `Erlösminderung` + revenue label;
 * - city tax and levies: `Kurtaxe / City Tax`, `Kurtaxe / City Tax 2` or
 *   `Gästeabgabe` (`Korrektur ` before it when reduced), with the rate if not 0;
 * - deposits, by side and sign: `Anzahlung` (via a payment), `Umbuchung
 *   Anzahlung` (from a folio), `Auflösung Anzahlung` (against a folio),
 *   `Erstattung Anzahlung` (paid back), each with the deposit's VAT rate;
 * - payments: `Zahlung` or `Erstattung` + payment label;
 * - `Forderung an Debitor`, `Forderungsverlust` with the rate;
 * - else the command label + `accountLabel` of `labelled`.
 * `rate` is the VAT rate of the booking (0 without VAT).
 */
export function buchungstext(line: LedgerLine, labelled: AccountRef, chart: ChartIndex, rate: number): string {
  return businessText(line, labelled, chart, rate).slice(0, BUCHUNGSTEXT_LENGTH).trim();
}

function businessText(line: LedgerLine, labelled: AccountRef, chart: ChartIndex, rate: number): string {
  const side = (type: string) =>
    line.credit.type === type ? { ref: line.credit, credited: true } : line.debit.type === type ? { ref: line.debit, credited: false } : undefined;
  const positive = line.grossCents > 0;
  const revenue = side('Revenues');
  if (revenue) return `${revenue.credited === positive ? 'Erlös' : 'Erlösminderung'} ${revenueLabel(revenue.ref, chart, rate)}`;
  const levy = Object.keys(LEVY_LABELS).map(side).find((found) => found !== undefined);
  if (levy) {
    const label = `${LEVY_LABELS[levy.ref.type] ?? ''}${rate === 0 ? '' : ` ${rate} %`}`;
    return levy.credited === positive ? label : `Korrektur ${label}`;
  }
  const deposit = depositMovement(line);
  if (deposit) {
    const label = deposit.direction === 'increase'
      ? (deposit.viaPayment ? 'Anzahlung' : 'Umbuchung Anzahlung')
      : (deposit.viaPayment ? 'Erstattung Anzahlung' : 'Auflösung Anzahlung');
    return `${label} ${rate} %`;
  }
  const payment = side('Payments');
  if (payment) return `${payment.credited === positive ? 'Erstattung' : 'Zahlung'} ${paymentLabel(payment.ref.name)}`;
  if (side('AccountsReceivable') && side('Receivables')) return 'Forderung an Debitor';
  if (side('LossOfAccountsReceivable')) return `Forderungsverlust ${rate} %`;
  const command = commandLabel(line.command);
  const account = accountLabel(labelled, chart);
  return account.startsWith(`${command} `) ? account : `${command} ${account}`;
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
