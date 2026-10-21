import { describe, expect, it } from 'vitest';
import { ChartIndex } from '../../src/core/chart.js';
import type { AccountRef } from '../../src/core/source.js';
import { lineRate, resolve } from '../../src/mapping/index.js';
import { loadBeispielData, BSP } from '../helpers/apaleo.js';
import { ledgerLine } from '../helpers/ledger.js';
import { mappingOf, mappingRow } from '../helpers/mapping.js';

const ref = (number: string, type: string, parentNumber?: string): AccountRef => ({
  number,
  name: number,
  type,
  ...(parentNumber ? { parentNumber } : {}),
});

const mapping = mappingOf([
  mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', datevAccount: '8300' }),
  mappingRow({ apaleoAccount: '5010', apaleoType: 'Revenues', datevAccount: '8301' }),
  mappingRow({ apaleoAccount: '1200', apaleoType: 'Receivables', datevAccount: '1410' }),
  mappingRow({ apaleoAccount: '1611', apaleoType: '*any*', datevAccount: '1361' }),
  mappingRow({ apaleoAccount: '*', apaleoType: 'Receivables', datevAccount: '1411' }),
  mappingRow({ apaleoAccount: '*', apaleoType: 'Payments', datevAccount: '1360' }),
  mappingRow({ apaleoAccount: '*', apaleoType: 'Liabilities', apaleoVatPercent: '7', datevAccount: '1711' }),
  mappingRow({ apaleoAccount: '*', apaleoType: 'Liabilities', apaleoVatPercent: '19', datevAccount: '1718' }),
  mappingRow({ apaleoAccount: '*', apaleoType: 'Liabilities', apaleoVatPercent: '0', datevAccount: '1719' }),
  mappingRow({ apaleoAccount: '3501', apaleoType: 'CityTaxes' }),
]);

const datev = (account: AccountRef, rate: number | undefined = 0, chart?: ChartIndex) =>
  resolve(mapping, account, { rate, ...(chart ? { chart } : {}) })?.datevAccount;

describe('resolution order', () => {
  it('(1) takes the exact number and type first', () => {
    expect(datev(ref('5011', 'Revenues', '5010'))).toBe('8300');
  });

  it('(2) then the number with any type (Grman rows)', () => {
    expect(datev(ref('1611', 'Payments'))).toBe('1361');
  });

  it('(3) then the parent chain from the chart, with the same type', async () => {
    const chart = new ChartIndex((await loadBeispielData()).charts[BSP] ?? []);
    expect(datev(ref('5019', 'Revenues'), 19, chart)).toBe('8301');
    // The chart wins over the line: 5019's parent in the chart is 5010.
    expect(datev(ref('5019', 'Revenues', '9999'), 19, chart)).toBe('8301');
    expect(datev(ref('5019', 'Payments', '5010'))).toBe('1360');
  });

  it('resolves a per-reservation account with a parent to the parent row', () => {
    expect(datev(ref('BSP-12345-1', 'Receivables', '1200'))).toBe('1410');
  });

  it('(4) uses the rate wildcard for VAT-relevant types', () => {
    expect(datev(ref('BSP-ABCDEF-1_Liabilities', 'Liabilities'), 7)).toBe('1711');
    expect(datev(ref('BSP-ABCDEF-1_Liabilities', 'Liabilities'), 19)).toBe('1718');
    expect(datev(ref('BSP-ABCDEF-1_Liabilities', 'Liabilities'), 0)).toBe('1719');
    expect(datev(ref('BSP-ABCDEF-1_Liabilities', 'Liabilities'), 5.5)).toBeUndefined();
    expect(resolve(mapping, ref('BSP-ABCDEF-1_Liabilities', 'Liabilities'), { rate: undefined })).toBeUndefined();
  });

  it('(5) uses the plain wildcard for other types: a new payment method account', () => {
    expect(datev(ref('1613', 'Payments', '1610'))).toBe('1360');
  });

  it('never wildcards a revenue account', () => {
    expect(datev(ref('5020', 'Revenues'), 7)).toBeUndefined();
  });

  it('returns a row with an empty DATEV account as it is (unmapped)', () => {
    expect(resolve(mapping, ref('3501', 'CityTaxes'), { rate: 0 })).toMatchObject({ datevAccount: '', line: 11 });
  });

  it('stops on a parent cycle', () => {
    const chart = new ChartIndex([
      { number: 'A', name: 'A', type: 'House', parentNumber: 'B', ledger: 'global', isArchived: false, hasChildren: true },
      { number: 'B', name: 'B', type: 'House', parentNumber: 'A', ledger: 'global', isArchived: false, hasChildren: true },
    ]);
    expect(datev(ref('A', 'House'), 0, chart)).toBeUndefined();
  });
});

describe('per-reservation accounts without a parent (Swagger shape)', () => {
  it('resolves the debit to the Receivables wildcard and the credit to the 7 % Liabilities wildcard', () => {
    const line = ledgerLine({
      debit: { number: 'BSP-ABCDEF-1_Receivables', name: 'Receivables', type: 'Receivables' },
      credit: { number: 'BSP-ABCDEF-1_Liabilities', name: 'Liabilities', type: 'Liabilities' },
      taxes: [{ vatType: 'Reduced', percent: 7, amountCents: 1308 }],
    });
    const rate = lineRate(line);
    expect(rate).toBe(7);
    expect(resolve(mapping, line.debit, { rate })?.datevAccount).toBe('1411');
    expect(resolve(mapping, line.credit, { rate })?.datevAccount).toBe('1711');
  });

  it('leaves a line with two different rates unmapped on the rate wildcard', () => {
    const line = ledgerLine({
      credit: { number: 'BSP-ABCDEF-1_Liabilities', name: 'Liabilities', type: 'Liabilities' },
      taxes: [
        { vatType: 'Reduced', percent: 7, amountCents: 100 },
        { vatType: 'Normal', percent: 19, amountCents: 50 },
      ],
    });
    expect(lineRate(line)).toBeUndefined();
    expect(resolve(mapping, line.credit, { rate: lineRate(line) })).toBeUndefined();
  });
});

describe('lineRate', () => {
  it('drops tax entries with percent 0 and amount 0 and gives 0 for a line without taxes', () => {
    expect(lineRate({ taxes: [{ vatType: 'Without', percent: 0, amountCents: 0 }] })).toBe(0);
    expect(lineRate({ taxes: [] })).toBe(0);
    expect(lineRate({ taxes: [{ vatType: 'Without', percent: 0, amountCents: 0 }, { vatType: 'Normal', percent: 19, amountCents: 380 }] })).toBe(19);
    expect(lineRate({ taxes: [{ vatType: 'Reduced', percent: 7, amountCents: -65 }, { vatType: 'Reduced', percent: 7, amountCents: 10 }] })).toBe(7);
  });
});
