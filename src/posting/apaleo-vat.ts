import { formatCents, negateDecimal } from '../core/money.js';
import type { LedgerLine } from '../core/source.js';
import { VAT_RELEVANT_TYPES } from '../mapping/index.js';
import type { ReleaseRate } from './release.js';
import { datevVat, normaliseTaxes } from './taxes.js';

/** VAT apaleo charged on a line at one rate, signed as owed: positive when the line credits its revenue or deposit side. */
export interface ApaleoVat {
  rate: number;
  /** apaleo's per-line tax rounded to cents (what the cent-exact checks compare). */
  cents: number;
  /** apaleo's precise tax (what the protocol shows beside DATEV's VAT). */
  precise: string;
}

/**
 * +1 when the line credits its VAT-relevant account (revenue, deposit received),
 * -1 when it debits it (deposit released or refunded): VAT owed goes up or down.
 */
export function vatDirection(line: LedgerLine): number {
  const debit = VAT_RELEVANT_TYPES.has(line.debit.type);
  const credit = VAT_RELEVANT_TYPES.has(line.credit.type);
  return debit && !credit ? -1 : 1;
}

/**
 * The VAT apaleo charged on a booked line: its taxes, or for an untaxed deposit
 * line the VAT apaleo moved for it. A `PostPrepaymentVat` pair counts once, on
 * the first deposit line it covers; a rate from the chart has no amount in
 * apaleo, so DATEV's VAT stands in for it.
 */
export function apaleoVatOf(line: LedgerLine, release: ReleaseRate | undefined): ApaleoVat[] {
  const direction = vatDirection(line);
  const taxes = normaliseTaxes(line.taxes);
  if (taxes.length > 0) {
    return taxes.map((tax) => ({
      rate: tax.percent,
      cents: direction * tax.amountCents,
      precise: direction > 0 ? tax.amountPrecise : negateDecimal(tax.amountPrecise),
    }));
  }
  const fixed = (rate: number, cents: number): ApaleoVat[] => [{ rate, cents, precise: formatCents(cents) }];
  if (release?.kind === 'pair') return release.releaseEntries[0] === line.sourceEntryNumber ? fixed(release.rate, -release.pairVatCents) : [];
  if (release?.kind === 'chart') return fixed(release.rate, direction * datevVat(line.grossCents, release.rate));
  return [];
}
