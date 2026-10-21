import type { ChartIndex } from '../core/chart.js';
import { REPORT_PROBLEM_HINT } from '../core/errors.js';
import type { Finding } from '../core/findings.js';
import type { AccountRef, LedgerLine } from '../core/source.js';
import { VAT_ACCOUNT_TYPES, checkCoverage, datevVatRate, resolve, type Mapping, type MappingRow } from '../mapping/index.js';
import { apaleoVatOf, type ApaleoVat } from './apaleo-vat.js';
import { lineFinding, percentText, rowText } from './describe.js';
import { belegfeld1, buchungstext, costCentres } from './fields.js';
import { guardVat, type PostedSide } from './guard.js';
import { inferReleaseRates, isUntaxedRelease, resolutionRate, type ReleaseRate } from './release.js';
import { SummaryBuilder } from './summary.js';
import { normaliseTaxes, taxPercents } from './taxes.js';
import type { PostedBooking, PostingOptions, PostingResult, SkipReason, SkippedLine } from './types.js';

type LineOutcome =
  | { kind: 'skip'; reason: SkipReason }
  | { kind: 'unmapped' }
  | { kind: 'failed'; findings: Finding[] }
  | {
      kind: 'booked';
      booking: PostedBooking;
      debit: PostedSide;
      credit: PostedSide;
      findings: Finding[];
      roundingCents: number;
      /** The VAT rate of the booking (0 without VAT). */
      rate: number;
      apaleoVat: ApaleoVat[];
    };

interface PostingContext {
  mapping: Mapping;
  chart: ChartIndex;
  options: PostingOptions;
  releases: ReadonlyMap<LedgerLine, ReleaseRate>;
}

/**
 * Turns ledger lines into DATEV bookings, one booking per line (no aggregation).
 * Pure and deterministic: the same lines and mapping always give the same result.
 * Every line is either booked, listed in `skipped` with its reason, or named in
 * an `E-` finding that blocks the export. Unmapped accounts are reported once
 * per account (`E-UNMAPPED`, as in `mapping check --from --to`).
 */
export function buildBookings(lines: readonly LedgerLine[], mapping: Mapping, chart: ChartIndex, options: PostingOptions): PostingResult {
  const releases = inferReleaseRates(lines, chart);
  const context: PostingContext = { mapping, chart, options, releases };
  const rateOf = (line: LedgerLine) => resolutionRate(line, releases);
  const findings: Finding[] = checkCoverage(mapping, lines, chart, {
    rateOf,
    sachkontenlaenge: options.sachkontenlaenge,
    skr: options.skr,
  }).filter((finding) => finding.code === 'E-UNMAPPED');
  const bookings: PostedBooking[] = [];
  const skipped: SkippedLine[] = [];
  const summary = new SummaryBuilder();
  const vatRoundingByRate = new Map<number, number>();

  for (const line of lines) {
    const outcome = postLine(line, context);
    if (outcome.kind === 'skip') {
      skipped.push({ reason: outcome.reason, line });
      summary.addSkipped(outcome.reason, line);
    } else if (outcome.kind === 'failed') {
      findings.push(...outcome.findings);
    } else if (outcome.kind === 'booked') {
      bookings.push(outcome.booking);
      findings.push(...outcome.findings);
      summary.addBooking(line, outcome.booking, outcome.debit, outcome.credit, outcome.roundingCents, outcome.apaleoVat);
      const roundings = outcome.findings.filter((finding) => finding.code === 'W-VAT-ROUNDING').length;
      if (roundings > 0) vatRoundingByRate.set(outcome.rate, (vatRoundingByRate.get(outcome.rate) ?? 0) + roundings);
    }
  }
  return { bookings, skipped, findings, summary: summary.build(findings), vatRoundingByRate };
}

function postLine(line: LedgerLine, context: PostingContext): LineOutcome {
  const fail = (code: string, message: string): LineOutcome => ({ kind: 'failed', findings: [lineFinding(code, line, message)] });
  if (VAT_ACCOUNT_TYPES.has(line.debit.type) || VAT_ACCOUNT_TYPES.has(line.credit.type)) {
    return { kind: 'skip', reason: 'VAT_ACCOUNT_LINE' };
  }
  if (line.grossCents === 0) return { kind: 'skip', reason: 'ZERO_AMOUNT' };

  const taxes = normaliseTaxes(line.taxes);
  const percents = taxPercents(taxes);
  if (percents.length > 1) {
    return fail(
      'E-VAT-MIXED',
      `it carries more than one VAT rate (${percents.map(percentText).join(', ')}), but a DATEV booking has one. ${REPORT_PROBLEM_HINT}`,
    );
  }
  const release = context.releases.get(line);
  if (release?.kind === 'unknown') {
    return fail(
      'E-VAT-RATE-UNKNOWN',
      `it ${isUntaxedRelease(line) ? 'settles' : 'books'} a guest's deposit without a VAT amount, and its VAT rate cannot be found: ${release.reason}. ` +
        `The export stops rather than book the deposit without VAT. ${REPORT_PROBLEM_HINT}`,
    );
  }

  const rate = resolutionRate(line, context.releases);
  const debitRow = mappedRow(line.debit, rate, context);
  const creditRow = mappedRow(line.credit, rate, context);
  // checkCoverage resolves with the same rate and reports the account once as E-UNMAPPED.
  if (!debitRow || !creditRow) return { kind: 'unmapped' };
  if (debitRow.datevAccount === creditRow.datevAccount) return { kind: 'skip', reason: 'SAME_ACCOUNT' };

  const d = postedSide(line.debit, debitRow, context);
  const c = postedSide(line.credit, creditRow, context);
  if (!d || !c) {
    const row = d ? creditRow : debitRow;
    return fail(
      'E-DATEV-RATE-UNKNOWN',
      `the VAT rate DATEV applies on ${rowText(row)} is unknown (BU key "${row.buKey}", datev_vat_percent "${row.datevVatPercent}"). ` +
        'Fill in datev_vat_percent on that line with the rate DATEV books, and run "apaleo-datev mapping check"',
    );
  }
  if (d.vat && c.vat) {
    return fail(
      'E-TWO-VAT-SIDES',
      `DATEV would apply VAT on both accounts (debit ${d.ref.number} on ${rowText(d.row)} at ${percentText(d.rate)}, ` +
        `credit ${c.ref.number} on ${rowText(c.row)} at ${percentText(c.rate)}), but a booking can carry VAT on one side only. ` +
        'Ask your Steuerberater how to book such moves, for example through a transit account',
    );
  }
  const vatSide = d.vat ? d : c.vat ? c : undefined;
  const guard = guardVat({ line, taxes, release, debit: d, credit: c, vatSide });
  if (guard.failed) return { kind: 'failed', findings: guard.findings };
  const booking = toBooking(line, d, c, vatSide, context);
  return {
    kind: 'booked',
    booking,
    debit: d,
    credit: c,
    findings: guard.findings,
    roundingCents: guard.roundingCents,
    rate: vatSide?.rate ?? 0,
    apaleoVat: apaleoVatOf(line, release),
  };
}

/** The row for one side, or undefined when it is missing or has no DATEV account (reported as `E-UNMAPPED`). */
function mappedRow(account: AccountRef, rate: number | undefined, { mapping, chart }: PostingContext): MappingRow | undefined {
  const row = resolve(mapping, account, { rate, chart });
  return row && row.datevAccount !== '' ? row : undefined;
}

/** The side with the VAT rate DATEV applies on its row, or undefined when that rate cannot be known. */
function postedSide(ref: AccountRef, row: MappingRow, { options }: PostingContext): PostedSide | undefined {
  const rate = datevVatRate(row, options.sachkontenlaenge, options.skr);
  return rate === undefined ? undefined : { ref, row, rate, vat: rate > 0 || row.buKey !== '' };
}

/**
 * Direction rule (design decision 2): the VAT side goes into Gegenkonto, where
 * DATEV applies the BU key or Automatik; without one, Konto is the debited
 * account. The side is `S` when Konto is the debited account; a negative gross
 * amount books its absolute value with the side flipped.
 */
function toBooking(
  line: LedgerLine,
  debit: PostedSide,
  credit: PostedSide,
  vatSide: PostedSide | undefined,
  { chart, options }: PostingContext,
): PostedBooking {
  const [konto, gegenkonto] = vatSide === debit ? [credit, debit] : [debit, credit];
  const kontoDebited = konto === debit;
  const side = kontoDebited === line.grossCents > 0 ? 'S' : 'H';
  const labelled = vatSide ?? credit;
  return {
    amountCents: Math.abs(line.grossCents),
    side,
    konto: konto.row.datevAccount,
    gegenkonto: gegenkonto.row.datevAccount,
    ...(vatSide && vatSide.row.buKey !== '' ? { buKey: vatSide.row.buKey } : {}),
    belegdatum: line.businessDate,
    belegfeld1: belegfeld1(line, options.belegfeld1),
    buchungstext: buchungstext(line, labelled.ref, chart, vatSide?.rate ?? 0),
    ...costCentres([...(vatSide ? [vatSide.row] : []), konto.row, gegenkonto.row]),
    sourceEntryNumbers: [line.sourceEntryNumber],
  };
}
