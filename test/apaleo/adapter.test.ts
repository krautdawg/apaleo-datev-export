import { describe, expect, it } from 'vitest';
import type { LocalDate } from '../../src/core/date.js';
import { ApaleoPermissionError, PROPERTY_PAGE_SIZE } from '../../src/sources/apaleo/index.js';
import {
  API,
  BSP,
  CLIENT_SECRET,
  EMPTY_DAY,
  TOKEN_URL,
  brokenBody,
  createFixtureSource,
  noContent,
  readFixture,
} from '../helpers/apaleo.js';

const EXPORT = `${API}/finance/v1/accounts/export-gross-daily`;
const AGGREGATE = `${API}/finance/v1/accounts/aggregate-daily`;
const isExport = (url: URL) => url.pathname === '/finance/v1/accounts/export-gross-daily';

type Transactions = { transactions: Record<string, unknown>[] };
const dayFixture = (day: string) => structuredClone(readFixture(`export-gross-daily/${day}.json`)) as Transactions;

describe('listProperties', () => {
  it('asks for pages of 500 and stops on a short page', async () => {
    const { source, ctx } = createFixtureSource();
    const properties = await source.listProperties();
    expect(PROPERTY_PAGE_SIZE).toBe(500);
    expect(ctx.fetchCalls.filter((c) => c.includes('/inventory/'))).toEqual([
      `GET ${API}/inventory/v1/properties?pageNumber=1&pageSize=500`,
    ]);
    expect(properties).toEqual([
      { id: 'BSP', code: 'BSP', name: 'Hotel Beispiel', timeZone: 'Europe/Berlin', currency: 'EUR', countryCode: 'DE' },
      { id: 'HBW', code: 'HBW', name: 'Hotel Beispiel Wien', timeZone: 'Europe/Vienna', currency: 'EUR', countryCode: 'AT' },
    ]);
  });

  it('stops without error when apaleo answers 204 for page 2', async () => {
    const { source, ctx } = createFixtureSource({}, { pageSize: 2 });
    const properties = await source.listProperties();
    expect(properties.map((p) => p.id)).toEqual(['BSP', 'HBW']);
    expect(ctx.fetchCalls.filter((c) => c.includes('/inventory/'))).toEqual([
      `GET ${API}/inventory/v1/properties?pageNumber=1&pageSize=2`,
      `GET ${API}/inventory/v1/properties?pageNumber=2&pageSize=2`,
    ]);
  });
});

describe('getChartOfAccounts', () => {
  it('reads depth 4 including archived accounts', async () => {
    const { source, ctx } = createFixtureSource();
    await source.getChartOfAccounts(BSP);
    expect(ctx.fetchCalls).toContain(`GET ${API}/finance/v1/accounts/schema?propertyId=BSP&depth=4&includeArchived=true`);
  });

  it('flattens nested revenue accounts with parent numbers and VAT on the leaves', async () => {
    const { source } = createFixtureSource();
    const accounts = await source.getChartOfAccounts(BSP);
    const pick = (number: string) => accounts.find((a) => a.number === number && a.ledger === 'global');
    expect(pick('5000')).toEqual({ number: '5000', name: 'Revenues', type: 'Revenues', ledger: 'global', isArchived: false, hasChildren: true });
    expect(pick('5010')).toMatchObject({ name: 'Accommodation', parentNumber: '5000', hasChildren: true });
    expect(pick('5010')?.vat).toBeUndefined();
    expect(pick('5011')).toMatchObject({ parentNumber: '5010', vat: { type: 'Reduced', percent: 7 }, hasChildren: false });
    expect(pick('5019')).toMatchObject({ parentNumber: '5010', vat: { type: 'Normal', percent: 19 } });
    expect(pick('5111')).toMatchObject({ parentNumber: '5110', vat: { type: 'Reduced', percent: 7 } });
    expect(pick('5990')).toMatchObject({ isArchived: true, vat: { type: 'Without', percent: 0 } });
  });

  it('keeps the ledger list of account numbers that repeat', async () => {
    const { source } = createFixtureSource();
    const accounts = await source.getChartOfAccounts(BSP);
    expect(accounts.filter((a) => a.number === '1200').map((a) => [a.ledger, a.name])).toEqual([
      ['guest', 'Guest Receivables'],
      ['external', 'External Receivables'],
    ]);
    expect(accounts.filter((a) => a.number === '3000').map((a) => a.ledger)).toEqual(['guest', 'booking']);
  });

  it('takes the parent from the containing account when parentNumber is missing', async () => {
    const chart = structuredClone(readFixture('accounts-schema.json')) as {
      globalAccounts: { subAccounts?: { parentNumber?: string }[] }[];
    };
    delete chart.globalAccounts[0]?.subAccounts?.[0]?.parentNumber;
    const { source } = createFixtureSource({
      override: (_r, url) => (url.pathname.endsWith('/schema') ? Response.json(chart) : undefined),
    });
    const cash = (await source.getChartOfAccounts(BSP)).find((a) => a.number === '1600');
    expect(cash?.parentNumber).toBe('1000');
  });
});

describe('getLedger', () => {
  it('sends one request per business day with an exclusive end', async () => {
    const served: Record<string, string> = { '2026-10-01': '2026-09-14', '2026-10-02': '2026-09-15', '2026-10-03': '2026-09-16' };
    const { source, ctx } = createFixtureSource({
      override: (_r, url) => {
        const day = served[url.searchParams.get('from') ?? ''];
        return isExport(url) && day ? Response.json(readFixture(`export-gross-daily/${day}.json`)) : undefined;
      },
    });
    const lines = await source.getLedger(BSP, '2026-10-01', '2026-10-04');
    expect(ctx.fetchCalls.filter((c) => c.startsWith(`POST ${EXPORT}`))).toEqual([
      `POST ${EXPORT}?propertyId=BSP&from=2026-10-01&to=2026-10-02`,
      `POST ${EXPORT}?propertyId=BSP&from=2026-10-02&to=2026-10-03`,
      `POST ${EXPORT}?propertyId=BSP&from=2026-10-03&to=2026-10-04`,
    ]);
    const expected = ['2026-09-14', '2026-09-15', '2026-09-16'].map((d) => dayFixture(d).transactions.length);
    expect(lines).toHaveLength(expected.reduce((a, b) => a + b, 0));
  });

  it('treats a 204 day as a day without lines', async () => {
    const { source } = createFixtureSource();
    expect(await source.getLedger(BSP, EMPTY_DAY, '2026-09-18')).toEqual([]);
    const withEmptyDay = await source.getLedger(BSP, '2026-09-16', '2026-09-18');
    expect(withEmptyDay).toHaveLength(dayFixture('2026-09-16').transactions.length);
  });

  it('returns nothing and sends nothing for an empty period', async () => {
    const { source, ctx } = createFixtureSource();
    expect(await source.getLedger(BSP, '2026-09-14', '2026-09-14')).toEqual([]);
    expect(ctx.fetchCalls).toEqual([]);
  });

  it('maps a transaction to the canonical ledger line', async () => {
    const { source } = createFixtureSource();
    const lines = await source.getLedger(BSP, '2026-09-14', '2026-09-15');
    expect(lines.find((l) => l.sourceEntryNumber === 'BSPE0001')).toEqual({
      businessDate: '2026-09-14',
      postedAt: '2026-09-14T10:12:03.4410021Z',
      debit: { number: '1611', name: 'Visa', type: 'Payments', parentNumber: '1610' },
      credit: { number: 'BSP-GHIJKL-1_Liabilities', name: 'Liabilities for Reservation BSP-GHIJKL-1', type: 'Liabilities' },
      command: 'PostPrepayment',
      currency: 'EUR',
      grossCents: 20000,
      netCents: 18692,
      taxes: [{ vatType: 'Reduced', percent: 7, amountCents: 1308 }],
      receipt: { type: 'PspReference', number: 'PSP-8823410001' },
      reference: 'BSP-GHIJKL-1',
      referenceType: 'Guest',
      sourceEntryNumber: 'BSPE0001',
      source: 'apaleo',
    });
  });

  it('keeps negative allowances, zero tax entries and per-reservation accounts as received', async () => {
    const { source } = createFixtureSource();
    const lines = await source.getLedger(BSP, '2026-09-14', '2026-09-16');
    const allowance = lines.find((l) => l.sourceEntryNumber === 'BSPE0010');
    expect(allowance).toMatchObject({ grossCents: -1000, netCents: -935, taxes: [{ amountCents: -65 }] });
    const cityTax = lines.find((l) => l.sourceEntryNumber === 'BSPE0004');
    expect(cityTax?.taxes).toEqual([{ vatType: 'Without', percent: 0, amountCents: 0 }]);
    expect(cityTax?.debit).toEqual({
      number: 'BSP-ABCDEF-1_Receivables',
      name: 'Receivables for Reservation BSP-ABCDEF-1',
      type: 'Receivables',
    });
    const mueller = lines.find((l) => l.sourceEntryNumber === 'BSPE0011');
    expect(mueller?.debit).toEqual({ number: 'BSP-12345-1', name: 'Müller, Hans', type: 'Receivables', parentNumber: '1200' });
  });

  it('reads both deposit-release variants', async () => {
    const { source } = createFixtureSource();
    const [withTaxes] = (await source.getLedger(BSP, '2026-09-21', '2026-09-22')).filter((l) => l.debit.type === 'Liabilities');
    expect(withTaxes).toMatchObject({ credit: { type: 'Receivables' }, taxes: [{ percent: 7, amountCents: 1308 }] });
    const day = await source.getLedger(BSP, '2026-09-22', '2026-09-23');
    const release = day.find((l) => l.debit.type === 'Liabilities' && l.credit.type === 'Receivables');
    expect(release?.taxes).toEqual([]);
    // Variant (b) is a full cycle: VAT on the prepayment received on 09-15, reversed at the service date.
    const vat = (await source.getLedger(BSP, '2026-09-15', '2026-09-23')).filter((l) => l.command === 'PostPrepaymentVat');
    expect(vat.map((l) => [l.businessDate, l.debit.number, l.credit.number, l.grossCents])).toEqual([
      ['2026-09-15', 'BSP-MNOPQR-1_Liabilities', '2107', 981],
      ['2026-09-22', '2107', 'BSP-MNOPQR-1_Liabilities', 981],
    ]);
  });

  it('sorts by date, source entry number and timestamp, keeping response order on ties', async () => {
    const { source } = createFixtureSource();
    const lines = await source.getLedger(BSP, '2026-09-14', '2026-09-23');
    const keys = lines.map((l) => [l.businessDate, l.sourceEntryNumber, l.postedAt].join(' '));
    expect(keys).toEqual([...keys].sort());
    const breakfast = lines.filter((l) => l.sourceEntryNumber === 'BSPE0003');
    expect(breakfast.map((l) => l.credit.number)).toEqual(['5111', '5121']);
    expect(breakfast[0]?.postedAt).toBe(breakfast[1]?.postedAt);
  });

  it('keeps the response order of two lines with the same entry number and timestamp', async () => {
    const reversed = dayFixture('2026-09-14');
    reversed.transactions.reverse();
    const { source } = createFixtureSource({ override: (_r, url) => (isExport(url) ? Response.json(reversed) : undefined) });
    const breakfast = (await source.getLedger(BSP, '2026-09-14', '2026-09-15')).filter((l) => l.sourceEntryNumber === 'BSPE0003');
    expect(breakfast.map((l) => l.credit.number)).toEqual(['5121', '5111']);
  });

  it('returns equal results for repeated reads of unchanged data', async () => {
    const { source } = createFixtureSource();
    const first = await source.getLedger(BSP, '2026-09-14', '2026-09-23');
    const second = await source.getLedger(BSP, '2026-09-14', '2026-09-23');
    expect(second).toEqual(first);
  });

  it('has at most two export requests in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const { source } = createFixtureSource({
      override: async (_r, url) => {
        if (!isExport(url)) return undefined;
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return noContent();
      },
    });
    await source.getLedger(BSP, '2026-09-01', '2026-09-08');
    expect(peak).toBe(2);
  });
});

describe('Idempotency-Key', () => {
  const keysOf = async (runId?: string, failFirst = false) => {
    const keys: (string | null)[] = [];
    let failures = failFirst ? 1 : 0;
    const { source } = createFixtureSource(
      {
        override: (request, url) => {
          if (!isExport(url)) return undefined;
          keys.push(request.headers.get('idempotency-key'));
          return failures-- > 0 ? new Response(null, { status: 503 }) : undefined;
        },
      },
      { runId },
    );
    await source.getLedger(BSP, '2026-09-14', '2026-09-16');
    return keys;
  };

  it('names property, period and run', async () => {
    expect(await keysOf('run-1')).toEqual([
      'apaleo-datev-BSP-2026-09-14-2026-09-15-run-1',
      'apaleo-datev-BSP-2026-09-15-2026-09-16-run-1',
    ]);
  });

  it('is reused when a request is retried within a run', async () => {
    const keys = await keysOf('run-1', true);
    expect(keys).toHaveLength(3);
    expect(keys.filter((key) => key === 'apaleo-datev-BSP-2026-09-14-2026-09-15-run-1')).toHaveLength(2);
  });

  it('differs between runs', async () => {
    const [first] = await keysOf();
    const [second] = await keysOf();
    expect(first).toMatch(/^apaleo-datev-BSP-2026-09-14-2026-09-15-[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
  });
});

describe('response validation', () => {
  const withDay = (data: unknown) =>
    createFixtureSource({ override: (_r, url) => (isExport(url) ? Response.json(data) : undefined) }).source;

  it('names property, business day and JSON path of a missing required field', async () => {
    const data = dayFixture('2026-09-14');
    delete data.transactions[2]?.sourceEntryNumber;
    const error = await withDay(data).getLedger(BSP, '2026-09-14', '2026-09-15').catch((e: unknown) => e);
    expect((error as Error).message).toBe(
      'apaleo sent a response that does not match its API description (property BSP, business day 2026-09-14):\n' +
        '  - transactions[2].sourceEntryNumber: is missing\n' +
        'This cannot be fixed in apaleo or in your config. Please open an issue at ' +
        'https://github.com/krautdawg/apaleo-datev-export/issues and paste this message, but leave out guest names.',
    );
  });

  it('accepts unknown enum values as strings', async () => {
    const data = dayFixture('2026-09-14');
    Object.assign(data.transactions[0] as object, { command: 'PostMagic', referenceType: 'Group' });
    Object.assign((data.transactions[0] as { debitedAccount: object }).debitedAccount, { type: 'Wallet' });
    const [line] = (await withDay(data).getLedger(BSP, '2026-09-14', '2026-09-15')).filter((l) => l.command === 'PostMagic');
    expect(line).toMatchObject({ command: 'PostMagic', referenceType: 'Group', debit: { type: 'Wallet' } });
  });

  it('keeps a timestamp with seven fractional digits as the same string', async () => {
    const data = dayFixture('2026-09-14');
    Object.assign(data.transactions[0] as object, { timestamp: '2026-10-01T22:14:05.1234567+02:00' });
    const lines = await withDay(data).getLedger(BSP, '2026-09-14', '2026-09-15');
    expect(lines.map((l) => l.postedAt)).toContain('2026-10-01T22:14:05.1234567+02:00');
  });

  it('rejects a timestamp that is not ISO 8601', async () => {
    const data = dayFixture('2026-09-14');
    Object.assign(data.transactions[0] as object, { timestamp: '14.09.2026 10:12' });
    await expect(withDay(data).getLedger(BSP, '2026-09-14', '2026-09-15')).rejects.toThrow(
      'transactions[0].timestamp: must be an ISO 8601 timestamp',
    );
  });

  it('accepts taxes: null and a receipt without type', async () => {
    const data = dayFixture('2026-09-14');
    Object.assign(data.transactions[0] as object, { taxes: null, receipt: { number: 'R-1' } });
    const [line] = await withDay(data).getLedger(BSP, '2026-09-14', '2026-09-15');
    expect(line).toMatchObject({ taxes: [], receipt: { number: 'R-1' } });
    expect(line?.receipt).not.toHaveProperty('type');
  });

  it('fails on a sub-cent ledger amount and names the source entry number', async () => {
    const data = dayFixture('2026-09-14');
    Object.assign(data.transactions[1] as object, { grossAmount: 10.005 });
    await expect(withDay(data).getLedger(BSP, '2026-09-14', '2026-09-15')).rejects.toThrow(
      'apaleo property BSP, business day 2026-09-14, source entry BSPE0002, grossAmount: the amount 10.005 is not a whole number of cents.',
    );
  });
});

describe('HTTP errors', () => {
  it('lists the needed permissions when apaleo answers 403 on the export endpoint', async () => {
    const { source } = createFixtureSource({
      override: (_r, url) => (isExport(url) ? new Response(null, { status: 403 }) : undefined),
    });
    const error = await source.getLedger(BSP, '2026-09-14', '2026-09-15').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApaleoPermissionError);
    const message = (error as Error).message;
    expect(message).toContain('apaleo refused export-gross-daily for property BSP, business day 2026-09-14 (HTTP 403 Forbidden)');
    expect(message).toMatch(/required: .*core\.subledger_schema\.read/);
    expect(message).toMatch(/required: .*core\.subledger_export\.create/);
    expect(message).toContain('optional: core.subledger_aggregate.create');
    expect(message).toContain('scope accounting.read');
  });

  it('renews the token once after a 401 and retries', async () => {
    let rejections = 1;
    const { source, ctx } = createFixtureSource({
      override: (_r, url) => (url.pathname.endsWith('/schema') && rejections-- > 0 ? new Response(null, { status: 401 }) : undefined),
    });
    expect(await source.getChartOfAccounts(BSP)).not.toEqual([]);
    expect(ctx.fetchCalls.filter((c) => c === `POST ${TOKEN_URL}`)).toHaveLength(2);
  });

  it('fails with a credentials hint when the renewed token is rejected too', async () => {
    const { source } = createFixtureSource({
      override: (_r, url) => (url.pathname.endsWith('/schema') ? new Response(null, { status: 401 }) : undefined),
    });
    await expect(source.getChartOfAccounts(BSP)).rejects.toThrow(
      /rejected the access token for the chart of accounts of property BSP \(HTTP 401\)\. Check apaleo\.clientId/,
    );
  });

  it('reports other errors with apaleo\'s message, without secrets', async () => {
    const { source } = createFixtureSource({
      override: (_r, url) =>
        isExport(url) ? new Response(`{"messages":["bad request for ${CLIENT_SECRET}"]}`, { status: 422 }) : undefined,
    });
    const error = await source.getLedger(BSP, '2026-09-14', '2026-09-15').catch((e: unknown) => e);
    expect((error as Error).message).toBe(
      'export-gross-daily for property BSP, business day 2026-09-14: apaleo answered HTTP 422: {"messages":["bad request for ***"]}',
    );
  });

  it('retries export-gross-daily with the same Idempotency-Key when the body breaks off', async () => {
    const keys: (string | null)[] = [];
    let failures = 1;
    const { source, sleeps } = createFixtureSource({
      override: (request, url) => {
        if (!isExport(url)) return undefined;
        keys.push(request.headers.get('idempotency-key'));
        return failures-- > 0 ? brokenBody() : undefined;
      },
    });
    expect(await source.getLedger(BSP, '2026-09-14', '2026-09-15')).not.toEqual([]);
    expect(sleeps).toEqual([1000]);
    expect(keys).toEqual(['apaleo-datev-BSP-2026-09-14-2026-09-15-run-1', 'apaleo-datev-BSP-2026-09-14-2026-09-15-run-1']);
  });

  it('reports a body that is not JSON', async () => {
    const { source } = createFixtureSource({
      override: (_r, url) => (isExport(url) ? new Response('<html>', { status: 200 }) : undefined),
    });
    await expect(source.getLedger(BSP, '2026-09-14', '2026-09-15')).rejects.toThrow('with a body that is not JSON');
  });
});

describe('getAccountTotals', () => {
  it('sends one request per business day and returns main accounts with a grand total', async () => {
    const { source, ctx } = createFixtureSource();
    const days: LocalDate[] = ['2026-09-14', '2026-09-15', '2026-09-16'];
    const results = await Promise.all(days.map((day) => source.getAccountTotals(BSP, day)));
    expect(ctx.fetchCalls.filter((c) => c.startsWith(`POST ${AGGREGATE}`))).toEqual(
      days.map((day, i) => `POST ${AGGREGATE}?propertyId=BSP&from=${day}&to=${['2026-09-15', '2026-09-16', '2026-09-17'][i]}`),
    );
    for (const [i, totals] of results.entries()) {
      expect(totals.businessDate).toBe(days[i]);
      expect(totals.accounts.length).toBeGreaterThan(0);
      expect(totals.total.debited.value).toBe(totals.total.credited.value);
    }
    expect(results[0]?.accounts.find((a) => a.account.number === '5000')).toEqual({
      account: { number: '5000', name: 'Revenues', type: 'Revenues' },
      debited: { value: '0', currency: 'EUR' },
      credited: { value: '138.8004', currency: 'EUR' },
      balance: { value: '-138.8004', currency: 'EUR' },
    });
  });

  it('keeps a precise amount of 123.4567 without a sub-cent error', async () => {
    const money = (amount: number) => ({ amount, currency: 'EUR' });
    const body = {
      aggregations: [
        { account: { number: '5000', name: 'Revenues', type: 'Revenues' }, debitedAmount: money(0), creditedAmount: money(123.4567), balance: money(-123.4567) },
      ],
      total: { debitedAmount: money(123.4567), creditedAmount: money(123.4567), balance: money(0) },
    };
    const { source } = createFixtureSource({
      override: (_r, url) => (url.pathname.endsWith('/aggregate-daily') ? Response.json(body) : undefined),
    });
    const totals = await source.getAccountTotals(BSP, '2026-09-14');
    expect(totals.accounts[0]?.credited).toEqual({ value: '123.4567', currency: 'EUR' });
  });

  it('returns empty totals for a 204 day and sends an Idempotency-Key', async () => {
    const keys: (string | null)[] = [];
    const { source } = createFixtureSource({
      override: (request, url) => void (url.pathname.endsWith('/aggregate-daily') && keys.push(request.headers.get('idempotency-key'))),
    });
    const totals = await source.getAccountTotals(BSP, EMPTY_DAY);
    expect(totals).toEqual({
      businessDate: EMPTY_DAY,
      accounts: [],
      total: { debited: { value: '0', currency: '' }, credited: { value: '0', currency: '' }, balance: { value: '0', currency: '' } },
    });
    expect(keys).toEqual(['apaleo-datev-aggregate-BSP-2026-09-17-2026-09-18-run-1']);
  });
});
