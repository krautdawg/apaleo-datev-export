import type { LocalDate } from '../../src/core/date.js';
import {
  sortLedgerLines,
  type AccountTotals,
  type LedgerLine,
  type SourceAccount,
  type SourceAdapter,
  type SourceProperty,
} from '../../src/core/source.js';

/** Canonical data a `FakeSource` serves, keyed by property id. */
export interface FakeSourceData {
  properties: SourceProperty[];
  charts: Record<string, SourceAccount[]>;
  ledger: Record<string, LedgerLine[]>;
  totals?: Record<string, AccountTotals[]>;
}

/**
 * An in-memory `SourceAdapter` for tests of mapping, posting and export code.
 * It imports nothing from `src/sources`, so code under test runs without any
 * apaleo module. Every call is recorded in `calls`.
 */
export class FakeSource implements SourceAdapter {
  readonly name = 'fake';
  readonly calls: string[] = [];

  constructor(private readonly data: FakeSourceData) {}

  async listProperties(): Promise<SourceProperty[]> {
    this.calls.push('listProperties');
    return structuredClone(this.data.properties);
  }

  async getChartOfAccounts(propertyId: string): Promise<SourceAccount[]> {
    this.calls.push(`getChartOfAccounts ${propertyId}`);
    return structuredClone(this.data.charts[propertyId] ?? []);
  }

  async getLedger(propertyId: string, from: LocalDate, toExclusive: LocalDate): Promise<LedgerLine[]> {
    this.calls.push(`getLedger ${propertyId} ${from} ${toExclusive}`);
    const lines = (this.data.ledger[propertyId] ?? []).filter((l) => l.businessDate >= from && l.businessDate < toExclusive);
    return sortLedgerLines(structuredClone(lines));
  }

  async getAccountTotals(propertyId: string, businessDate: LocalDate): Promise<AccountTotals> {
    this.calls.push(`getAccountTotals ${propertyId} ${businessDate}`);
    const found = this.data.totals?.[propertyId]?.find((t) => t.businessDate === businessDate);
    const zero = { value: '0', currency: '' };
    return structuredClone(found ?? { businessDate, accounts: [], total: { debited: zero, credited: zero, balance: zero } });
  }
}
