import type { AccountRef, LedgerLine } from './source.js';

/**
 * How a ledger line moves a guest's deposit (s10 design decision 9). apaleo
 * books a prepayment as a credit on `<reservation>_Liabilities`, a release as a
 * charge with a negative amount on the same side, and a refund as a prepayment
 * with a negative amount; so the direction follows from the side and the sign,
 * never from the side alone.
 */
export interface DepositMovement {
  /** `increase` when the Liabilities side is credited with a positive or debited with a negative amount. */
  direction: 'increase' | 'decrease';
  /** The other side is a Payments account: money received for, or paid back from, the deposit. */
  viaPayment: boolean;
  /** Unsigned gross amount in cents. */
  cents: number;
  /** The Liabilities side of the line. */
  account: AccountRef;
}

const LIABILITIES = 'Liabilities';

/** The deposit movement of a line with exactly one Liabilities side; undefined for any other line. */
export function depositMovement(line: LedgerLine): DepositMovement | undefined {
  const credited = line.credit.type === LIABILITIES;
  if (credited === (line.debit.type === LIABILITIES) || line.grossCents === 0) return undefined;
  const signed = credited ? line.grossCents : -line.grossCents;
  const other = credited ? line.debit : line.credit;
  return {
    direction: signed > 0 ? 'increase' : 'decrease',
    viaPayment: other.type === 'Payments',
    cents: Math.abs(line.grossCents),
    account: credited ? line.credit : line.debit,
  };
}
