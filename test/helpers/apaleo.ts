import { existsSync, readFileSync } from 'node:fs';
import type { LocalDate } from '../../src/core/date.js';
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

export interface FixtureServerOptions {
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
    return apiResponse(request.method, url);
  };
}

function apiResponse(method: string, url: URL): Response | undefined {
  const query = url.searchParams;
  const route = `${method} ${url.pathname}`;
  if (route === 'GET /inventory/v1/properties') {
    return query.get('pageNumber') === '1' ? Response.json(readFixture('properties/page-1.json')) : noContent();
  }
  if (query.get('propertyId') !== BSP) return new Response('{"messages":["Property not found"]}', { status: 404 });
  if (route === 'GET /finance/v1/accounts/schema') return Response.json(readFixture('accounts-schema.json'));
  const daily: Record<string, string> = {
    'POST /finance/v1/accounts/export-gross-daily': 'export-gross-daily',
    'POST /finance/v1/accounts/aggregate-daily': 'aggregate-daily',
  };
  const folder = daily[route];
  if (!folder) return undefined;
  const file = `${folder}/${query.get('from')}.json`;
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
