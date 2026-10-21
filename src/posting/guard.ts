import { REPORT_PROBLEM_HINT } from '../core/errors.js';
import type { Finding } from '../core/findings.js';
import { formatCents } from '../core/money.js';
import type { AccountRef, LedgerLine, LedgerTax } from '../core/source.js';
import { VAT_RELEVANT_TYPES, type MappingRow } from '../mapping/index.js';
import { accountText, lineFinding, percentText, rowText } from './describe.js';
import { depositDirection, isUntaxedRelease, type ReleaseRate } from './release.js';
import { datevVat, taxPercents, taxTotal } from './taxes.js';

/** One side of a ledger line with its mapping row and the VAT rate DATEV applies on that row. */
export interface PostedSide {
  ref: AccountRef;
  row: MappingRow;
  /** The VAT rate DATEV applies on the row (0 when none). */
  rate: number;
  /** DATEV applies VAT on this side: a rate above 0 % or a BU key. */
  vat: boolean;
}

export interface GuardInput {
  line: LedgerLine;
  /** Normalised taxes with at most one percent. */
  taxes: readonly LedgerTax[];
  /** Set for an untaxed deposit release whose rate was inferred. */
  release: Extract<ReleaseRate, { kind: 'pair' | 'chart' }> | undefined;
  debit: PostedSide;
  credit: PostedSide;
  vatSide: PostedSide | undefined;
}

export interface GuardResult {
  findings: Finding[];
  /** True when a finding blocks the booking. */
  failed: boolean;
  /** DATEV's VAT minus apaleo's, signed like the line, when it is a one-cent rounding difference. */
  roundingCents: number;
}

/** The side to name in a fix: the VAT-relevant one (revenue, deposit, levy), else the credit side. */
function sideToFix({ debit, credit }: Pick<GuardInput, 'debit' | 'credit'>): PostedSide {
  return VAT_RELEVANT_TYPES.has(debit.ref.type) && !VAT_RELEVANT_TYPES.has(credit.ref.type) ? debit : credit;
}

function sideText(side: PostedSide): string {
  return `${accountText(side.ref)} on ${rowText(side.row)}`;
}

/**
 * The VAT consistency guard (design decision 3): the rate DATEV applies must be
 * apaleo's rate, DATEV's VAT computed from the gross amount must be apaleo's VAT
 * within one cent (compared as magnitudes), and the VAT must have the sign of the
 * gross amount. An untaxed deposit release is checked against its inferred rate
 * and, when a `PostPrepaymentVat` pair exists, against the VAT reversed there.
 */
export function guardVat(input: GuardInput): GuardResult {
  const { line, taxes, release, vatSide } = input;
  const result: GuardResult = { findings: [], failed: false, roundingCents: 0 };
  const fail = (code: string, message: string) => {
    result.findings.push(lineFinding(code, line, message));
    result.failed = true;
    return result;
  };
  const taxed = taxes.length > 0;
  const expected = taxed ? (taxPercents(taxes)[0] as number) : (release?.rate ?? 0);
  const source = rateSource(release);
  // A chart rate is never checked against an amount, 0 % included: always warn when the line is booked.
  const inferred = () => {
    if (release?.kind !== 'chart') return result;
    result.findings.push(
      lineFinding(
        'W-VAT-INFERRED',
        line,
        `it settles a deposit without a VAT amount; the tool books it at ${percentText(release.rate)}, the VAT rate of account ` +
          `${release.account} in the apaleo chart of accounts, with no PostPrepaymentVat line to check the amount against` +
          `${release.rate === 0 ? ', so DATEV computes no VAT on the release' : ''}. ` +
          'Have your Steuerberater check the deposit bookings',
      ),
    );
    return result;
  };

  if (!vatSide) {
    if (!taxed && expected === 0) return inferred();
    const fix = sideToFix(input);
    const what = taxed
      ? `carries ${formatCents(taxTotal(taxes))} VAT at ${percentText(expected)}`
      : `${isUntaxedRelease(line) ? 'settles' : 'books'} a deposit taxed at ${percentText(expected)}${source}`;
    return fail(
      'E-VAT-MISSING',
      `it ${what}, but DATEV computes no VAT on either side (debit on ${rowText(input.debit.row)}, credit on ${rowText(input.credit.row)}). ` +
        `Change the row for ${sideText(fix)} to a DATEV account that applies ${percentText(expected)}`,
    );
  }
  if (!taxed && !release && vatSide.rate > 0) {
    return fail(
      'E-VAT-UNEXPECTED',
      `apaleo charged no VAT on it, but DATEV will compute ${percentText(vatSide.rate)} on ${sideText(vatSide)}. ` +
        'Change that row to a DATEV account without VAT, or check the VAT setting of the account in apaleo',
    );
  }
  if (vatSide.rate !== expected) {
    return fail(
      'E-VAT-RATE',
      `apaleo taxed it at ${percentText(expected)}${source}, but DATEV will apply ${percentText(vatSide.rate)} on ${sideText(vatSide)}. ` +
        `Change that row to a DATEV account for ${percentText(expected)} (a period taxed at other rates, such as food at 19 % before 2026, needs its own mapping)`,
    );
  }

  if (taxed) {
    const apaleoVat = taxTotal(taxes);
    if (apaleoVat !== 0 && Math.sign(apaleoVat) !== Math.sign(line.grossCents)) {
      return fail('E-VAT-SIGN', `the VAT ${formatCents(apaleoVat)} and the gross amount have opposite signs. ${REPORT_PROBLEM_HINT}`);
    }
    const computed = Math.abs(datevVat(line.grossCents, expected));
    return compareAmounts(result, line, computed - Math.abs(apaleoVat), () =>
      `DATEV will compute ${formatCents(computed)} VAT at ${percentText(expected)} on ${formatCents(Math.abs(line.grossCents))}, but apaleo charged ${formatCents(Math.abs(apaleoVat))}`,
    );
  }
  if (release?.kind === 'pair') {
    // One check for all releases of the day and reference; the rounding difference is counted on the first one only.
    const first = release.releaseEntries[0] === line.sourceEntryNumber;
    const difference = release.releaseVatCents - release.pairVatCents;
    const entries = release.releaseEntries.length > 1 ? ` (together with ${release.releaseEntries.filter((e) => e !== line.sourceEntryNumber).join(', ')})` : '';
    if (Math.abs(difference) <= 1 && !first) return result;
    const reversed = depositDirection(line) > 0;
    // `difference` is signed in the direction of the VAT movement; as magnitudes it is that direction times the difference.
    return compareAmounts(result, line, depositDirection(line) * difference, () =>
      `DATEV will compute ${formatCents(Math.abs(release.releaseVatCents))} VAT on the deposit ${isUntaxedRelease(line) ? 'release' : 'line'}${entries}, ` +
        `but apaleo ${reversed ? 'reversed' : 'booked'} ${formatCents(Math.abs(release.pairVatCents))} on the PostPrepaymentVat line ${release.pairEntries.join(', ')}`,
    );
  }
  return inferred();
}

/** Where an inferred release rate comes from, for messages; empty for a taxed line. */
function rateSource(release: GuardInput['release']): string {
  if (release?.kind === 'pair') return ` (inferred from the PostPrepaymentVat line ${release.pairEntries.join(', ')})`;
  return release ? ` (inferred from the chart of accounts, account ${release.account})` : '';
}

/** `difference` is DATEV's VAT minus apaleo's, as magnitudes. */
function compareAmounts(result: GuardResult, line: LedgerLine, difference: number, describe: () => string): GuardResult {
  if (difference === 0) return result;
  if (Math.abs(difference) === 1) {
    result.roundingCents += Math.sign(line.grossCents) * difference;
    result.findings.push(
      lineFinding('W-VAT-ROUNDING', line, `${describe()}: a rounding difference of 0.01, added to the rounding total of the summary`),
    );
    return result;
  }
  result.findings.push(lineFinding('E-VAT-AMOUNT', line, `${describe()} (difference ${formatCents(difference)}). ${REPORT_PROBLEM_HINT}`));
  result.failed = true;
  return result;
}
