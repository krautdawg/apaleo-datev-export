import { compareAggregates, type DebitCredit } from '../core/aggregates.js';
import type { ChartIndex } from '../core/chart.js';
import { eachDay, nextDay, type LocalDate } from '../core/date.js';
import { REPORT_PROBLEM_HINT } from '../core/errors.js';
import type { Finding } from '../core/findings.js';
import { formatCents } from '../core/money.js';
import type { LedgerLine, SourceAdapter } from '../core/source.js';
import { VAT_RELEVANT_TYPES, datevVatRate, impliedVatRate, resolve, type Mapping, type Skr } from '../mapping/index.js';
import { datevVat, inferReleaseRates, normaliseTaxes, resolutionRate, type PostingResult } from '../posting/index.js';
import type { DateRange } from './period.js';

/**
 * Plausibility checks on a posting result before its file is written (design
 * decision 4). They re-derive what the bookings must add up to from the apaleo
 * lines, so a defect in the posting rules cannot reach DATEV unnoticed.
 */

export interface CheckOptions {
  mapping: Mapping;
  chart: ChartIndex;
  sachkontenlaenge: number;
  skr: Skr;
}

/** Adds `cents` to the entry for `key`. */
function add<K>(map: Map<K, number>, key: K, cents: number): void {
  map.set(key, (map.get(key) ?? 0) + cents);
}

const absoluteGross = (lines: readonly LedgerLine[]) => lines.reduce((sum, line) => sum + Math.abs(line.grossCents), 0);

/** Every ledger line is booked or skipped, by count and by absolute gross amount (`E-CONSERVATION`). */
export function checkConservation(lines: readonly LedgerLine[], result: PostingResult): Finding[] {
  const ledger = absoluteGross(lines);
  const booked = result.bookings.reduce((sum, booking) => sum + booking.amountCents, 0);
  const skipped = absoluteGross(result.skipped.map((entry) => entry.line));
  const count = result.bookings.length + result.skipped.length;
  if (ledger === booked + skipped && lines.length === count) return [];
  return [
    {
      code: 'E-CONSERVATION',
      message:
        `the ${lines.length} apaleo lines move ${formatCents(ledger)} (absolute gross), but the ${result.bookings.length} bookings ` +
        `move ${formatCents(booked)} and the ${result.skipped.length} skipped lines ${formatCents(skipped)}, ` +
        `so ${formatCents(ledger - booked - skipped)} would be lost or doubled. ${REPORT_PROBLEM_HINT}`,
    },
  ];
}

const dayKey = (day: LocalDate, account: string) => `${day} ${account}`;

/**
 * Per business day and DATEV account, the signed movement in the bookings (Soll
 * positive) equals the signed movement of the booked apaleo lines mapped to that
 * account (debit positive, credit negative, as signed as the gross amount).
 * Catches side, sign and account bugs (`E-ACCOUNT-BALANCE`).
 */
export function checkAccountMovements(lines: readonly LedgerLine[], result: PostingResult, { mapping, chart }: CheckOptions): Finding[] {
  const skipped = new Set(result.skipped.map((entry) => entry.line));
  const releases = inferReleaseRates(lines, chart);
  const expected = new Map<string, number>();
  for (const line of lines) {
    if (skipped.has(line)) continue;
    const rate = resolutionRate(line, releases);
    const debit = resolve(mapping, line.debit, { rate, chart })?.datevAccount;
    const credit = resolve(mapping, line.credit, { rate, chart })?.datevAccount;
    // An unmapped side is reported by the coverage check.
    if (!debit || !credit) continue;
    add(expected, dayKey(line.businessDate, debit), line.grossCents);
    add(expected, dayKey(line.businessDate, credit), -line.grossCents);
  }
  const actual = new Map<string, number>();
  for (const booking of result.bookings) {
    const soll = booking.side === 'S' ? booking.amountCents : -booking.amountCents;
    add(actual, dayKey(booking.belegdatum, booking.konto), soll);
    add(actual, dayKey(booking.belegdatum, booking.gegenkonto), -soll);
  }
  const keys = [...new Set([...expected.keys(), ...actual.keys()])].sort();
  return keys.flatMap((key) => {
    const [day = '', account = ''] = key.split(' ');
    const want = expected.get(key) ?? 0;
    const got = actual.get(key) ?? 0;
    if (want === got) return [];
    return [
      {
        code: 'E-ACCOUNT-BALANCE',
        message:
          `on ${day} DATEV account ${account} moves ${formatCents(got)} in the bookings, but the apaleo lines mapped to it ` +
          `move ${formatCents(want)} (Soll positive, Haben negative). ${REPORT_PROBLEM_HINT}`,
        value: account,
      },
    ];
  });
}

/**
 * +1 when the line credits its VAT-relevant account (revenue, deposit received),
 * -1 when it debits it (deposit released or refunded): VAT owed goes up or down.
 */
function vatDirection(line: LedgerLine): number {
  const debit = VAT_RELEVANT_TYPES.has(line.debit.type);
  const credit = VAT_RELEVANT_TYPES.has(line.credit.type);
  return debit && !credit ? -1 : 1;
}

/** VAT owed per rate in apaleo: the taxes of the booked lines, and for untaxed deposit lines the VAT apaleo moved for them. */
function apaleoVatByRate(lines: readonly LedgerLine[], result: PostingResult, chart: ChartIndex): Map<number, number> {
  const skipped = new Set(result.skipped.map((entry) => entry.line));
  const releases = inferReleaseRates(lines, chart);
  const pairsCounted = new Set<string>();
  const vat = new Map<number, number>();
  for (const line of lines) {
    if (skipped.has(line)) continue;
    const taxes = normaliseTaxes(line.taxes);
    for (const tax of taxes) add(vat, tax.percent, vatDirection(line) * tax.amountCents);
    const release = taxes.length === 0 ? releases.get(line) : undefined;
    if (release?.kind === 'pair') {
      // One amount for all deposit lines of the pair; pairVatCents counts VAT taken off as positive.
      const key = `${line.businessDate} ${line.reference} ${release.pairEntries.join(' ')}`;
      if (!pairsCounted.has(key)) add(vat, release.rate, -release.pairVatCents);
      pairsCounted.add(key);
    } else if (release?.kind === 'chart') {
      add(vat, release.rate, vatDirection(line) * datevVat(line.grossCents, release.rate));
    }
  }
  return vat;
}

/** VAT owed per rate as DATEV will compute it from the bookings: Automatikkonten, BU keys and the mapping's DATEV rates. */
function datevVatByRate(result: PostingResult, { mapping, sachkontenlaenge, skr }: CheckOptions): Map<number, number> {
  const rowRates = new Map<string, Set<number | undefined>>();
  for (const row of mapping.rows) {
    if (row.datevAccount === '') continue;
    const key = `${row.datevAccount} ${row.buKey}`;
    rowRates.set(key, (rowRates.get(key) ?? new Set()).add(datevVatRate(row, sachkontenlaenge, skr)));
  }
  const rateOf = (datevAccount: string, buKey: string): number => {
    const implied = impliedVatRate({ datevAccount, buKey }, sachkontenlaenge, skr);
    if (implied) return implied.rate;
    const rates = [...(rowRates.get(`${datevAccount} ${buKey}`) ?? [])];
    return rates.length === 1 ? (rates[0] ?? 0) : 0;
  };
  const vat = new Map<number, number>();
  for (const booking of result.bookings) {
    // Soll on Konto means Haben on Gegenkonto: VAT on a credited account is owed (+).
    const gegenkontoCredited = booking.side === 'S' ? 1 : -1;
    const onGegenkonto = rateOf(booking.gegenkonto, booking.buKey ?? '');
    const onKonto = rateOf(booking.konto, '');
    if (onGegenkonto > 0) add(vat, onGegenkonto, gegenkontoCredited * datevVat(booking.amountCents, onGegenkonto));
    if (onKonto > 0) add(vat, onKonto, -gegenkontoCredited * datevVat(booking.amountCents, onKonto));
  }
  return vat;
}

/**
 * Per VAT rate, the VAT DATEV will compute from the bookings equals the VAT
 * apaleo charged, within the rounding total of that rate: one cent per
 * `W-VAT-ROUNDING` finding the posting run reported at that rate
 * (`E-VAT-TOTAL` above it). Roundings at one rate never excuse a difference at
 * another.
 */
export function checkVatByRate(lines: readonly LedgerLine[], result: PostingResult, options: CheckOptions): Finding[] {
  const apaleo = apaleoVatByRate(lines, result, options.chart);
  const datev = datevVatByRate(result, options);
  const rates = [...new Set([...apaleo.keys(), ...datev.keys()])].sort((a, b) => a - b);
  return rates.flatMap((rate) => {
    const allowance = result.vatRoundingByRate.get(rate) ?? 0;
    const charged = apaleo.get(rate) ?? 0;
    const computed = datev.get(rate) ?? 0;
    if (Math.abs(computed - charged) <= allowance) return [];
    return [
      {
        code: 'E-VAT-TOTAL',
        message:
          `at ${rate} % DATEV will compute ${formatCents(computed)} VAT from the bookings, but apaleo charged ${formatCents(charged)} ` +
          `(difference ${formatCents(computed - charged)}, the rounding total allows ${formatCents(allowance)}). ${REPORT_PROBLEM_HINT}`,
        value: String(rate),
      },
    ];
  });
}

/** The three blocking checks, in order. */
export function plausibilityFindings(lines: readonly LedgerLine[], result: PostingResult, options: CheckOptions): Finding[] {
  return [...checkConservation(lines, result), ...checkAccountMovements(lines, result, options), ...checkVatByRate(lines, result, options)];
}

const amounts = ({ debitCents, creditCents }: DebitCredit) => `debit ${formatCents(debitCents)}, credit ${formatCents(creditCents)}`;

/**
 * The opt-in completeness check (`checks.aggregates`): apaleo's daily aggregates,
 * one request per business day, against that day's ledger lines rolled up to
 * their main accounts. A main account that matches neither gross nor net is a
 * `W-AGGREGATE-DIFF` warning.
 */
export async function checkAggregates(
  source: SourceAdapter,
  propertyId: string,
  period: DateRange,
  lines: readonly LedgerLine[],
  chart: ChartIndex,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  // One day at a time: these requests are not throttled by the adapter.
  for (const day of eachDay(period.from, nextDay(period.to))) {
    const totals = await source.getAccountTotals(propertyId, day);
    const dayLines = lines.filter((line) => line.businessDate === day);
    for (const comparison of compareAggregates(totals, dayLines, chart)) {
      if (comparison.match !== 'none') continue;
      const { account } = comparison;
      findings.push({
        code: 'W-AGGREGATE-DIFF',
        message:
          `on ${day} apaleo's daily aggregate for main account ${account.number} (${account.type}) shows ${amounts(comparison.source)}, ` +
          `but the ledger lines of that day add up to ${amounts(comparison.gross)} gross (${amounts(comparison.net)} net). ` +
          'Compare the day in apaleo; the file is written anyway',
        value: account.number,
      });
    }
  }
  return findings;
}
