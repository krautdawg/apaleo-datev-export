import { depositMovement } from '../core/deposits.js';
import type { Finding } from '../core/findings.js';
import { sumDecimals } from '../core/money.js';
import type { LedgerLine } from '../core/source.js';
import type { ApaleoVat } from './apaleo-vat.js';
import type { PostedSide } from './guard.js';
import { datevVat } from './taxes.js';
import { SKIP_REASONS, type PostedBooking, type PostingSummary, type SkipReason, type VatTotal } from './types.js';

/** DATEV account numbers in numeric order: shorter (G/L) before longer (personal) numbers. */
const byNumber = (a: string, b: string) => a.length - b.length || a.localeCompare(b);

const CITY_TAX_TYPES: ReadonlySet<string> = new Set(['CityTaxes', 'SecondCityTax', 'GuestLevies']);

/** Signed amount for a type: positive when an account of the type is credited, negative when debited, 0 when absent. */
function creditedAmount(line: LedgerLine, types: ReadonlySet<string> | string): number {
  const has = (type: string) => (typeof types === 'string' ? type === types : types.has(type));
  return (has(line.credit.type) ? line.grossCents : 0) - (has(line.debit.type) ? line.grossCents : 0);
}

interface VatEntry {
  gross: number;
  vat: number;
  apaleo: string[];
}

/** Collects the totals of a posting run while bookings are produced. */
export class SummaryBuilder {
  private readonly accounts = new Map<string, { soll: number; haben: number }>();
  private readonly revenue = new Map<number, VatEntry>();
  private readonly depositVat = new Map<number, VatEntry>();
  private readonly payments = new Map<string, number>();
  private readonly skipped = new Map<SkipReason, { lines: number; gross: number }>();
  private cityTax = 0;
  private readonly deposits = { receivedCents: 0, releasedCents: 0, refundedCents: 0 };
  private accountsReceivable = 0;
  private rounding = 0;

  /** `apaleoVat` is what `apaleoVatOf` gives for the line. */
  addBooking(line: LedgerLine, booking: PostedBooking, debit: PostedSide, credit: PostedSide, roundingCents: number, apaleoVat: readonly ApaleoVat[]): void {
    const [soll, haben] = booking.side === 'S' ? [booking.konto, booking.gegenkonto] : [booking.gegenkonto, booking.konto];
    this.account(soll).soll += booking.amountCents;
    this.account(haben).haben += booking.amountCents;
    this.rounding += roundingCents;

    const side = (type: string) => (credit.ref.type === type ? credit : debit.ref.type === type ? debit : undefined);
    const revenue = side('Revenues');
    const deposit = revenue ? undefined : side('Liabilities');
    const vatSide = revenue ?? deposit;
    if (vatSide) {
      const gross = creditedAmount(line, vatSide.ref.type);
      const rate = vatSide.vat ? vatSide.rate : 0;
      const totals = revenue ? this.revenue : this.depositVat;
      const entry = totals.get(rate) ?? { gross: 0, vat: 0, apaleo: [] };
      entry.gross += gross;
      entry.vat += datevVat(gross, rate);
      entry.apaleo.push(...apaleoVat.map((vat) => vat.precise));
      totals.set(rate, entry);
    }
    this.cityTax += creditedAmount(line, CITY_TAX_TYPES);
    for (const payment of [debit, credit]) {
      if (payment.ref.type !== 'Payments') continue;
      const signed = payment === debit ? line.grossCents : -line.grossCents;
      this.payments.set(payment.row.datevAccount, (this.payments.get(payment.row.datevAccount) ?? 0) + signed);
    }
    const movement = depositMovement(line);
    if (movement?.direction === 'increase') this.deposits.receivedCents += movement.cents;
    if (movement?.direction === 'decrease') this.deposits.releasedCents += movement.cents;
    if (movement?.direction === 'decrease' && movement.viaPayment) this.deposits.refundedCents += movement.cents;
    this.accountsReceivable -= creditedAmount(line, 'AccountsReceivable');
  }

  addSkipped(reason: SkipReason, line: LedgerLine): void {
    const entry = this.skipped.get(reason) ?? { lines: 0, gross: 0 };
    entry.lines += 1;
    entry.gross += Math.abs(line.grossCents);
    this.skipped.set(reason, entry);
  }

  build(findings: readonly Finding[]): PostingSummary {
    const counts = new Map<string, number>();
    for (const finding of findings) counts.set(finding.code, (counts.get(finding.code) ?? 0) + 1);
    return {
      accounts: [...this.accounts]
        .sort(([a], [b]) => byNumber(a, b))
        .map(([account, { soll, haben }]) => ({ account, sollCents: soll, habenCents: haben, balanceCents: soll - haben })),
      revenueByRate: vatTotals(this.revenue),
      depositVatByRate: vatTotals(this.depositVat),
      cityTaxCents: this.cityTax,
      payments: [...this.payments].sort(([a], [b]) => byNumber(a, b)).map(([account, cents]) => ({ account, cents })),
      deposits: { ...this.deposits },
      accountsReceivableCents: this.accountsReceivable,
      skipped: SKIP_REASONS.flatMap((reason) => {
        const entry = this.skipped.get(reason);
        return entry ? [{ reason, lines: entry.lines, grossCents: entry.gross }] : [];
      }),
      roundingCents: this.rounding,
      findings: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, count })),
    };
  }

  private account(number: string): { soll: number; haben: number } {
    let entry = this.accounts.get(number);
    if (!entry) {
      entry = { soll: 0, haben: 0 };
      this.accounts.set(number, entry);
    }
    return entry;
  }
}

function vatTotals(entries: ReadonlyMap<number, VatEntry>): VatTotal[] {
  return [...entries]
    .sort(([a], [b]) => a - b)
    .map(([ratePercent, { gross, vat, apaleo }]) => ({ ratePercent, grossCents: gross, vatCents: vat, apaleoVat: sumDecimals(apaleo) }));
}
