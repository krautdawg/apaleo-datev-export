import { describe, expect, it } from 'vitest';
import { compareAggregates } from '../../src/core/aggregates.js';
import { ChartIndex } from '../../src/core/chart.js';
import { nextDay } from '../../src/core/date.js';
import type { AccountTotals, SourceAccount } from '../../src/core/source.js';
import { LIVE_DAYS, LIVE_PROPERTIES, loadLiveData } from '../helpers/apaleo.js';
import { ledgerLine, tax } from '../helpers/ledger.js';

const account = (number: string, type: string, extra: Partial<SourceAccount> = {}): SourceAccount => ({
  number,
  name: number,
  type,
  ledger: 'global',
  isArchived: false,
  hasChildren: false,
  ...extra,
});
const chart = new ChartIndex([
  account('5000', 'Revenues', { hasChildren: true }),
  account('5011', 'Revenues', { parentNumber: '5000', vat: { type: 'Reduced', percent: 7 } }),
  account('2007', 'Vat', { parentNumber: '2000', vat: { type: 'Reduced', percent: 7 } }),
  account('1611', 'Payments', { parentNumber: '1610' }),
  account('1200', 'Receivables', { ledger: 'guest', hasChildren: true }),
  account('1200', 'Receivables', { ledger: 'external', hasChildren: true }),
]);
const money = (value: string) => ({ value, currency: 'EUR' });
const LIVE = await loadLiveData();

/** Aggregates as apaleo lists them: [number, type, debited, credited], balance = debited − credited. */
function totals(rows: [string, string, string, string][]): AccountTotals {
  return {
    businessDate: '2026-09-14',
    accounts: rows.map(([number, type, debited, credited]) => ({
      account: { number, name: number, type },
      debited: money(debited),
      credited: money(credited),
      balance: money(String(Number(debited) - Number(credited))),
    })),
    total: { debited: money('0'), credited: money('0'), balance: money('0') },
  };
}

describe('compareAggregates (by balance)', () => {
  // A 7 % charge with apaleo's eight-decimal net and tax: 114.00 = 106.54205607 + 7.45794393.
  const charge = ledgerLine({ grossCents: 11_400, netPrecise: '106.54205607', netCents: 10_654, taxes: [tax('Reduced', 7, 746, '7.45794393')] });

  it('compares revenue net, its VAT account with the precise tax and other accounts gross', () => {
    const result = compareAggregates(
      totals([
        ['5011', 'Revenues', '0', '106.54205607'],
        ['2007', 'Vat', '0', '7.45794393'],
        ['1200', 'Receivables', '114', '0'],
      ]),
      [charge],
      chart,
    );
    expect(result.map((r) => [r.account.number, r.basis, r.sourceBalanceCents, r.ledgerBalanceCents, r.match])).toEqual([
      ['5011', 'net', -10_654, -10_654, true],
      ['2007', 'tax', -746, -746, true],
      ['1200', 'gross', 11_400, 11_400, true],
    ]);
  });

  it('keeps leaf global accounts and rolls guest accounts up to their parent', () => {
    const payment = ledgerLine({ debit: { number: '1611', name: 'Visa', type: 'Payments', parentNumber: '1610' }, credit: ledgerLine().debit, grossCents: 5_000, taxes: [] });
    const result = compareAggregates(totals([['1611', 'Payments', '50', '0'], ['1200', 'Receivables', '0', '50']]), [payment], chart);
    expect(result.map((r) => [r.account.number, r.match])).toEqual([
      ['1611', true],
      ['1200', true],
    ]);
  });

  it('compares the balance only: apaleo may list a negative charge as a debit', () => {
    const allowance = ledgerLine({ grossCents: -1_000, netPrecise: '-9.34579439', netCents: -935, taxes: [tax('Reduced', 7, -65, '-0.65420561')] });
    const result = compareAggregates(totals([['5011', 'Revenues', '9.34579439', '0']]), [allowance], chart);
    expect(result.find((r) => r.account.number === '5011')).toMatchObject({ source: { debitCents: 935, creditCents: 0 }, sourceBalanceCents: 935, match: true });
  });

  it('reports a difference and lists an account only the ledger has, when its balance is not zero', () => {
    const result = compareAggregates(totals([['5011', 'Revenues', '0', '100']]), [charge], chart);
    expect(result.map((r) => [r.account.number, r.sourceBalanceCents, r.ledgerBalanceCents, r.match])).toEqual([
      ['5011', -10_000, -10_654, false],
      ['1200', 0, 11_400, false],
      ['2007', 0, -746, false],
    ]);
  });

  it('adds up totals of one account number that apaleo lists for several ledgers', () => {
    const lines = [5_000, 2_500].map((grossCents) => ledgerLine({ debit: { number: '1611', name: 'Visa', type: 'Payments' }, grossCents, taxes: [] }));
    const moved = lines.map((line) => ({ ...line, credit: { number: 'X-1_Receivables', name: 'R', type: 'Receivables', parentNumber: '1200' } }));
    const result = compareAggregates(
      totals([
        ['1611', 'Payments', '75', '0'],
        ['1200', 'Receivables', '0', '50'],
        ['1200', 'Receivables', '0', '25'],
      ]),
      moved,
      chart,
    );
    expect(result.map((r) => [r.account.number, r.sourceBalanceCents, r.match])).toEqual([
      ['1611', 7_500, true],
      ['1200', -7_500, true],
    ]);
  });
});

describe('compareAggregates on the recorded apaleo sandbox', () => {
  const data = LIVE;

  it.each(LIVE_PROPERTIES.flatMap((property) => LIVE_DAYS.map((day) => [property, day] as const)))('%s %s: every listed account matches', (property, day) => {
    const lines = (data.ledger[property] ?? []).filter((line) => line.businessDate >= day && line.businessDate < nextDay(day));
    const recorded = data.totals?.[property]?.find((t) => t.businessDate === day);
    if (!recorded) throw new Error('recording missing');
    const result = compareAggregates(recorded, lines, new ChartIndex(data.charts[property] ?? []));
    expect(result.filter((r) => !r.match)).toEqual([]);
    expect(result).toHaveLength(recorded.accounts.length);
    if (day === '2026-10-21') expect(result).toHaveLength(property === 'BER' ? 18 : 19);
  });
});
