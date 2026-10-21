import type { ChartIndex } from './chart.js';
import { decimalToCents } from './money.js';
import type { AccountRef, AccountTotals, LedgerLine } from './source.js';

export interface DebitCredit {
  debitCents: number;
  creditCents: number;
}

/** Which ledger amounts match the source's own totals for one main account. */
export type AggregateMatch = 'gross' | 'net' | 'both' | 'none';

export interface AggregateComparison {
  account: AccountRef;
  source: DebitCredit;
  gross: DebitCredit;
  net: DebitCredit;
  match: AggregateMatch;
}

/**
 * Rolls the ledger lines of one business day up to their main accounts and
 * compares them with the source's daily totals, against gross and against net
 * (apaleo does not document which one its aggregates use). Precise source
 * amounts are rounded to cents for the comparison only. Totals for the same
 * account number from different ledgers are added together.
 */
export function compareAggregates(
  totals: AccountTotals,
  lines: readonly LedgerLine[],
  chart: ChartIndex,
): AggregateComparison[] {
  const rows = new Map<string, Omit<AggregateComparison, 'match'>>();
  const row = (account: AccountRef) => {
    let entry = rows.get(account.number);
    if (!entry) {
      entry = { account, source: zero(), gross: zero(), net: zero() };
      rows.set(account.number, entry);
    }
    return entry;
  };

  // One account number can appear in several ledgers (1200 in guest and
  // external, for example), so the source amounts are added up per number.
  for (const total of totals.accounts) {
    const { source } = row(total.account);
    source.debitCents += decimalToCents(total.debited.value);
    source.creditCents += decimalToCents(total.credited.value);
  }
  for (const line of lines) {
    for (const [ref, side] of [[line.debit, 'debitCents'], [line.credit, 'creditCents']] as const) {
      const main = chart.mainAccountOf(ref);
      const entry = row(main ? { number: main.number, name: main.name, type: main.type } : ref);
      entry.gross[side] += line.grossCents;
      entry.net[side] += line.netCents;
    }
  }
  return [...rows.values()].map((entry) => ({ ...entry, match: matchOf(entry) }));
}

function matchOf({ source, gross, net }: Omit<AggregateComparison, 'match'>): AggregateMatch {
  const same = (a: DebitCredit) => a.debitCents === source.debitCents && a.creditCents === source.creditCents;
  if (same(gross)) return same(net) ? 'both' : 'gross';
  return same(net) ? 'net' : 'none';
}

function zero(): DebitCredit {
  return { debitCents: 0, creditCents: 0 };
}
