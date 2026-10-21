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

/**
 * Exact arithmetic on precise decimal text (apaleo sends net and tax amounts
 * with up to eight decimals). Values are scaled integers internally, never
 * floating-point numbers, so a sum of many precise amounts is exact.
 */
interface Scaled {
  /** The value is `units / 10^scale`. */
  units: bigint;
  scale: number;
}

function toScaled(value: string): Scaled {
  const match = DECIMAL.exec(value.trim());
  if (!match) throw new TypeError(`Not a decimal number: ${value}`);
  const [, sign, int = '', frac = '', exponent = '0'] = match;
  const scale = frac.length - Number(exponent);
  const digits = BigInt(int + frac || '0');
  const units = scale < 0 ? digits * 10n ** BigInt(-scale) : digits;
  return { units: sign === '-' ? -units : units, scale: Math.max(scale, 0) };
}

function rescale({ units, scale }: Scaled, to: number): bigint {
  return units * 10n ** BigInt(to - scale);
}

/** Plain decimal text without exponent or trailing zeros, for example `"-0.65420561"` or `"114"`. */
function fromScaled({ units, scale }: Scaled): string {
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  const int = digits.slice(0, digits.length - scale);
  const frac = digits.slice(digits.length - scale).replace(/0+$/, '');
  const text = frac === '' ? int : `${int}.${frac}`;
  return units < 0n ? `-${text}` : text;
}

/** The same decimal written plainly: `"1e-7"` → `"0.0000001"`, `"12.50"` → `"12.5"`. */
export function normaliseDecimal(value: string): string {
  return fromScaled(toScaled(value));
}

/** The exact sum of precise decimals, as plain decimal text (`"0"` for none). */
export function sumDecimals(values: readonly string[]): string {
  const scaled = values.map(toScaled);
  const scale = Math.max(0, ...scaled.map((s) => s.scale));
  return fromScaled({ units: scaled.reduce((sum, s) => sum + rescale(s, scale), 0n), scale });
}

export function negateDecimal(value: string): string {
  const { units, scale } = toScaled(value);
  return fromScaled({ units: -units, scale });
}

/** -1, 0 or 1 as `a` is less than, equal to or greater than `b`. */
export function compareDecimals(a: string, b: string): number {
  const [x, y] = [toScaled(a), toScaled(b)];
  const scale = Math.max(x.scale, y.scale);
  const difference = rescale(x, scale) - rescale(y, scale);
  return difference === 0n ? 0 : difference < 0n ? -1 : 1;
}

/** Integer cents as a plain decimal with two places, for example `-1234` → `"-12.34"`. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
