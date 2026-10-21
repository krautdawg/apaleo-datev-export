import type { ChartIndex } from '../core/chart.js';
import type { AccountRef, LedgerLine } from '../core/source.js';
import { ANY_TYPE, VAT_RELEVANT_TYPES, WILDCARD, rowKey, type Mapping, type MappingRow } from './types.js';

export interface ResolveOptions {
  /** Used to walk the parent chain of accounts that are in the chart. */
  chart?: ChartIndex;
  /**
   * The line's normalised VAT rate (see `lineRate`), or the rate the posting
   * rules inferred for an untaxed deposit release. Undefined when the line has
   * more than one rate: then no rate wildcard applies.
   */
  rate: number | undefined;
}

const indexes = new WeakMap<Mapping, Map<string, MappingRow>>();

function indexOf(mapping: Mapping): Map<string, MappingRow> {
  let index = indexes.get(mapping);
  if (!index) {
    index = new Map(mapping.rows.map((row) => [rowKey(row), row]));
    indexes.set(mapping, index);
  }
  return index;
}

/**
 * The mapping row for one side of a ledger line, in this order: (1) exact number
 * and type; (2) the number with any type (Grman rows); (3) the parent chain, from
 * the chart or else the account's own `parentNumber`, with the same type (or any
 * type); (4) for VAT-relevant types the wildcard row for the type and the line's
 * rate; (5) for other types the wildcard row for the type.
 *
 * An exact row (steps 1 and 2) with an empty DATEV account is returned as is: it
 * means "unmapped", because the user listed that account on purpose. A parent
 * row with an empty DATEV account does not end the search (template version 1
 * wrote `3000;Liabilities` empty, and one DATEV account cannot serve every
 * rate); when nothing else gives a DATEV account, the first such parent row is
 * returned so that findings can name it.
 */
export function resolve(mapping: Mapping, account: AccountRef, options: ResolveOptions): MappingRow | undefined {
  const index = indexOf(mapping);
  const byNumber = (number: string) =>
    index.get(rowKey({ apaleoAccount: number, apaleoType: account.type, apaleoVatPercent: '' })) ??
    index.get(rowKey({ apaleoAccount: number, apaleoType: ANY_TYPE, apaleoVatPercent: '' }));

  const exact = byNumber(account.number);
  if (exact) return exact;

  // Only chart accounts of the same type count: numbers repeat across types and ledgers.
  const inChart = (number: string) => {
    const found = options.chart?.find(number, account.type);
    return found?.type === account.type ? found : undefined;
  };
  const seen = new Set<string>([account.number]);
  const own = inChart(account.number);
  let parent = own ? own.parentNumber : account.parentNumber;
  let emptyParent: MappingRow | undefined;
  while (parent !== undefined && !seen.has(parent)) {
    seen.add(parent);
    const row = byNumber(parent);
    if (row?.datevAccount) return row;
    emptyParent ??= row;
    parent = inChart(parent)?.parentNumber;
  }

  const wildcard = wildcardRow(index, account.type, options.rate);
  return wildcard?.datevAccount ? wildcard : (emptyParent ?? wildcard);
}

/** The wildcard row for a type: for VAT-relevant types the one at `rate` (none when the rate is unknown). */
function wildcardRow(index: Map<string, MappingRow>, type: string, rate: number | undefined): MappingRow | undefined {
  if (!VAT_RELEVANT_TYPES.has(type)) return index.get(rowKey({ apaleoAccount: WILDCARD, apaleoType: type, apaleoVatPercent: '' }));
  if (rate === undefined) return undefined;
  return index.get(rowKey({ apaleoAccount: WILDCARD, apaleoType: type, apaleoVatPercent: String(rate) }));
}

/**
 * The VAT rate of a ledger line: the percent of its tax entries after dropping
 * entries with percent 0 and amount 0. A line without remaining entries has rate
 * 0; a line with two different rates has none (undefined).
 */
export function lineRate(line: Pick<LedgerLine, 'taxes'>): number | undefined {
  const rates = new Set(line.taxes.filter((tax) => tax.percent !== 0 || tax.amountCents !== 0).map((tax) => tax.percent));
  if (rates.size === 0) return 0;
  return rates.size === 1 ? [...rates][0] : undefined;
}
