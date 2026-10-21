import { formatFinding, type Finding } from '../core/findings.js';
import { formatCents } from '../core/money.js';
import type { PostingSummary, SkipReason } from '../posting/index.js';
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

/**
 * The posting summary as aligned text, for the dry run and the protocol file:
 * totals per DATEV account, revenue and VAT per rate, city tax, payments per
 * clearing account, deposits, skipped lines and every finding.
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

  const revenue = summary.revenueByRate.map((r) => [`${r.ratePercent} %`, formatCents(r.grossCents), formatCents(r.vatCents)]);
  section(
    'Revenue and VAT per rate (VAT as DATEV computes it):',
    revenue.length === 0 ? '' : formatTable([['rate', 'gross', 'VAT'], ...revenue], [1, 2], '  '),
  );
  out.push(`City tax: ${formatCents(summary.cityTaxCents)}`, '');

  const payments = summary.payments.map((p) => [p.account, formatCents(p.cents)]);
  section('Payments per clearing account:', payments.length === 0 ? '' : formatTable([['account', 'amount'], ...payments], [1], '  '));
  out.push(
    `Deposits: received ${formatCents(summary.deposits.receivedCents)}, released ${formatCents(summary.deposits.releasedCents)}`,
    `VAT rounding differences: ${formatCents(summary.roundingCents)}`,
    '',
  );

  const skipped = summary.skipped.map((s) => [SKIP_LABELS[s.reason], String(s.lines), formatCents(s.grossCents)]);
  section('Skipped lines:', skipped.length === 0 ? '' : formatTable([['reason', 'lines', 'gross'], ...skipped], [1, 2], '  '));
  return out;
}
