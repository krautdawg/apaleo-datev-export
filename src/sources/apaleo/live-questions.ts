import type { ChartIndex } from '../../core/chart.js';
import { depositMovement } from '../../core/deposits.js';
import type { LedgerLine } from '../../core/source.js';

const MAX_EXAMPLES = 3;
const VAT_ACCOUNT_TYPES: ReadonlySet<string> = new Set(['Vat', 'VatOnLiabilities']);

/** Deposit lines of one kind, and how many carry `taxes[]` (after dropping 0 %/0.00 entries). */
export interface DepositLines {
  lines: number;
  withTaxes: number;
  withoutTaxes: number;
}

/**
 * Facts about real apaleo data that the Swagger leaves open. `live-smoke`
 * prints them so the first run against a real account settles the questions.
 */
export interface LiveAnswers {
  /** Accounts in the ledger that are not in the chart of accounts (per-reservation accounts). */
  outsideChart: { lines: number; withParent: number; withoutParent: number; examples: string[] };
  /**
   * Deposit lines classified by side and sign (`depositMovement`): received
   * (Liabilities credited with a positive or debited with a negative amount),
   * released (otherwise), and of the released those paid back via a payment.
   */
  deposits: { received: DepositLines; released: DepositLines; refunded: DepositLines };
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
    deposits: { received: depositLines(), released: depositLines(), refunded: depositLines() },
    prepaymentVatLines: 0,
    vatOnLiabilitiesLines: 0,
    zeroTaxEntries: { zero: 0, total: 0 },
  };

  for (const line of lines) {
    const outside = [line.debit, line.credit].filter((ref) => !chart.has(ref.number));
    if (outside.length > 0) answers.outsideChart.lines++;
    for (const ref of outside) (ref.parentNumber === undefined ? withoutParent : withParent).add(ref.number);

    const movement = VAT_ACCOUNT_TYPES.has(line.debit.type) || VAT_ACCOUNT_TYPES.has(line.credit.type) ? undefined : depositMovement(line);
    if (movement) {
      const taxed = line.taxes.some((t) => t.percent !== 0 || t.amountCents !== 0) ? 'withTaxes' : 'withoutTaxes';
      const kinds = movement.direction === 'increase' ? ['received'] as const : movement.viaPayment ? ['released', 'refunded'] as const : ['released'] as const;
      for (const kind of kinds) {
        answers.deposits[kind].lines++;
        answers.deposits[kind][taxed]++;
      }
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

function depositLines(): DepositLines {
  return { lines: 0, withTaxes: 0, withoutTaxes: 0 };
}
