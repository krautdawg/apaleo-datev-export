import { isLocalDate } from '../core/date.js';
import type { Finding } from '../core/findings.js';
import { formatAmount } from './format.js';
import { labelOf } from './labels.js';
import type { ExtfBooking, ExtfHeader } from './types.js';

/** 9,999,999,999.99 EUR, the largest Umsatz DATEV accepts (`\d{1,10},\d{2}`). */
export const MAX_AMOUNT_CENTS = 999_999_999_999;

const DIGITS = /^\d+$/;
const BU_KEY = /^\d{1,4}$/;

/**
 * Every error in the bookings at once. Assumes a valid header; the caller checks
 * the header first. Account numbers are never padded: 1360 is not 01360.
 *
 * Messages are written for the hotel back office and name fields as DATEV does
 * (Umsatz, Konto, Belegdatum). A negative amount is a bug in the caller, which
 * must flip `side` instead; the message only tells the user what is allowed.
 */
export function validateBookings(header: ExtfHeader, bookings: readonly ExtfBooking[]): Finding[] {
  return bookings.flatMap((booking, index) => validateBooking(header, booking, index));
}

function validateBooking(header: ExtfHeader, b: ExtfBooking, index: number): Finding[] {
  const findings: Finding[] = [];
  const error = (code: string, field: string, value: unknown, message: string) =>
    findings.push({ code, index, field, label: labelOf(field), value: String(value), message });

  if (!Number.isInteger(b.amountCents) || b.amountCents < 1 || b.amountCents > MAX_AMOUNT_CENTS) {
    error(
      'E-EXTF-AMOUNT',
      'amountCents',
      b.amountCents,
      `Umsatz must be between 0,01 and 9.999.999.999,99 EUR, got ${describeAmount(b.amountCents)}`,
    );
  }
  if (b.side !== 'S' && b.side !== 'H') {
    error('E-EXTF-SIDE', 'side', b.side, `Soll/Haben-Kennzeichen must be "S" or "H", got "${String(b.side)}"`);
  }
  for (const field of ['konto', 'gegenkonto'] as const) {
    const problem = accountProblem(b[field], header.sachkontenlaenge);
    if (problem) error('E-EXTF-ACCOUNT', field, b[field], `${labelOf(field)} "${b[field]}" ${problem}`);
  }
  if (b.konto === b.gegenkonto) {
    error('E-EXTF-SAME-ACCOUNT', 'gegenkonto', b.gegenkonto, `Konto and Gegenkonto are both ${b.konto}; they must differ`);
  }
  if (b.buKey !== undefined && b.buKey !== '' && !BU_KEY.test(b.buKey)) {
    error('E-EXTF-BU-KEY', 'buKey', b.buKey, `BU-Schlüssel must be one to four digits, got "${b.buKey}"`);
  }
  if (!isLocalDate(b.belegdatum)) {
    error('E-EXTF-BELEGDATUM', 'belegdatum', b.belegdatum, `Belegdatum must be a valid date written YYYY-MM-DD, got "${b.belegdatum}"`);
  } else if (b.belegdatum < header.datumVom || b.belegdatum > header.datumBis) {
    error(
      'E-EXTF-BELEGDATUM',
      'belegdatum',
      b.belegdatum,
      `Belegdatum ${b.belegdatum} is outside the batch period ${header.datumVom} to ${header.datumBis}`,
    );
  }
  return findings;
}

/** Whole cents as euros (`-500` → `-5,00 EUR`); anything else as given. */
function describeAmount(cents: number): string {
  if (!Number.isInteger(cents)) return String(cents);
  return `${cents < 0 ? '-' : ''}${formatAmount(Math.abs(cents))} EUR`;
}

/** Why an account number is invalid, or undefined if it is fine. */
function accountProblem(account: string, sachkontenlaenge: number): string | undefined {
  const lengths = `must have exactly ${sachkontenlaenge} digits (G/L account) or ${sachkontenlaenge + 1} digits (personal account)`;
  if (!DIGITS.test(account)) return `must contain digits only and ${lengths}`;
  if (/^0+$/.test(account)) return 'must not be zero';
  if (account.length !== sachkontenlaenge && account.length !== sachkontenlaenge + 1) {
    return `${lengths}; account numbers are never padded`;
  }
  return undefined;
}
