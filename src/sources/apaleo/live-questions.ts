import type { ChartIndex } from '../../core/chart.js';
import type { LedgerLine } from '../../core/source.js';

const MAX_EXAMPLES = 3;

/**
 * Facts about real apaleo data that the Swagger leaves open. `live-smoke`
 * prints them so the first run against a real account settles the questions.
 */
export interface LiveAnswers {
  /** Accounts in the ledger that are not in the chart of accounts (per-reservation accounts). */
  outsideChart: { lines: number; withParent: number; withoutParent: number; examples: string[] };
  /** Lines that debit Liabilities and credit Receivables (deposit releases). */
  depositReleases: { lines: number; withTaxes: number; withoutTaxes: number };
  prepaymentVatLines: number;
  vatOnLiabilitiesLines: number;
  /** `taxes[]` entries with percent 0 and amount 0, out of all entries. */
  zeroTaxEntries: { zero: number; total: number };
}

export function answerLiveQuestions(lines: readonly LedgerLine[], chart: ChartIndex): LiveAnswers {
  const withParent = new Set<string>();
  const withoutParent = new Set<string>();
  const answers: LiveAnswers = {
    outsideChart: { lines: 0, withParent: 0, withoutParent: 0, examples: [] },
    depositReleases: { lines: 0, withTaxes: 0, withoutTaxes: 0 },
    prepaymentVatLines: 0,
    vatOnLiabilitiesLines: 0,
    zeroTaxEntries: { zero: 0, total: 0 },
  };

  for (const line of lines) {
    const outside = [line.debit, line.credit].filter((ref) => !chart.has(ref.number));
    if (outside.length > 0) answers.outsideChart.lines++;
    for (const ref of outside) (ref.parentNumber === undefined ? withoutParent : withParent).add(ref.number);

    if (line.debit.type === 'Liabilities' && line.credit.type === 'Receivables') {
      answers.depositReleases.lines++;
      answers.depositReleases[line.taxes.length > 0 ? 'withTaxes' : 'withoutTaxes']++;
    }
    if (line.command === 'PostPrepaymentVat') answers.prepaymentVatLines++;
    if (line.debit.type === 'VatOnLiabilities' || line.credit.type === 'VatOnLiabilities') answers.vatOnLiabilitiesLines++;

    answers.zeroTaxEntries.total += line.taxes.length;
    answers.zeroTaxEntries.zero += line.taxes.filter((t) => t.percent === 0 && t.amountCents === 0).length;
  }
  answers.outsideChart.withParent = withParent.size;
  answers.outsideChart.withoutParent = withoutParent.size;
  answers.outsideChart.examples = [...withoutParent, ...withParent].slice(0, MAX_EXAMPLES);
  return answers;
}
