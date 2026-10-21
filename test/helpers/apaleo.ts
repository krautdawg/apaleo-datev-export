import { existsSync, readFileSync } from 'node:fs';
import { nextDay, type LocalDate } from '../../src/core/date.js';
import { ApaleoSource, type ApaleoSourceOptions } from '../../src/sources/apaleo/index.js';
import { createTestContext, type TestContext, type TestContextOptions } from './context.js';
import type { FakeSourceData } from './fake-source.js';

/**
 * The fabricated apaleo account "Hotel Beispiel" (property BSP) behind
 * `test/fixtures/apaleo/`, served as a fake apaleo API through `ctx.fetchFn`.
 * See `test/fixtures/apaleo/README.md` for what each business day contains.
 */
export const BSP = 'BSP';
export const LEDGER_DAYS: readonly LocalDate[] = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-21', '2026-09-22'];
/** apaleo answers 204 for this day. */
export const EMPTY_DAY: LocalDate = '2026-09-17';

export const API = 'https://api.apaleo.com';
export const IDENTITY = 'https://identity.apaleo.com';
export const TOKEN_URL = `${IDENTITY}/connect/token`;
export const CLIENT_ID = 'bsp-datev-export';
export const CLIENT_SECRET = 'fixture-secret-9f2c41';
export const ACCESS_TOKEN = 'fixture-access-token-77a1';

/** A config file and environment that pass validation and point at the fixtures. */
export const FIXTURE_FILES = {
  'apaleo-datev.config.yaml': `apaleo:\n  clientId: ${CLIENT_ID}\ndatev:\n  beraternummer: 1234567\n  mandantennummer: 42\n`,
};
export const FIXTURE_ENV = { APALEO_CLIENT_SECRET: CLIENT_SECRET };

const FIXTURES = new URL('../fixtures/apaleo/', import.meta.url);

export function fixturePath(relative: string): URL {
  return new URL(relative, FIXTURES);
}

export function readFixture(relative: string): unknown {
  return JSON.parse(readFileSync(fixturePath(relative), 'utf8')) as unknown;
}

/**
 * Recorded responses of a real apaleo DEV sandbox (`test/fixtures/apaleo/live/`,
 * see its README): properties BER (Berlin) and VIE (Vienna), business days
 * 2026-10-21 and 2026-10-22.
 */
export const LIVE_PROPERTIES = ['BER', 'VIE'] as const;
export type LiveProperty = (typeof LIVE_PROPERTIES)[number];
export const LIVE_DAY: LocalDate = '2026-10-21';
export const LIVE_DAYS: readonly LocalDate[] = ['2026-10-21', '2026-10-22'];

/** The recordings hold no property list; this one has the sandbox's two properties. */
const LIVE_PROPERTY_LIST = {
  properties: [
    { id: 'BER', code: 'BER', name: 'Sandbox Berlin', timeZone: 'Europe/Berlin', currencyCode: 'EUR', location: { countryCode: 'DE' } },
    { id: 'VIE', code: 'VIE', name: 'Sandbox Wien', timeZone: 'Europe/Vienna', currencyCode: 'EUR', location: { countryCode: 'AT' } },
  ],
  count: 2,
};

export function readLiveFixture(property: LiveProperty, relative: string): unknown {
  return readFixture(`live/${property}/${relative}`);
}

export interface FixtureServerOptions {
  /** Serve the live recordings (properties BER and VIE) instead of Hotel Beispiel. */
  live?: boolean;
  /** Answer a request differently; return undefined to fall through to the fixtures. */
  override?: (request: Request, url: URL) => Response | undefined | Promise<Response | undefined>;
  /** Seconds the issued token is valid. Default 3600. */
  expiresIn?: number;
}

/** A `fetchHandler` that answers like apaleo from the fixture files. */
export function apaleoFixtureHandler(options: FixtureServerOptions = {}) {
  return async (request: Request): Promise<Response | undefined> => {
    const url = new URL(request.url);
    const overridden = await options.override?.(request, url);
    if (overridden) return overridden;
    if (request.method === 'POST' && request.url === TOKEN_URL) {
      return Response.json({ access_token: ACCESS_TOKEN, expires_in: options.expiresIn ?? 3600, token_type: 'Bearer' });
    }
    if (url.origin !== API) return undefined;
    if (request.headers.get('authorization') !== `Bearer ${ACCESS_TOKEN}`) return new Response(null, { status: 401 });
    return apiResponse(request.method, url, options.live === true);
  };
}

function apiResponse(method: string, url: URL, live: boolean): Response | undefined {
  const query = url.searchParams;
  const route = `${method} ${url.pathname}`;
  if (route === 'GET /inventory/v1/properties') {
    if (query.get('pageNumber') !== '1') return noContent();
    return Response.json(live ? LIVE_PROPERTY_LIST : readFixture('properties/page-1.json'));
  }
  const propertyId = query.get('propertyId') ?? '';
  const known: readonly string[] = live ? LIVE_PROPERTIES : [BSP];
  if (!known.includes(propertyId)) return new Response('{"messages":["Property not found"]}', { status: 404 });
  const folder = live ? `live/${propertyId}/` : '';
  if (route === 'GET /finance/v1/accounts/schema') return Response.json(readFixture(`${folder}accounts-schema.json`));
  const daily: Record<string, string> = {
    'POST /finance/v1/accounts/export-gross-daily': 'export-gross-daily',
    'POST /finance/v1/accounts/aggregate-daily': 'aggregate-daily',
  };
  const kind = daily[route];
  if (!kind) return undefined;
  const file = `${folder}${kind}/${query.get('from')}.json`;
  return existsSync(fixturePath(file)) ? Response.json(readFixture(file)) : noContent();
}

/** A 200 response whose body stream fails after the first chunk, like a connection reset. */
export function brokenBody(): Response {
  let sent = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) controller.error(new TypeError('terminated'));
      else {
        sent = true;
        controller.enqueue(new TextEncoder().encode('{"transactions":['));
      }
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** A test context whose network is the fixture server. */
export function createApaleoContext(
  server: FixtureServerOptions = {},
  options: Omit<TestContextOptions, 'fetchHandler'> = {},
): TestContext {
  return createTestContext({
    files: FIXTURE_FILES,
    env: FIXTURE_ENV,
    ...options,
    fetchHandler: apaleoFixtureHandler(server),
  });
}

export interface FixtureSource {
  source: ApaleoSource;
  ctx: TestContext;
  /** Every delay the adapter asked to sleep, in ms. Sleeping is instant in tests. */
  sleeps: number[];
}

/** An `ApaleoSource` against the fixture server, with instant sleeps and a fixed run id. */
export function createFixtureSource(
  server: FixtureServerOptions = {},
  options: Partial<ApaleoSourceOptions> = {},
  ctx: TestContext = createApaleoContext(server),
): FixtureSource {
  const sleeps: number[] = [];
  const source = new ApaleoSource({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    baseUrl: API,
    identityUrl: IDENTITY,
    fetchFn: ctx.fetchFn,
    now: () => ctx.now(),
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0,
    runId: 'run-1',
    ...options,
  });
  return { source, ctx, sleeps };
}

/** The Hotel Beispiel fixtures read through the real apaleo adapter, as canonical `FakeSource` data. */
export async function loadBeispielData(): Promise<FakeSourceData> {
  const { source } = createFixtureSource();
  const [first] = LEDGER_DAYS as [LocalDate];
  return {
    properties: await source.listProperties(),
    charts: { [BSP]: await source.getChartOfAccounts(BSP) },
    ledger: { [BSP]: await source.getLedger(BSP, first, '2026-09-23') },
    totals: { [BSP]: await Promise.all(LEDGER_DAYS.map((day) => source.getAccountTotals(BSP, day))) },
  };
}

/** The live recordings of BER and VIE read through the real apaleo adapter, as canonical `FakeSource` data. */
export async function loadLiveData(): Promise<FakeSourceData> {
  const { source } = createFixtureSource({ live: true });
  const data: FakeSourceData = { properties: await source.listProperties(), charts: {}, ledger: {}, totals: {} };
  const [first, last] = LIVE_DAYS as [LocalDate, LocalDate];
  for (const property of LIVE_PROPERTIES) {
    data.charts[property] = await source.getChartOfAccounts(property);
    data.ledger[property] = await source.getLedger(property, first, nextDay(last));
    (data.totals ??= {})[property] = await Promise.all(LIVE_DAYS.map((day) => source.getAccountTotals(property, day)));
  }
  return data;
}
