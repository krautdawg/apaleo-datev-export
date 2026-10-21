import type { LedgerTax } from '../core/source.js';

/**
 * Drops tax entries with percent 0 and amount 0. The apaleo Swagger allows such
 * `Without` or `Null` entries, for example on city tax or cancellation fees; what
 * remains are the taxes the line really carries.
 */
export function normaliseTaxes(taxes: readonly LedgerTax[]): LedgerTax[] {
  return taxes.filter((tax) => tax.percent !== 0 || tax.amountCents !== 0);
}

/** The distinct percents of normalised taxes, in order of appearance. */
export function taxPercents(taxes: readonly LedgerTax[]): number[] {
  return [...new Set(taxes.map((tax) => tax.percent))];
}

export function taxTotal(taxes: readonly LedgerTax[]): number {
  return taxes.reduce((sum, tax) => sum + tax.amountCents, 0);
}

/**
 * The VAT DATEV computes from a gross amount in cents at a rate:
 * `gross × rate / (100 + rate)`, rounded half away from zero. Exact integer
 * arithmetic (rates are taken to two decimals), so no floating-point noise can
 * move a half cent. The result has the sign of `grossCents`.
 */
export function datevVat(grossCents: number, ratePercent: number): number {
  const rate = BigInt(Math.round(ratePercent * 100));
  const gross = BigInt(Math.abs(grossCents));
  const numerator = gross * rate;
  const denominator = 10_000n + rate;
  let vat = numerator / denominator;
  if (2n * (numerator - vat * denominator) >= denominator) vat += 1n;
  const cents = Number(vat);
  return grossCents < 0 && cents !== 0 ? -cents : cents;
}
