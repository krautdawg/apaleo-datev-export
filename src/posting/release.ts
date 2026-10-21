import type { ChartIndex } from '../core/chart.js';
import type { AccountRef, LedgerLine } from '../core/source.js';
import { VAT_ACCOUNT_TYPES, lineRate } from '../mapping/index.js';
import { datevVat, normaliseTaxes, taxPercents } from './taxes.js';

/**
 * Deposit releases without `taxes[]` (design decision 3a). The release (debit
 * Liabilities, credit Receivables) must reverse the VAT on the versteuerte-
 * Anzahlungen Automatikkonto, so it needs a rate although apaleo sent none. The
 * rate comes from the `PostPrepaymentVat` line(s) of the same business date and
 * reference that reverse the VAT apaleo booked on the deposit, else from the VAT
 * of the Liabilities account (or its parent) in the chart. Never 0 % by default.
 *
 * Other untaxed lines on a Liabilities account (a prepayment received or a
 * deposit refunded without `taxes[]`) take the rate of a matching
 * `PostPrepaymentVat` line too: when apaleo booked or reversed VAT for them,
 * booking them on the 0 % deposit row would leave the VAT open in DATEV, or
 * never declare it. Without such a line they keep rate 0 (no chart fallback).
 */

/** Where an inferred release rate comes from, or why there is none. */
export type ReleaseRate =
  | {
      kind: 'pair';
      rate: number;
      /** Entry numbers of the `PostPrepaymentVat` lines the rate was taken from. */
      pairEntries: string[];
      /** VAT apaleo reverses on the pair lines, with the sign of the release. */
      pairVatCents: number;
      /** VAT DATEV will compute on all deposit lines of the same day, reference and direction, signed like `pairVatCents`. */
      releaseVatCents: number;
      /** Entry numbers of those lines; the amount check covers them together. */
      releaseEntries: string[];
    }
  | { kind: 'chart'; rate: number; account: string }
  | { kind: 'unknown'; reason: string };

/** A line that settles a deposit against the bill without a VAT amount. */
export function isUntaxedRelease(line: LedgerLine): boolean {
  return (
    line.debit.type === 'Liabilities' &&
    line.credit.type === 'Receivables' &&
    line.grossCents !== 0 &&
    normaliseTaxes(line.taxes).length === 0
  );
}

/**
 * An untaxed line with exactly one Liabilities side and no VAT account: a
 * deposit received, released or refunded without a VAT amount. Its rate comes
 * from a matching `PostPrepaymentVat` line; only a release falls back to the chart.
 */
export function isUntaxedDepositLine(line: LedgerLine): boolean {
  const debit = line.debit.type === 'Liabilities';
  const credit = line.credit.type === 'Liabilities';
  return (
    debit !== credit &&
    !VAT_ACCOUNT_TYPES.has(line.debit.type) &&
    !VAT_ACCOUNT_TYPES.has(line.credit.type) &&
    line.grossCents !== 0 &&
    normaliseTaxes(line.taxes).length === 0
  );
}

/**
 * The sign of the VAT movement a deposit line implies, as `reversedVat` counts
 * it: +1 when it takes VAT off the deposit (Liabilities debited with a positive
 * amount, as on a release or refund), -1 when it adds VAT (a deposit received).
 */
export function depositDirection(line: LedgerLine): number {
  return Math.sign(line.grossCents) * (line.debit.type === 'Liabilities' ? 1 : -1);
}

function isPrepaymentVatLine(line: LedgerLine): boolean {
  return line.command === 'PostPrepaymentVat' && (VAT_ACCOUNT_TYPES.has(line.debit.type) || VAT_ACCOUNT_TYPES.has(line.credit.type));
}

/** VAT a `PostPrepaymentVat` line takes off the VAT account: positive when the VAT account is debited. */
function reversedVat(line: LedgerLine): number {
  return VAT_ACCOUNT_TYPES.has(line.debit.type) ? line.grossCents : -line.grossCents;
}

const groupKey = (line: LedgerLine) => `${line.businessDate}\u0000${line.reference}\u0000${depositDirection(line)}`;

/** The rates the tool knows: 7 % and 19 % plus every positive VAT rate in the chart. */
function knownRates(chart: ChartIndex | undefined): number[] {
  const rates = new Set<number>([7, 19]);
  for (const account of chart?.accounts ?? []) if (account.vat && account.vat.percent > 0) rates.add(account.vat.percent);
  return [...rates].sort((a, b) => a - b);
}

/**
 * The VAT rate of each untaxed deposit line in `lines` that needs one: every
 * release, and every other untaxed Liabilities line with a matching
 * `PostPrepaymentVat` line. Pair lines are matched by business date and
 * reference and must move VAT in the direction of the deposit line (a deposit
 * received and released on the same day books VAT both ways).
 */
export function inferReleaseRates(lines: readonly LedgerLine[], chart: ChartIndex | undefined): Map<LedgerLine, ReleaseRate> {
  const pairs = new Map<string, LedgerLine[]>();
  for (const line of lines.filter(isPrepaymentVatLine)) {
    const key = `${line.businessDate}\u0000${line.reference}\u0000${Math.sign(reversedVat(line))}`;
    pairs.set(key, [...(pairs.get(key) ?? []), line]);
  }
  const groups = new Map<string, LedgerLine[]>();
  for (const line of lines.filter(isUntaxedDepositLine)) groups.set(groupKey(line), [...(groups.get(groupKey(line)) ?? []), line]);

  const result = new Map<LedgerLine, ReleaseRate>();
  for (const [key, group] of groups) {
    const pairLines = pairs.get(key) ?? [];
    // Without a pair, only releases need a rate; the other lines keep rate 0 as before.
    const releases = pairLines.length > 0 ? group : group.filter(isUntaxedRelease);
    if (releases.length === 0) continue;
    const pairVatCents = pairLines.reduce((sum, line) => sum + reversedVat(line), 0);
    // Gross amounts signed in the direction of the VAT movement, so the amount match works for releases and receipts alike.
    const releaseGross = releases.reduce((sum, line) => sum + depositDirection(line) * Math.abs(line.grossCents), 0);
    const pairRate = pairLines.length > 0 ? rateOfPair(pairLines, releaseGross, pairVatCents, chart) : undefined;
    for (const line of releases) {
      if (pairRate?.rate !== undefined) {
        const rate = pairRate.rate;
        result.set(line, {
          kind: 'pair',
          rate,
          pairEntries: pairLines.map((pair) => pair.sourceEntryNumber),
          pairVatCents,
          releaseVatCents: releases.reduce((sum, release) => sum + depositDirection(release) * Math.abs(datevVat(release.grossCents, rate)), 0),
          releaseEntries: releases.map((release) => release.sourceEntryNumber),
        });
        continue;
      }
      const fromChart = isUntaxedRelease(line) ? chartRate(line.debit, chart) : undefined;
      if (fromChart) result.set(line, { kind: 'chart', ...fromChart });
      else result.set(line, { kind: 'unknown', reason: pairRate?.problem ?? noRateReason(line) });
    }
  }
  return result;
}

/** The single rate of the pair lines: their tax percent, else the known rate whose VAT on the releases matches theirs. */
function rateOfPair(
  pairLines: readonly LedgerLine[],
  releaseGross: number,
  pairVatCents: number,
  chart: ChartIndex | undefined,
): { rate?: number; problem?: string } {
  const entries = pairLines.map((line) => line.sourceEntryNumber).join(', ');
  const percents = taxPercents(pairLines.flatMap((line) => normaliseTaxes(line.taxes)));
  if (percents.length > 1) return { problem: `the PostPrepaymentVat lines ${entries} carry more than one rate (${percents.join(' %, ')} %)` };
  if (percents.length === 1) return { rate: percents[0] as number };
  const matching = knownRates(chart).filter((rate) => Math.abs(datevVat(releaseGross, rate) - pairVatCents) <= 1);
  if (matching.length === 1) return { rate: matching[0] as number };
  return { problem: `the PostPrepaymentVat lines ${entries} carry no rate, and their amount matches no known rate` };
}

/** The VAT rate of a Liabilities account in the chart, or of the nearest parent that has one. */
function chartRate(ref: AccountRef, chart: ChartIndex | undefined): { rate: number; account: string } | undefined {
  if (!chart) return undefined;
  const find = (number: string) => {
    const found = chart.find(number, ref.type);
    return found?.type === ref.type ? found : undefined;
  };
  let current = find(ref.number);
  let parent = current ? current.parentNumber : ref.parentNumber;
  const seen = new Set<string>([ref.number]);
  while (!current?.vat) {
    if (parent === undefined || seen.has(parent)) return undefined;
    seen.add(parent);
    current = find(parent);
    if (!current) return undefined;
    parent = current.parentNumber;
  }
  return { rate: current.vat.percent, account: current.number };
}

function noRateReason(line: LedgerLine): string {
  return (
    `there is no PostPrepaymentVat line of ${line.businessDate} for reference ${line.reference}, ` +
    `and the chart of accounts gives ${line.debit.number} no VAT rate`
  );
}

/**
 * The rate to resolve a line's mapping rows with: the inferred rate of an untaxed
 * deposit release (undefined when it cannot be inferred), else the line's own
 * normalised rate (`lineRate`: 0 without taxes, undefined for several rates).
 */
export function resolutionRate(line: LedgerLine, releases: ReadonlyMap<LedgerLine, ReleaseRate>): number | undefined {
  const release = releases.get(line);
  if (!release) return lineRate(line);
  return release.kind === 'unknown' ? undefined : release.rate;
}

/** `resolutionRate` over the releases of `lines`, to pass as `rateOf` to `checkCoverage`. */
export function releaseRateOf(lines: readonly LedgerLine[], chart: ChartIndex | undefined): (line: LedgerLine) => number | undefined {
  const releases = inferReleaseRates(lines, chart);
  return (line) => resolutionRate(line, releases);
}
