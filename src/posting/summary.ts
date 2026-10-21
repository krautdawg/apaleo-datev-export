import type { Finding } from '../core/findings.js';
import type { LedgerLine } from '../core/source.js';
import type { PostedSide } from './guard.js';
import { datevVat } from './taxes.js';
import { SKIP_REASONS, type PostedBooking, type PostingSummary, type SkipReason } from './types.js';

/** DATEV account numbers in numeric order: shorter (G/L) before longer (personal) numbers. */
const byNumber = (a: string, b: string) => a.length - b.length || a.localeCompare(b);

const CITY_TAX_TYPES: ReadonlySet<string> = new Set(['CityTaxes', 'SecondCityTax', 'GuestLevies']);

/** Signed amount for a type: positive when an account of the type is credited, negative when debited, 0 when absent. */
function creditedAmount(line: LedgerLine, types: ReadonlySet<string> | string): number {
  const has = (type: string) => (typeof types === 'string' ? type === types : types.has(type));
  return (has(line.credit.type) ? line.grossCents : 0) - (has(line.debit.type) ? line.grossCents : 0);
}

/** Collects the totals of a posting run while bookings are produced. */
export class SummaryBuilder {
  private readonly accounts = new Map<string, { soll: number; haben: number }>();
  private readonly revenue = new Map<number, { gross: number; vat: number }>();
  private readonly payments = new Map<string, number>();
  private readonly skipped = new Map<SkipReason, { lines: number; gross: number }>();
  private cityTax = 0;
  private received = 0;
  private released = 0;
  private rounding = 0;

  addBooking(line: LedgerLine, booking: PostedBooking, debit: PostedSide, credit: PostedSide, roundingCents: number): void {
    const [soll, haben] = booking.side === 'S' ? [booking.konto, booking.gegenkonto] : [booking.gegenkonto, booking.konto];
    this.account(soll).soll += booking.amountCents;
    this.account(haben).haben += booking.amountCents;
    this.rounding += roundingCents;

    const revenue = credit.ref.type === 'Revenues' ? credit : debit.ref.type === 'Revenues' ? debit : undefined;
    if (revenue) {
      const gross = creditedAmount(line, 'Revenues');
      const rate = revenue.vat ? revenue.rate : 0;
      const entry = this.revenue.get(rate) ?? { gross: 0, vat: 0 };
      entry.gross += gross;
      entry.vat += datevVat(gross, rate);
      this.revenue.set(rate, entry);
    }
    this.cityTax += creditedAmount(line, CITY_TAX_TYPES);
    for (const side of [debit, credit]) {
      if (side.ref.type !== 'Payments') continue;
      const signed = side === debit ? line.grossCents : -line.grossCents;
      this.payments.set(side.row.datevAccount, (this.payments.get(side.row.datevAccount) ?? 0) + signed);
    }
    if (line.credit.type === 'Liabilities') this.received += line.grossCents;
    if (line.debit.type === 'Liabilities') this.released += line.grossCents;
  }

  addSkipped(reason: SkipReason, line: LedgerLine): void {
    const entry = this.skipped.get(reason) ?? { lines: 0, gross: 0 };
    entry.lines += 1;
    entry.gross += line.grossCents;
    this.skipped.set(reason, entry);
  }

  build(findings: readonly Finding[]): PostingSummary {
    const counts = new Map<string, number>();
    for (const finding of findings) counts.set(finding.code, (counts.get(finding.code) ?? 0) + 1);
    return {
      accounts: [...this.accounts]
        .sort(([a], [b]) => byNumber(a, b))
        .map(([account, { soll, haben }]) => ({ account, sollCents: soll, habenCents: haben, balanceCents: soll - haben })),
      revenueByRate: [...this.revenue]
        .sort(([a], [b]) => a - b)
        .map(([ratePercent, { gross, vat }]) => ({ ratePercent, grossCents: gross, vatCents: vat })),
      cityTaxCents: this.cityTax,
      payments: [...this.payments].sort(([a], [b]) => byNumber(a, b)).map(([account, cents]) => ({ account, cents })),
      deposits: { receivedCents: this.received, releasedCents: this.released },
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
