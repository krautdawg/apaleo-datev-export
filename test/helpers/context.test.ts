import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXED_NOW, createTestContext } from './context.js';

describe('createTestContext', () => {
  it('captures stdout and stderr separately', () => {
    const ctx = createTestContext();
    ctx.stdout.write('hello ');
    ctx.stdout.write('world');
    ctx.stderr.write('oops');
    expect(ctx.out()).toBe('hello world');
    expect(ctx.err()).toBe('oops');
  });

  it('has a fixed clock that callers cannot mutate', () => {
    const ctx = createTestContext();
    const first = ctx.now();
    first.setFullYear(1999);
    expect(ctx.now().toISOString()).toBe(FIXED_NOW.toISOString());
    expect(createTestContext({ now: new Date('2025-01-01T00:00:00Z') }).now().toISOString()).toBe(
      '2025-01-01T00:00:00.000Z',
    );
  });

  it('throws on any fetch without a route and records the call', async () => {
    const ctx = createTestContext();
    await expect(ctx.fetchFn('https://example.invalid/x')).rejects.toThrow(
      'Unexpected fetch in test: GET https://example.invalid/x',
    );
    expect(ctx.fetchCalls).toEqual(['GET https://example.invalid/x']);
  });

  it('answers fetch calls that have a route', async () => {
    const ctx = createTestContext({
      fetchRoutes: { 'POST https://example.invalid/token': () => Response.json({ ok: true }) },
    });
    const response = await ctx.fetchFn('https://example.invalid/token', { method: 'POST' });
    expect(await response.json()).toEqual({ ok: true });
  });

  it('works in a fresh temporary directory with the given files', async () => {
    const ctx = createTestContext({ files: { 'nested/a.txt': 'content' }, env: { A: '1' } });
    expect(await ctx.fs.readFile(join(ctx.cwd, 'nested/a.txt'), 'utf8')).toBe('content');
    expect(ctx.env).toEqual({ A: '1' });
    expect(createTestContext().cwd).not.toBe(ctx.cwd);
    expect(existsSync(join(createTestContext().cwd, 'nested'))).toBe(false);
  });
});
