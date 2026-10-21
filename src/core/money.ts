import { REPORT_PROBLEM_HINT, UserError } from './errors.js';

/** A ledger amount may be off a whole cent by floating-point noise only: 0.0001 in currency units. */
const CENT_TOLERANCE = 0.01;

/** A ledger amount that is not a whole number of cents. */
export class SubCentAmountError extends UserError {
  override readonly name: string = 'SubCentAmountError';
}

/**
 * Converts a ledger amount sent as a floating-point number (for example `107.1`)
 * to integer cents. Fails when the amount is more than 0.0001 away from a whole
 * cent, because rounding it would silently change the booking. `what` names the
 * amount in the error, for example `source entry IHQNWLZL, grossAmount`.
 */
export function toCents(amount: number, what: string): number {
  const cents = amount * 100;
  const rounded = Math.round(cents);
  if (!Number.isFinite(cents) || Math.abs(cents - rounded) > CENT_TOLERANCE) {
    throw new SubCentAmountError(`${what}: the amount ${amount} is not a whole number of cents. ${REPORT_PROBLEM_HINT}`);
  }
  return rounded === 0 ? 0 : rounded;
}

const DECIMAL = /^([+-])?(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i;

/**
 * Converts a precise decimal string (for example `"123.4567"` or `"1e-7"`) to
 * cents, rounding half away from zero. Used only to compare precise totals, never
 * for bookings.
 */
export function decimalToCents(value: string): number {
  const match = DECIMAL.exec(value.trim());
  if (!match) throw new TypeError(`Not a decimal number: ${value}`);
  const [, sign, int = '', frac = '', exponent = '0'] = match;
  let digits = int + frac;
  let point = int.length + Number(exponent) + 2;
  if (point < 0) {
    digits = '0'.repeat(-point) + digits;
    point = 0;
  }
  const whole = Number(digits.slice(0, point).padEnd(point, '0') || '0');
  const cents = whole + ((digits[point] ?? '0') >= '5' ? 1 : 0);
  return sign === '-' && cents !== 0 ? -cents : cents;
}

/** Integer cents as a plain decimal with two places, for example `-1234` → `"-12.34"`. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
