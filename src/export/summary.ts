import { formatFinding, type Finding } from '../core/findings.js';
import { decimalToCents, formatCents } from '../core/money.js';
import type { PostingSummary, SkipReason, VatTotal } from '../posting/index.js';
import { formatTable } from '../cli/table.js';
import type { PeriodPart } from './period.js';

const SKIP_LABELS: Readonly<Record<SkipReason, string>> = {
  VAT_ACCOUNT_LINE: 'apaleo VAT account line (DATEV computes the VAT)',
  ZERO_AMOUNT: 'amount 0.00',
  SAME_ACCOUNT: 'both sides on the same DATEV account',
};

export interface SummaryInput {
  propertyId: string;
  part: PeriodPart;
  ledgerLines: number;
  bookings: number;
  /** Absent when posting did not run (for example a day that is not closed). */
  summary?: PostingSummary;
  findings: readonly Finding[];
}

/** Why DATEV's VAT and apaleo's differ by a few cents, for the Kanzlei. */
export const VAT_ROUNDING_NOTE =
  "DATEV computes the VAT booking by booking and rounds each to the cent; apaleo's VAT is the precise sum of its lines, " +
  'rounded once. A difference of a few cents is this rounding, not an error.';

/**
 * The posting summary as aligned text, for the dry run and the protocol file:
 * totals per DATEV account, revenue and deposit VAT per rate (DATEV against
 * apaleo), city tax, payments per clearing account, deposits, accounts
 * receivable, skipped lines and every finding.
 */
export function renderSummary({ propertyId, part, ledgerLines, bookings, summary, findings }: SummaryInput): string {
  const out: string[] = [`Property ${propertyId}, ${part.from} to ${part.to}: ${ledgerLines} apaleo lines, ${bookings} DATEV bookings`, ''];
  if (summary) out.push(...postingSection(summary));
  out.push('Findings:');
  out.push(...(findings.length === 0 ? ['  none'] : findings.map((finding) => `  ${formatFinding(finding)}`)), '');
  return out.join('\n');
}

function postingSection(summary: PostingSummary): string[] {
  const out: string[] = [];
  const section = (title: string, body: string) => out.push(title, body.trimEnd() || '  none', '');

  const accounts = summary.accounts.map((a) => [a.account, formatCents(a.sollCents), formatCents(a.habenCents), formatCents(a.balanceCents)]);
  section('Totals per DATEV account:', formatTable([['account', 'Soll', 'Haben', 'balance'], ...accounts], [1, 2, 3], '  '));

  section('Revenue and VAT per rate:', vatLines(summary.revenueByRate));
  section('Deposits and their VAT per rate (received minus released):', vatLines(summary.depositVatByRate));
  out.push(VAT_ROUNDING_NOTE, '', `City tax: ${formatCents(summary.cityTaxCents)}`, '');

  const payments = summary.payments.map((p) => [p.account, formatCents(p.cents)]);
  section('Payments per clearing account:', payments.length === 0 ? '' : formatTable([['account', 'amount'], ...payments], [1], '  '));
  const { receivedCents, releasedCents, refundedCents } = summary.deposits;
  out.push(
    `Deposits: received ${formatCents(receivedCents)}, released ${formatCents(releasedCents)}, of it refunded ${formatCents(refundedCents)}`,
    `Accounts receivable (collective debtor, Soll positive): ${formatCents(summary.accountsReceivableCents)}`,
    `VAT rounding differences: ${formatCents(summary.roundingCents)}`,
    '',
  );

  const skipped = summary.skipped.map((s) => [SKIP_LABELS[s.reason], String(s.lines), formatCents(s.grossCents)]);
  section('Skipped lines:', skipped.length === 0 ? '' : formatTable([['reason', 'lines', 'gross (unsigned)'], ...skipped], [1, 2], '  '));
  return out;
}

/** `7 %: gross 571.22, DATEV VAT 37.38, apaleo VAT 37.37, difference 0.01 (apaleo precise 37.3695327)`, one line per rate. */
function vatLines(totals: readonly VatTotal[]): string {
  return totals
    .map((t) => {
      const apaleo = decimalToCents(t.apaleoVat);
      return (
        `  ${t.ratePercent} %: gross ${formatCents(t.grossCents)}, DATEV VAT ${formatCents(t.vatCents)}, apaleo VAT ${formatCents(apaleo)}, ` +
        `difference ${formatCents(t.vatCents - apaleo)} (apaleo precise ${t.apaleoVat})`
      );
    })
    .join('\n');
}
