import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXIT_OK, type Command } from '../../src/cli/command.js';
import { COMMANDS } from '../../src/cli/commands/index.js';
import { runCli } from '../../src/cli/run.js';
import { UsageError, UserError } from '../../src/core/errors.js';
import { createTestContext } from '../helpers/context.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

function fakeCommand(run: Command['run'], extra: Partial<Command> = {}): Command {
  return { name: 'fake', summary: 'A fake command', usage: '[--name <n>]', options: {}, run, ...extra };
}

describe('help and version', () => {
  it.each([['--help'], ['-h'], []])('prints help for %j with every command and the disclaimer', async (...argv) => {
    const ctx = createTestContext();
    expect(await runCli(argv, ctx)).toBe(0);
    for (const command of COMMANDS) {
      const line = ctx.out().split('\n').find((l) => l.startsWith(`  ${command.name} `));
      expect(line?.trim().replace(/\s+/, ' ')).toBe(`${command.name} ${command.summary}`);
    }
    expect(ctx.out()).toContain('DISCLAIMER.md');
    expect(ctx.out()).toContain('Usage: apaleo-datev <command> [options]');
  });

  it('prints the version from package.json', async () => {
    const ctx = createTestContext();
    expect(await runCli(['--version'], ctx)).toBe(0);
    expect(ctx.out()).toBe(`${pkg.version}\n`);
  });

  it('prints command help with its options', async () => {
    const ctx = createTestContext();
    expect(await runCli(['doctor', '--help'], ctx)).toBe(0);
    expect(ctx.out()).toContain('Usage: apaleo-datev doctor [--config <path>]');
    expect(ctx.out()).toMatch(/--config <path>\s+Config file/);
    expect(ctx.out()).toMatch(/-h, --help\s+Show help/);
  });
});

describe('dispatch and exit codes', () => {
  it('exits 2 for an unknown command and names it', async () => {
    const ctx = createTestContext();
    expect(await runCli(['frobnicate'], ctx)).toBe(2);
    expect(ctx.err()).toContain('Unknown command "frobnicate"');
    expect(ctx.err()).toContain('apaleo-datev --help');
  });

  it('exits 2 for an unknown top-level option', async () => {
    const ctx = createTestContext();
    expect(await runCli(['--frobnicate'], ctx)).toBe(2);
    expect(ctx.err()).toContain('Unknown option "--frobnicate"');
  });

  it('exits 2 for an unknown flag and names the flag', async () => {
    const ctx = createTestContext();
    expect(await runCli(['doctor', '--nope'], ctx)).toBe(2);
    expect(ctx.err()).toContain('--nope');
    expect(ctx.err()).toContain('apaleo-datev doctor --help');
  });

  it('exits 2 for an unexpected positional argument', async () => {
    const ctx = createTestContext();
    expect(await runCli(['doctor', 'extra'], ctx)).toBe(2);
    expect(ctx.err()).toContain('extra');
  });

  it('exits 2 when a command reports a usage error', async () => {
    const command = fakeCommand(async () => {
      throw new UsageError('--month and --from cannot be combined');
    });
    const ctx = createTestContext();
    expect(await runCli(['fake'], ctx, [command])).toBe(2);
    expect(ctx.err()).toBe('Error: --month and --from cannot be combined\n');
  });

  it('passes parsed options to the command', async () => {
    const run = vi.fn<Command['run']>(async () => EXIT_OK);
    const command = fakeCommand(run, {
      options: { name: { type: 'string', description: 'A name' } },
      allowPositionals: true,
    });
    const ctx = createTestContext();
    expect(await runCli(['fake', '--name', 'BER', 'pos'], ctx, [command])).toBe(0);
    expect(run.mock.calls[0]?.[0]).toEqual({ values: { name: 'BER' }, positionals: ['pos'] });
  });

  it('returns the exit code of the command', async () => {
    const ctx = createTestContext();
    expect(await runCli(['fake'], ctx, [fakeCommand(async () => 1)])).toBe(1);
  });
});

describe('runtime failures', () => {
  const failing = fakeCommand(async () => {
    throw new UserError('3 apaleo accounts are not mapped');
  });

  it('prints a user error without a stack trace and exits 1', async () => {
    const ctx = createTestContext();
    expect(await runCli(['fake'], ctx, [failing])).toBe(1);
    expect(ctx.err()).toBe('Error: 3 apaleo accounts are not mapped\n');
  });

  it('prints the stack trace with --debug', async () => {
    const ctx = createTestContext();
    expect(await runCli(['fake', '--debug'], ctx, [failing])).toBe(1);
    expect(ctx.err()).toContain('Error: 3 apaleo accounts are not mapped');
    expect(ctx.err()).toMatch(/\n\s+at /);
  });

  it('reports an unexpected error without a stack and hints at --debug', async () => {
    const ctx = createTestContext();
    const broken = fakeCommand(async () => {
      throw new TypeError('x is undefined');
    });
    expect(await runCli(['fake'], ctx, [broken])).toBe(1);
    expect(ctx.err()).toBe('Unexpected error: x is undefined\nRun again with --debug to see the stack trace.\n');
  });
});

describe('injected context', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs doctor against a fake context without network or real clock', async () => {
    vi.useFakeTimers({ now: new Date('2001-02-03T04:05:06Z') });
    const ctx = createTestContext({
      now: new Date('2026-10-20T08:00:00Z'),
      fetchRoutes: {},
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect(await runCli(['doctor'], ctx)).toBe(0);

    expect(ctx.out()).toContain(`${ctx.cwd}/apaleo-datev.config.yaml`);
    expect(ctx.out()).toContain('not found');
    expect(ctx.out()).toContain('Clock:         2026-10-20T08:00:00.000Z');
    expect(ctx.out()).not.toContain('2001');
    expect(ctx.fetchCalls).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('output depends only on the context clock', async () => {
    const runAt = async (iso: string) => {
      const ctx = createTestContext({ now: new Date(iso) });
      await runCli(['doctor'], ctx);
      return ctx.out().replace(ctx.cwd, '<cwd>');
    };
    const a = await runAt('2026-01-01T00:00:00Z');
    expect(await runAt('2026-01-01T00:00:00Z')).toBe(a);
    expect(await runAt('2026-06-30T12:00:00Z')).toContain('2026-06-30T12:00:00.000Z');
  });

  it('doctor reports a valid config and whether the secret is set', async () => {
    const ctx = createTestContext({
      files: { 'conf/my.yaml': 'datev:\n  beraternummer: 1234567\n  mandantennummer: 42\n' },
      env: { APALEO_CLIENT_SECRET: 's3cr3t' },
    });
    expect(await runCli(['doctor', '--config', 'conf/my.yaml'], ctx)).toBe(0);
    expect(ctx.out()).toContain(`${ctx.cwd}/conf/my.yaml`);
    expect(ctx.out()).toContain('Config:        valid');
    expect(ctx.out()).toContain('Client id:     not set (apaleo.clientId or APALEO_CLIENT_ID)');
    expect(ctx.out()).toContain('Client secret: set (APALEO_CLIENT_SECRET)');
    expect(ctx.out()).not.toContain('s3cr3t');
  });

  it('doctor rejects the unedited example config instead of reporting it valid', async () => {
    const example = readFileSync(new URL('../../apaleo-datev.config.example.yaml', import.meta.url), 'utf8');
    const ctx = createTestContext({ files: { 'apaleo-datev.config.yaml': example } });
    expect(await runCli(['doctor'], ctx)).toBe(1);
    expect(ctx.out()).not.toContain('Config:        valid');
    expect(ctx.err()).toContain('datev.beraternummer: is required');
    expect(ctx.err()).toContain('datev.mandantennummer: is required');
  });

  it('doctor exits 1 for an invalid config', async () => {
    const ctx = createTestContext({
      files: { 'apaleo-datev.config.yaml': 'datev:\n  beraternummer: 12\n  mandantennummer: 42\n' },
    });
    expect(await runCli(['doctor'], ctx)).toBe(1);
    expect(ctx.err()).toContain('datev.beraternummer');
  });
});
