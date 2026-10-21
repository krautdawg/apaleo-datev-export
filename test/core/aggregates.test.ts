import { describe, expect, it } from 'vitest';
import { compareAggregates } from '../../src/core/aggregates.js';
import { ChartIndex } from '../../src/core/chart.js';
import type { AccountTotals, SourceAccount } from '../../src/core/source.js';
import { ledgerLine } from '../helpers/ledger.js';

const account = (number: string, type: string, parentNumber?: string): SourceAccount => ({
  number,
  name: number,
  type,
  ledger: type === 'Receivables' ? 'guest' : 'global',
  isArchived: false,
  hasChildren: parentNumber === undefined,
  ...(parentNumber ? { parentNumber } : {}),
});
const chart = new ChartIndex([account('5000', 'Revenues'), account('5011', 'Revenues', '5000'), account('1200', 'Receivables')]);
const money = (value: string) => ({ value, currency: 'EUR' });

function totals(rows: [string, string, string, string][]): AccountTotals {
  return {
    businessDate: '2026-09-14',
    accounts: rows.map(([number, type, debited, credited]) => ({
      account: { number, name: number, type },
      debited: money(debited),
      credited: money(credited),
      balance: money('0'),
    })),
    total: { debited: money('0'), credited: money('0'), balance: money('0') },
  };
}

describe('compareAggregates', () => {
  const lines = [ledgerLine(), ledgerLine({ grossCents: 1200, netCents: 1121, sourceEntryNumber: 'BSPE0003' })];

  it('rolls lines up to main accounts and matches gross amounts, rounding precise values', () => {
    const result = compareAggregates(totals([['5000', 'Revenues', '0', '112.0004'], ['1200', 'Receivables', '112', '0']]), lines, chart);
    expect(result.map((r) => [r.account.number, r.match, r.gross, r.net])).toEqual([
      ['5000', 'gross', { debitCents: 0, creditCents: 11200 }, { debitCents: 0, creditCents: 10467 }],
      ['1200', 'gross', { debitCents: 11200, creditCents: 0 }, { debitCents: 10467, creditCents: 0 }],
    ]);
  });

  it('recognises net totals and differences', () => {
    const result = compareAggregates(totals([['5000', 'Revenues', '0', '104.67'], ['1200', 'Receivables', '1', '0']]), lines, chart);
    expect(result.map((r) => r.match)).toEqual(['net', 'none']);
  });

  it('lists ledger accounts that the totals do not have', () => {
    const result = compareAggregates(totals([]), lines, chart);
    expect(result.map((r) => [r.account.number, r.source, r.match])).toEqual([
      ['1200', { debitCents: 0, creditCents: 0 }, 'none'],
      ['5000', { debitCents: 0, creditCents: 0 }, 'none'],
    ]);
  });

  it('adds up totals of one account number that appears in several ledgers', () => {
    const guestAndExternal = [
      ledgerLine({ grossCents: 10000, netCents: 10000, taxes: [] }),
      ledgerLine({ grossCents: 5000, netCents: 5000, taxes: [], sourceEntryNumber: 'BSPE0004' }),
    ].map((line) => ({ ...line, debit: line.credit, credit: { number: '1200', name: '1200', type: 'Receivables' } }));
    const result = compareAggregates(
      totals([
        ['5000', 'Revenues', '150', '0'],
        ['1200', 'Receivables', '0', '100.00'],
        ['1200', 'Receivables', '0', '50.00'],
      ]),
      guestAndExternal,
      chart,
    );
    expect(result.map((r) => [r.account.number, r.source, r.match])).toEqual([
      ['5000', { debitCents: 15000, creditCents: 0 }, 'both'],
      ['1200', { debitCents: 0, creditCents: 15000 }, 'both'],
    ]);
  });

  it('matches both when gross equals net', () => {
    const noVat = [ledgerLine({ grossCents: 500, netCents: 500, taxes: [] })];
    const result = compareAggregates(totals([['5000', 'Revenues', '0', '5'], ['1200', 'Receivables', '5', '0']]), noVat, chart);
    expect(result.map((r) => r.match)).toEqual(['both', 'both']);
  });
});
