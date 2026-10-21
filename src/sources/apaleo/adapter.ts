import { randomUUID } from 'node:crypto';
import type { CommandContext } from '../../cli/context.js';
import type { LoadedConfig } from '../../core/config.js';
import { eachDay, nextDay, type LocalDate } from '../../core/date.js';
import { UserError } from '../../core/errors.js';
import {
  sortLedgerLines,
  type AccountTotals,
  type LedgerLine,
  type SourceAccount,
  type SourceAdapter,
  type SourceProperty,
} from '../../core/source.js';
import { ApaleoClient } from './client.js';
import { REQUEST_TIMEOUT_MS, defaultSleep, type HttpOptions } from './http.js';
import { SOURCE_NAME, emptyAccountTotals, flattenChart, toAccountTotals, toLedgerLine, toProperties } from './parse.js';
import { aggregateList, chartOfAccounts, exportTransactionList, parseResponse, propertyList } from './schemas.js';
import { TokenClient } from './token.js';

export const PROPERTY_PAGE_SIZE = 500;
/** Parallel export requests; keeps development accounts (5 requests/s) out of rate limits. */
export const LEDGER_CONCURRENCY = 2;

export interface ApaleoSourceOptions {
  clientId: string;
  clientSecret: string;
  scopes?: string | undefined;
  baseUrl: string;
  identityUrl: string;
  fetchFn: typeof fetch;
  now: () => Date;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
  /** Part of every Idempotency-Key; one per CLI run. Generated when left out. */
  runId?: string | undefined;
  /** Only tests change this. */
  pageSize?: number;
}

/** Reads the apaleo subledger of a property, read-only, with a custom app (client credentials). */
export class ApaleoSource implements SourceAdapter {
  readonly name = SOURCE_NAME;
  readonly runId: string;
  private readonly tokens: TokenClient;
  private readonly client: ApaleoClient;
  private readonly pageSize: number;

  constructor(options: ApaleoSourceOptions) {
    const http: HttpOptions = {
      fetchFn: options.fetchFn,
      now: options.now,
      sleep: options.sleep ?? defaultSleep,
      random: options.random ?? Math.random,
      timeoutMs: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    };
    this.runId = options.runId ?? randomUUID();
    this.pageSize = options.pageSize ?? PROPERTY_PAGE_SIZE;
    this.tokens = new TokenClient(options, http);
    this.client = new ApaleoClient(options.baseUrl, this.tokens, http, [options.clientSecret]);
  }

  /** Fetches a token, so a smoke test can report the login step on its own. */
  async authenticate(): Promise<void> {
    await this.tokens.getToken();
  }

  async listProperties(): Promise<SourceProperty[]> {
    const properties: SourceProperty[] = [];
    for (let pageNumber = 1; ; pageNumber++) {
      const result = await this.client.call({
        method: 'GET',
        path: '/inventory/v1/properties',
        query: { pageNumber: String(pageNumber), pageSize: String(this.pageSize) },
        what: `the property list (page ${pageNumber})`,
      });
      if (result.status === 204) return properties;
      const page = toProperties(parseResponse(propertyList, result.json, `property list, page ${pageNumber}`));
      properties.push(...page);
      if (page.length < this.pageSize) return properties;
    }
  }

  async getChartOfAccounts(propertyId: string): Promise<SourceAccount[]> {
    const what = `the chart of accounts of property ${propertyId}`;
    const result = await this.client.call({
      method: 'GET',
      path: '/finance/v1/accounts/schema',
      query: { propertyId, depth: '4', includeArchived: 'true' },
      what,
    });
    if (result.status === 204) return [];
    return flattenChart(parseResponse(chartOfAccounts, result.json, what));
  }

  async getLedger(propertyId: string, from: LocalDate, toExclusive: LocalDate): Promise<LedgerLine[]> {
    const days = eachDay(from, toExclusive);
    const perDay = await mapWithConcurrency(days, LEDGER_CONCURRENCY, (day) => this.getLedgerDay(propertyId, day));
    return sortLedgerLines(perDay.flat());
  }

  async getAccountTotals(propertyId: string, businessDate: LocalDate): Promise<AccountTotals> {
    const to = nextDay(businessDate);
    const what = `aggregate-daily for property ${propertyId}, business day ${businessDate}`;
    const result = await this.client.call({
      method: 'POST',
      path: '/finance/v1/accounts/aggregate-daily',
      query: { propertyId, from: businessDate, to },
      headers: { 'idempotency-key': this.idempotencyKey('aggregate', propertyId, businessDate, to) },
      what,
    });
    if (result.status === 204) return emptyAccountTotals(businessDate);
    return toAccountTotals(parseResponse(aggregateList, result.json, what), businessDate);
  }

  /**
   * Stable within one run, so retries are safe; a later run gets a new key and
   * therefore fresh data instead of apaleo's stored answer for the old key.
   */
  idempotencyKey(kind: 'export' | 'aggregate', propertyId: string, from: LocalDate, to: LocalDate): string {
    const prefix = kind === 'export' ? 'apaleo-datev' : 'apaleo-datev-aggregate';
    return `${prefix}-${propertyId}-${from}-${to}-${this.runId}`;
  }

  private async getLedgerDay(propertyId: string, day: LocalDate): Promise<LedgerLine[]> {
    const to = nextDay(day);
    const where = `property ${propertyId}, business day ${day}`;
    const result = await this.client.call({
      method: 'POST',
      path: '/finance/v1/accounts/export-gross-daily',
      query: { propertyId, from: day, to },
      headers: { 'idempotency-key': this.idempotencyKey('export', propertyId, day, to) },
      what: `export-gross-daily for ${where}`,
    });
    if (result.status === 204) return [];
    const list = parseResponse(exportTransactionList, result.json, where);
    return list.transactions.map((item) => toLedgerLine(item, where));
  }
}

/** Runs `fn` over `items` with at most `limit` calls at a time; results keep the item order. Stops on the first failure. */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index] as T);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Builds the apaleo source from the loaded config; fails before any network call when credentials are missing. */
export function createApaleoSource(
  loaded: LoadedConfig,
  ctx: Pick<CommandContext, 'fetchFn' | 'now'>,
  overrides: Partial<ApaleoSourceOptions> = {},
): ApaleoSource {
  const { clientId, scopes, baseUrl, identityUrl } = loaded.config.apaleo;
  const clientSecret = loaded.secrets.apaleoClientSecret;
  if (!clientId) {
    throw new UserError(`apaleo.clientId is not set. Fill it in ${loaded.path} or set APALEO_CLIENT_ID.`);
  }
  if (!clientSecret) {
    throw new UserError(
      'APALEO_CLIENT_SECRET is not set. Set it in the environment (for example in .env) to the client secret of your apaleo custom app.',
    );
  }
  return new ApaleoSource({
    clientId,
    clientSecret,
    scopes,
    baseUrl,
    identityUrl,
    fetchFn: ctx.fetchFn,
    now: () => ctx.now(),
    ...overrides,
  });
}
