import { describe, expect, it } from 'vitest';
import {
  SubCentAmountError,
  compareDecimals,
  decimalToCents,
  formatCents,
  negateDecimal,
  normaliseDecimal,
  sumDecimals,
  toCents,
} from '../../src/core/money.js';

describe('toCents', () => {
  it('converts a gross amount of 107.1 to 10710 cents', () => {
    expect(toCents(107.1, 'grossAmount')).toBe(10710);
  });

  it.each([
    [0.1 + 0.2, 30],
    [19.99, 1999],
    [-0.65, -65],
    [1234567.89, 123456789],
    [0, 0],
    [-0.0, 0],
  ])('converts %d without floating-point noise', (amount, cents) => {
    expect(Object.is(toCents(amount, 'x'), cents)).toBe(true);
  });

  it('accepts noise up to 0.0001 and rejects anything further from a whole cent', () => {
    expect(toCents(10.00009, 'x')).toBe(1000);
    expect(() => toCents(10.0002, 'x')).toThrow(SubCentAmountError);
  });

  it('fails on 10.005 and names what was converted', () => {
    expect(() => toCents(10.005, 'source entry IHQNWLZL, grossAmount')).toThrow(
      'source entry IHQNWLZL, grossAmount: the amount 10.005 is not a whole number of cents. ' +
        'This cannot be fixed in apaleo or in your config. Please open an issue at ' +
        'https://github.com/krautdawg/apaleo-datev-export/issues and paste this message, but leave out guest names.',
    );
  });

  it('rejects non-finite amounts', () => {
    expect(() => toCents(Number.NaN, 'x')).toThrow(SubCentAmountError);
    expect(() => toCents(Number.POSITIVE_INFINITY, 'x')).toThrow(SubCentAmountError);
  });
});

describe('decimalToCents', () => {
  it.each([
    ['123.4567', 12346],
    ['123.4549', 12345],
    ['0.005', 1],
    ['-0.005', -1],
    ['-0.004', 0],
    ['100', 10000],
    ['214.0004', 21400],
    ['1e-7', 0],
    ['1.5e2', 15000],
    ['-2.5E-1', -25],
  ])('rounds %s half away from zero to %d cents', (value, cents) => {
    expect(Object.is(decimalToCents(value), cents)).toBe(true);
  });

  it('rejects text that is not a decimal number', () => {
    expect(() => decimalToCents('12,50')).toThrow(TypeError);
  });
});

describe('formatCents', () => {
  it.each([
    [25380, '253.80'],
    [-1234, '-12.34'],
    [5, '0.05'],
    [0, '0.00'],
  ])('formats %d as %s', (cents, text) => {
    expect(formatCents(cents)).toBe(text);
  });
});

describe('exact decimals', () => {
  /** apaleo's precise taxes of the eight 7 % revenue lines of the recorded BER day 2026-10-21. */
  const BER_REVENUE_TAXES_7 = ['7.45794393', '-0.65420561', '8.11214953', '7.45925234', '5.4953271', '2.51214953', '3.06168224', '3.92523364'];

  it('adds the eight 7 % taxes of the BER day exactly: 37.3695327, which rounds to 37.37', () => {
    const precise = sumDecimals(BER_REVENUE_TAXES_7);
    expect(precise).toBe('37.3695327');
    expect(decimalToCents(precise)).toBe(3737);
    // The same taxes rounded per line add up to one cent more.
    expect(BER_REVENUE_TAXES_7.reduce((sum, tax) => sum + decimalToCents(tax), 0)).toBe(3738);
  });

  it('is exact where floating-point addition is not', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumDecimals(['0.1', '0.2'])).toBe('0.3');
    expect(sumDecimals(['14.9', '-12.5210084', '-2.3789916'])).toBe('0');
  });

  it.each([
    ['1e-7', '0.0000001'],
    ['-2e-08', '-0.00000002'],
    ['12.50', '12.5'],
    ['114', '114'],
    ['-0.0', '0'],
    ['1.5e2', '150'],
  ])('writes %s plainly as %s', (value, text) => {
    expect(normaliseDecimal(value)).toBe(text);
  });

  it('sums nothing to 0, negates and compares', () => {
    expect(sumDecimals([])).toBe('0');
    expect(negateDecimal('-0.65420561')).toBe('0.65420561');
    expect(negateDecimal('0')).toBe('0');
    expect(compareDecimals('0.005', '0.00500000')).toBe(0);
    expect(compareDecimals('0.0050001', '0.005')).toBe(1);
    expect(compareDecimals('-1', '0.5')).toBe(-1);
  });
});
