import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/run.js';
import { CLIENT_SECRET, FIXTURE_FILES, TOKEN_URL, createApaleoContext } from '../helpers/apaleo.js';
import { createTestContext } from '../helpers/context.js';
import { FakeSource } from '../helpers/fake-source.js';

describe('apaleo-datev properties', () => {
  it('prints one line per property with id, code, name, time zone and currency', async () => {
    const ctx = createApaleoContext();
    expect(await runCli(['properties'], ctx)).toBe(0);
    const lines = ctx.out().trimEnd().split('\n');
    expect(lines[0]).toMatch(/^ID\s+CODE\s+NAME\s+TIME ZONE\s+CURRENCY$/);
    expect(lines.slice(1).map((l) => l.split(/\s{2,}/))).toEqual([
      ['BSP', 'BSP', 'Hotel Beispiel', 'Europe/Berlin', 'EUR'],
      ['HBW', 'HBW', 'Hotel Beispiel Wien', 'Europe/Vienna', 'EUR'],
    ]);
    expect(ctx.err()).toBe('');
  });

  it('uses ctx.sourceFactory when a test supplies one', async () => {
    const fake = new FakeSource({
      properties: [{ id: 'X1', code: 'X1', name: 'Fake Hotel', timeZone: 'UTC', currency: 'CHF' }],
      charts: {},
      ledger: {},
    });
    const ctx = createTestContext({ files: FIXTURE_FILES, sourceFactory: () => fake });
    expect(await runCli(['properties'], ctx)).toBe(0);
    expect(ctx.out()).toMatch(/X1\s+X1\s+Fake Hotel\s+UTC\s+CHF/);
    expect(ctx.fetchCalls).toEqual([]);
  });

  it('says so when the custom app sees no property', async () => {
    const ctx = createTestContext({
      files: FIXTURE_FILES,
      sourceFactory: () => new FakeSource({ properties: [], charts: {}, ledger: {} }),
    });
    expect(await runCli(['properties'], ctx)).toBe(0);
    expect(ctx.out()).toContain('No properties found');
  });

  it.each([400, 401])('exits 1 with a credentials hint when the token endpoint answers %d', async (status) => {
    const ctx = createApaleoContext({
      override: (request) => (request.url === TOKEN_URL ? Response.json({ error: 'invalid_client' }, { status }) : undefined),
    });
    expect(await runCli(['properties'], ctx)).toBe(1);
    expect(ctx.err()).toContain('apaleo did not accept the client credentials');
    expect(ctx.err()).toContain('Check apaleo.clientId');
    expect(ctx.err()).toContain('custom app is active');
    expect(ctx.out() + ctx.err()).not.toContain(CLIENT_SECRET);
  });

  it('exits 1 without any network call when the secret is missing', async () => {
    const ctx = createApaleoContext({}, { env: {} });
    expect(await runCli(['properties'], ctx)).toBe(1);
    expect(ctx.err()).toContain('APALEO_CLIENT_SECRET is not set');
    expect(ctx.fetchCalls).toEqual([]);
  });

  it('exits 1 without any network call when the client id is missing', async () => {
    const ctx = createApaleoContext(
      {},
      { files: { 'apaleo-datev.config.yaml': 'datev:\n  beraternummer: 1234567\n  mandantennummer: 42\n' } },
    );
    expect(await runCli(['properties'], ctx)).toBe(1);
    expect(ctx.err()).toContain('apaleo.clientId is not set');
    expect(ctx.err()).toContain('APALEO_CLIENT_ID');
    expect(ctx.fetchCalls).toEqual([]);
  });
});
