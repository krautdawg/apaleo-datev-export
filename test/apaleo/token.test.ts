import { describe, expect, it } from 'vitest';
import { ApaleoError } from '../../src/sources/apaleo/errors.js';
import {
  ACCESS_TOKEN,
  BSP,
  CLIENT_ID,
  CLIENT_SECRET,
  TOKEN_URL,
  brokenBody,
  createApaleoContext,
  createFixtureSource,
} from '../helpers/apaleo.js';

const tokenCalls = (calls: string[]) => calls.filter((call) => call === `POST ${TOKEN_URL}`).length;

describe('client-credentials token', () => {
  it('sends client_credentials with client_secret_basic and no scope by default', async () => {
    const requests: Request[] = [];
    const { source } = createFixtureSource({
      override: (request) => void (request.url === TOKEN_URL && requests.push(request.clone())),
    });
    await source.authenticate();
    const [request] = requests as [Request];
    const expected = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    expect(request.headers.get('authorization')).toBe(`Basic ${expected}`);
    expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(await request.text()).toBe('grant_type=client_credentials');
  });

  it('sends the configured scopes', async () => {
    const bodies: string[] = [];
    const { source } = createFixtureSource(
      { override: async (request) => void (request.url === TOKEN_URL && bodies.push(await request.clone().text())) },
      { scopes: 'accounting.read' },
    );
    await source.authenticate();
    expect(bodies).toEqual(['grant_type=client_credentials&scope=accounting.read']);
  });

  it('reuses the token for two API calls within its lifetime', async () => {
    const { source, ctx } = createFixtureSource();
    await source.getChartOfAccounts(BSP);
    await source.getChartOfAccounts(BSP);
    expect(tokenCalls(ctx.fetchCalls)).toBe(1);
  });

  it('shares one token request between parallel calls', async () => {
    const { source, ctx } = createFixtureSource();
    await Promise.all([source.getChartOfAccounts(BSP), source.listProperties()]);
    expect(tokenCalls(ctx.fetchCalls)).toBe(1);
  });

  it('renews the token 60 seconds before it expires', async () => {
    let now = new Date('2026-10-20T08:00:00Z');
    const ctx = createApaleoContext({ expiresIn: 300 });
    const { source } = createFixtureSource({}, { now: () => now }, ctx);
    await source.getChartOfAccounts(BSP);
    now = new Date('2026-10-20T08:03:59Z');
    await source.getChartOfAccounts(BSP);
    expect(tokenCalls(ctx.fetchCalls)).toBe(1);
    now = new Date('2026-10-20T08:04:00Z');
    await source.getChartOfAccounts(BSP);
    expect(tokenCalls(ctx.fetchCalls)).toBe(2);
  });

  it.each([400, 401])('explains rejected credentials (HTTP %d) without the secret', async (code) => {
    const { source } = createFixtureSource({
      override: (request) =>
        request.url === TOKEN_URL ? Response.json({ error: 'invalid_client', secret: CLIENT_SECRET }, { status: code }) : undefined,
    });
    const error = await source.authenticate().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApaleoError);
    const message = (error as Error).message;
    expect(message).toContain(`apaleo did not accept the client credentials (HTTP ${code}, invalid_client)`);
    expect(message).toContain('APALEO_CLIENT_SECRET');
    expect(message).toContain('custom app is active');
    expect(message).not.toContain(CLIENT_SECRET);
  });

  it('retries the token endpoint on server errors', async () => {
    let failures = 1;
    const { source, sleeps } = createFixtureSource({
      override: (request) => (request.url === TOKEN_URL && failures-- > 0 ? new Response(null, { status: 503 }) : undefined),
    });
    await source.authenticate();
    expect(sleeps).toEqual([1000]);
  });

  it('retries the token request when its body breaks off', async () => {
    let failures = 1;
    const { source, sleeps } = createFixtureSource({
      override: (request) => (request.url === TOKEN_URL && failures-- > 0 ? brokenBody() : undefined),
    });
    await source.authenticate();
    expect(sleeps).toEqual([1000]);
  });

  it('fails clearly on a token response without access_token', async () => {
    const { source } = createFixtureSource({
      override: (request) => (request.url === TOKEN_URL ? Response.json({ expires_in: 3600 }) : undefined),
    });
    await expect(source.authenticate()).rejects.toThrow('the token response has no access_token or expires_in');
  });

  it('sends the cached token as a bearer token', async () => {
    const auth: (string | null)[] = [];
    const { source } = createFixtureSource({
      override: (request) => void (request.url !== TOKEN_URL && auth.push(request.headers.get('authorization'))),
    });
    await source.getChartOfAccounts(BSP);
    expect(auth).toEqual([`Bearer ${ACCESS_TOKEN}`]);
  });
});
