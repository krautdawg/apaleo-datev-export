import type { Finding } from '../core/findings.js';
import { ANY_TYPE, PERSONAL_ACCOUNT_TYPE, type MappingRow } from './types.js';

/**
 * DATEV account numbers have an exact length: a G/L account has exactly
 * Sachkontenlänge (L) digits, a personal account exactly L + 1.
 */

/** The allowed lengths for a row's DATEV account. A Grman row (`*any*`) can be either. */
export function allowedLengths(apaleoType: string, sachkontenlaenge: number): number[] {
  if (apaleoType === PERSONAL_ACCOUNT_TYPE) return [sachkontenlaenge + 1];
  if (apaleoType === ANY_TYPE) return [sachkontenlaenge, sachkontenlaenge + 1];
  return [sachkontenlaenge];
}

/**
 * Restores leading zeros that Excel removed, only where that is unambiguous: at
 * Sachkontenlänge 4 a G/L number with 1 to 3 digits can only be a class-0 account
 * such as `0650`. Every other number is returned unchanged (a wrong length is
 * reported by `checkMapping`, never padded).
 */
export function restoreLeadingZeros(
  account: string,
  apaleoType: string,
  sachkontenlaenge: number,
): { account: string; padded: boolean } {
  const glAccount = apaleoType !== PERSONAL_ACCOUNT_TYPE;
  if (sachkontenlaenge === 4 && glAccount && /^\d{1,3}$/.test(account)) {
    return { account: account.padStart(4, '0'), padded: true };
  }
  return { account, padded: false };
}

export function paddedFinding(row: MappingRow, original: string): Finding {
  return {
    code: 'W-PADDED',
    message:
      `line ${row.line}: DATEV account "${original}" was read as ${row.datevAccount} (leading zeros restored; ` +
      'Excel removes them unless the column is formatted as Text)',
    field: 'datev_account',
    value: original,
  };
}

/** `E-ACCOUNT-LENGTH` for a row whose DATEV account has the wrong number of digits, else undefined. */
export function accountLengthFinding(row: MappingRow, sachkontenlaenge: number): Finding | undefined {
  const lengths = allowedLengths(row.apaleoType, sachkontenlaenge);
  const account = row.datevAccount;
  if (lengths.includes(account.length)) return undefined;
  const [expected = sachkontenlaenge] = lengths;
  const what = row.apaleoType === PERSONAL_ACCOUNT_TYPE ? 'a personal account' : 'a G/L account';
  const needs = lengths.length > 1 ? `${lengths.join(' or ')} digits` : `exactly ${expected} digits as ${what}`;
  const example = account.length < expected ? ` (for example ${account.padEnd(expected, '0')})` : '';
  return {
    code: 'E-ACCOUNT-LENGTH',
    message:
      `line ${row.line}: DATEV account ${account} has ${account.length} digits, but Sachkontenlänge ` +
      `${sachkontenlaenge} needs ${needs}${example}. Excel may have removed leading zeros, or a number ` +
      `needs its trailing zeros (8300 becomes 83000 at Sachkontenlänge 5). Format the column as Text in Excel.`,
    field: 'datev_account',
    value: account,
  };
}
