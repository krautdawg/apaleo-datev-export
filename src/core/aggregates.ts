import type { ChartIndex } from './chart.js';
import { decimalToCents, formatCents, negateDecimal, sumDecimals } from './money.js';
import type { AccountRef, AccountTotals, LedgerLine, LedgerTax } from './source.js';

/** What the ledger side of an account is added up from: gross, precise net, or precise tax (apaleo's VAT accounts). */
export type AggregateBasis = 'gross' | 'net' | 'tax';

export interface DebitCredit {
  debitCents: number;
  creditCents: number;
}

export interface AggregateComparison {
  account: AccountRef;
  basis: AggregateBasis;
  /** apaleo's debit and credit, rounded to cents, for information only: they follow no single rule. */
  source: DebitCredit;
  /** apaleo's balance (debit minus credit), rounded to cents. */
  sourceBalanceCents: number;
  /** The signed sum of the ledger lines (debit minus credit), rounded to cents. */
  ledgerBalanceCents: number;
  match: boolean;
}

/** Types whose aggregates apaleo keeps net (s10 design decision 8). */
const NET_TYPES: ReadonlySet<string> = new Set(['Revenues', 'Liabilities']);
const VAT_TYPES: ReadonlySet<string> = new Set(['Vat', 'VatOnLiabilities']);
/** The VAT account type apaleo books the taxes of a revenue or deposit side to. */
const VAT_ACCOUNT_OF: Readonly<Record<string, string>> = { Revenues: 'Vat', Liabilities: 'VatOnLiabilities' };

interface Row {
  account: AccountRef;
  source: string[];
  debited: string[];
  credited: string[];
  ledger: string[];
}

/**
 * Compares apaleo's daily aggregates with the ledger lines of the same day by
 * balance (debit minus credit), the one figure that follows a rule on real
 * data (s10 design decision 8):
 * - a side on a global chart account counts for that account; any other side
 *   (guest, external, booking, per-reservation, `/Offset`) for its main account;
 * - Revenues and Liabilities sides count with their precise net amount, every
 *   other type with its gross amount;
 * - each tax of a line with a Revenues side counts for the chart's `Vat`
 *   account of the same VAT type and rate, of a line with a Liabilities side
 *   for the `VatOnLiabilities` account, signed like that side.
 * Amounts are added exactly and rounded to cents only for the comparison.
 * Accounts apaleo lists for several ledgers are added up. An account only the
 * ledger has is listed when its balance is not zero.
 */
export function compareAggregates(totals: AccountTotals, lines: readonly LedgerLine[], chart: ChartIndex): AggregateComparison[] {
  const rows = new Map<string, Row>();
  const row = (account: AccountRef) => {
    let entry = rows.get(account.number);
    if (!entry) {
      entry = { account, source: [], debited: [], credited: [], ledger: [] };
      rows.set(account.number, entry);
    }
    return entry;
  };

  for (const total of totals.accounts) {
    const entry = row(total.account);
    entry.source.push(total.balance.value);
    entry.debited.push(total.debited.value);
    entry.credited.push(total.credited.value);
  }
  for (const line of lines) {
    for (const [ref, sign] of [[line.debit, 1], [line.credit, -1]] as const) {
      const amount = NET_TYPES.has(ref.type) ? line.netPrecise : formatCents(line.grossCents);
      row(aggregateAccount(ref, chart)).ledger.push(sign > 0 ? amount : negateDecimal(amount));
      const vatType = VAT_ACCOUNT_OF[ref.type];
      if (!vatType) continue;
      for (const tax of line.taxes) {
        row(vatAccount(vatType, tax, chart)).ledger.push(sign > 0 ? tax.amountPrecise : negateDecimal(tax.amountPrecise));
      }
    }
  }

  return [...rows.values()].flatMap((entry) => {
    const sourceBalanceCents = decimalToCents(sumDecimals(entry.source));
    const ledgerBalanceCents = decimalToCents(sumDecimals(entry.ledger));
    if (entry.source.length === 0 && ledgerBalanceCents === 0) return [];
    return [
      {
        account: entry.account,
        basis: basisOf(entry.account.type),
        source: { debitCents: decimalToCents(sumDecimals(entry.debited)), creditCents: decimalToCents(sumDecimals(entry.credited)) },
        sourceBalanceCents,
        ledgerBalanceCents,
        match: sourceBalanceCents === ledgerBalanceCents,
      },
    ];
  });
}

function basisOf(type: string): AggregateBasis {
  if (VAT_TYPES.has(type)) return 'tax';
  return NET_TYPES.has(type) ? 'net' : 'gross';
}

/** The account apaleo aggregates a ledger side on: a global chart account itself, any other its main account. */
function aggregateAccount(ref: AccountRef, chart: ChartIndex): AccountRef {
  const own = chart.find(ref.number, ref.type);
  if (own?.ledger === 'global' && own.type === ref.type) return { number: own.number, name: own.name, type: own.type };
  const main = chart.mainAccountOf(ref);
  return main ? { number: main.number, name: main.name, type: main.type } : ref;
}

/** The chart's VAT account of a type for a tax entry's VAT type and rate, else the top-level account of that type. */
function vatAccount(type: string, tax: LedgerTax, chart: ChartIndex): AccountRef {
  const found =
    chart.accounts.find((a) => a.type === type && a.vat?.type === tax.vatType && a.vat.percent === tax.percent) ??
    chart.mainAccountOf({ number: '', name: '', type });
  return found ? { number: found.number, name: found.name, type: found.type } : { number: `${type} ${tax.vatType} ${tax.percent} %`, name: type, type };
}
