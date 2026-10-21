import { eachDay, type LocalDate } from '../core/date.js';
import {
  sortLedgerLines,
  type AccountTotals,
  type LedgerLine,
  type SourceAccount,
  type SourceAdapter,
  type SourceProperty,
} from '../core/source.js';
import { emptyAccountTotals, flattenChart, toAccountTotals, toLedgerLine, toProperties } from '../sources/apaleo/parse.js';
import { aggregateList, chartOfAccounts, exportTransactionList, parseResponse, propertyList } from '../sources/apaleo/schemas.js';

/** Reads one recorded file, relative to the folder of recorded responses; undefined when it does not exist. */
export type ReadRecorded = (relative: string) => Promise<string | undefined>;

/**
 * A `SourceAdapter` over recorded apaleo responses (`examples/demo/apaleo/`),
 * parsed by the same schemas and converters as the live adapter. It makes no
 * network call: a business day without a file is a day without transactions,
 * like apaleo's 204.
 */
export class RecordedApaleoSource implements SourceAdapter {
  readonly name = 'apaleo-demo';

  constructor(
    private readonly propertyId: string,
    private readonly read: ReadRecorded,
  ) {}

  async listProperties(): Promise<SourceProperty[]> {
    return toProperties(parseResponse(propertyList, await this.json('properties/page-1.json'), 'demo property list'));
  }

  async getChartOfAccounts(propertyId: string): Promise<SourceAccount[]> {
    if (propertyId !== this.propertyId) return [];
    return flattenChart(parseResponse(chartOfAccounts, await this.json('accounts-schema.json'), 'demo chart of accounts'));
  }

  async getLedger(propertyId: string, from: LocalDate, toExclusive: LocalDate): Promise<LedgerLine[]> {
    if (propertyId !== this.propertyId) return [];
    const perDay = await Promise.all(
      eachDay(from, toExclusive).map(async (day) => {
        const json = await this.json(`export-gross-daily/${day}.json`, true);
        if (json === undefined) return [];
        const where = `demo data, business day ${day}`;
        return parseResponse(exportTransactionList, json, where).transactions.map((item) => toLedgerLine(item, where));
      }),
    );
    return sortLedgerLines(perDay.flat());
  }

  async getAccountTotals(propertyId: string, businessDate: LocalDate): Promise<AccountTotals> {
    const json = propertyId === this.propertyId ? await this.json(`aggregate-daily/${businessDate}.json`, true) : undefined;
    if (json === undefined) return emptyAccountTotals(businessDate);
    return toAccountTotals(parseResponse(aggregateList, json, `demo aggregates, business day ${businessDate}`), businessDate);
  }

  private async json(relative: string, optional = false): Promise<unknown> {
    const text = await this.read(relative);
    if (text === undefined) {
      if (optional) return undefined;
      throw new Error(`The demo data file ${relative} is missing`);
    }
    return JSON.parse(text) as unknown;
  }
}
