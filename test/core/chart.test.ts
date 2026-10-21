import { describe, expect, it } from 'vitest';
import { ChartIndex } from '../../src/core/chart.js';
import type { SourceAccount } from '../../src/core/source.js';

const account = (number: string, type: string, ledger: SourceAccount['ledger'], parentNumber?: string): SourceAccount => ({
  number,
  name: `${type} ${number}`,
  type,
  ledger,
  isArchived: false,
  hasChildren: false,
  ...(parentNumber ? { parentNumber } : {}),
});

const chart = new ChartIndex([
  account('1200', 'Receivables', 'external'),
  account('5000', 'Revenues', 'global'),
  account('5010', 'Revenues', 'global', '5000'),
  account('5011', 'Revenues', 'global', '5010'),
  account('1200', 'Receivables', 'guest'),
  account('3000', 'Liabilities', 'booking'),
  account('3000', 'Liabilities', 'guest'),
]);

describe('ChartIndex', () => {
  it('finds repeated numbers by type and ledger order', () => {
    expect(chart.find('1200', 'Receivables')?.ledger).toBe('guest');
    expect(chart.find('3000')?.ledger).toBe('guest');
    expect(chart.find('9999')).toBeUndefined();
    expect(chart.has('5011')).toBe(true);
  });

  it('rolls an account up its parent chain to the main account', () => {
    expect(chart.mainAccountOf({ number: '5011', name: 'x', type: 'Revenues' })?.number).toBe('5000');
    expect(chart.mainAccountOf({ number: '5000', name: 'x', type: 'Revenues' })?.number).toBe('5000');
  });

  it('uses the parentNumber of an account that is not in the chart', () => {
    const main = chart.mainAccountOf({ number: 'BSP-12345-1', name: 'x', type: 'Receivables', parentNumber: '1200' });
    expect(main).toMatchObject({ number: '1200', ledger: 'guest' });
  });

  it('rolls a per-reservation account without parent up by type, preferring the guest ledger', () => {
    expect(chart.mainAccountOf({ number: 'BSP-ABCDEF-1_Liabilities', name: 'x', type: 'Liabilities' })).toMatchObject({
      number: '3000',
      ledger: 'guest',
    });
    expect(chart.mainAccountOf({ number: 'X', name: 'x', type: 'House' })).toBeUndefined();
  });

  it('stops on a parent cycle', () => {
    const cyclic = new ChartIndex([account('A', 'Revenues', 'global', 'B'), account('B', 'Revenues', 'global', 'A')]);
    expect(cyclic.mainAccountOf({ number: 'A', name: 'x', type: 'Revenues' })?.number).toBe('A');
  });
});
