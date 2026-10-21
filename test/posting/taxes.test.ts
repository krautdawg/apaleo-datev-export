import { describe, expect, it } from 'vitest';
import { datevVat, normaliseTaxes } from '../../src/posting/index.js';

describe('normaliseTaxes', () => {
  it('drops entries with percent 0 and amount 0 and keeps every other entry', () => {
    const without = { vatType: 'Without', percent: 0, amountCents: 0 };
    const reduced = { vatType: 'Reduced', percent: 7, amountCents: 654 };
    const oddZero = { vatType: 'Without', percent: 0, amountCents: 12 };
    expect(normaliseTaxes([without])).toEqual([]);
    expect(normaliseTaxes([without, reduced, oddZero])).toEqual([reduced, oddZero]);
    expect(normaliseTaxes([{ vatType: 'Reduced', percent: 7, amountCents: 0 }])).toHaveLength(1);
  });
});

describe('datevVat', () => {
  it.each([
    // gross × rate / (100 + rate), rounded half away from zero
    [10_000, 7, 654], // 700000 / 107 = 6542.06… → 654.2 → 6.54
    [1_200, 7, 79], // 8400 / 107 = 78.50… → 0.79
    [300, 19, 48], // 5700 / 119 = 47.89… → 0.48
    [2_380, 19, 380], // 45220 / 119 = 380 exactly
    [20_000, 7, 1_308], // 140000 / 107 = 1308.41… → 13.08
    [15_000, 7, 981], // 105000 / 107 = 981.30… → 9.81
    [-1_000, 7, -65], // 7000 / 107 = 65.42… → −0.65, sign of the gross amount
    [500, 0, 0],
    [107, 7, 7], // exactly 7.00 cents
    [15, 7, 1], // 105 / 107 = 0.98… → 1
    [7_490, 7, 490], // 52430 / 107 = 490 exactly
    [1_605, 7, 105], // 11235 / 107 = 105 exactly
    [3_745, 7, 245], // 26215 / 107 = 245 exactly
    [-1_605, 7, -105],
  ])('VAT on %i cents at %i %% is %i cents', (gross, rate, vat) => {
    expect(datevVat(gross, rate)).toBe(vat);
  });

  it('rounds an exact half cent away from zero, without floating-point noise', () => {
    // 1 cent at 100 %: 1 × 100 / 200 = 0.5 → 1; 3 cents: 1.5 → 2; and the negative amounts away from zero.
    expect(datevVat(1, 100)).toBe(1);
    expect(datevVat(3, 100)).toBe(2);
    expect(datevVat(-1, 100)).toBe(-1);
    expect(datevVat(-3, 100)).toBe(-2);
    // Rates with decimals: 235 cents at 17.5 % = 35 exactly; 1 cent at 50 % = 0.33… → 0.
    expect(datevVat(1, 50)).toBe(0);
    expect(datevVat(235, 17.5)).toBe(35);
  });
});
