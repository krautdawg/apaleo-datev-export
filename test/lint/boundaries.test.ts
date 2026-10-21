import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const eslint = new ESLint({ cwd: root });

/** Lints a fixture as if it were the file at `filePath` inside the repository. */
async function lintAs(fixture: string, filePath: string) {
  const code = readFileSync(new URL(`../fixtures/lint/${fixture}`, import.meta.url), 'utf8');
  const [result] = await eslint.lintText(code, { filePath: `${root}${filePath}` });
  return (result?.messages ?? []).map((m) => ({ rule: m.ruleId, message: m.message }));
}

describe('core modules do not import source adapters', () => {
  it.each(['src/datev/writer.ts', 'src/core/x.ts', 'src/mapping/x.ts', 'src/posting/x.ts'])(
    'reports no-restricted-imports in %s',
    async (filePath) => {
      const messages = await lintAs('forbidden-source-import.ts', filePath);
      expect(messages).toContainEqual(
        expect.objectContaining({ rule: 'no-restricted-imports', message: expect.stringContaining('source adapters') }),
      );
    },
  );

  it('allows the same import from src/export', async () => {
    expect(await lintAs('forbidden-source-import.ts', 'src/export/pipeline.ts')).toEqual([]);
  });
});

describe('commands use the injected context', () => {
  const CONTEXT_ONLY_FILES = [
    'src/cli/commands/x.ts',
    'src/demo/x.ts',
    'src/export/x.ts',
    'src/schedule/x.ts',
    'src/sources/apaleo/client.ts',
    'src/core/x.ts',
    'src/datev/x.ts',
    'src/mapping/x.ts',
    'src/posting/x.ts',
  ];

  it.each(CONTEXT_ONLY_FILES)('reports every clock, network and environment bypass in %s', async (filePath) => {
    const messages = await lintAs('bypasses-context.ts', filePath);
    const rules = new Set(['no-restricted-imports', 'no-restricted-globals', 'no-restricted-properties', 'no-restricted-syntax']);
    expect(messages.every((m) => rules.has(m.rule ?? ''))).toBe(true);
    expect(messages.map((m) => m.message)).toEqual([
      expect.stringContaining("'node:process' import is restricted"),
      expect.stringContaining("'process' import is restricted"),
      expect.stringContaining('Bare fetch'),
      expect.stringContaining('Date.now()'),
      expect.stringContaining('new Date() without arguments'),
      expect.stringContaining('process.env'), // process.env.TZ
      expect.stringContaining('process.env'), // process['env'].TZ
      expect.stringContaining('process.env'), // const { env: renamed } = process
      expect.stringContaining('globalThis.Date'), // globalThis.Date.now()
      expect.stringContaining('globalThis.Date'), // new globalThis.Date()
      expect.stringContaining('globalThis.fetch'),
      expect.stringContaining('Date() returns the current time'),
    ]);
  });

  it('keeps the source-adapter import ban in core modules next to the process import ban', async () => {
    const messages = await lintAs('forbidden-source-import.ts', 'src/posting/x.ts');
    expect(messages).toContainEqual(expect.objectContaining({ message: expect.stringContaining('source adapters') }));
    const bypasses = await lintAs('bypasses-context.ts', 'src/posting/x.ts');
    expect(bypasses).toContainEqual(expect.objectContaining({ message: expect.stringContaining("'node:process' import") }));
  });

  it('allows context access and new Date(value)', async () => {
    expect(await lintAs('uses-context.ts', 'src/cli/commands/x.ts')).toEqual([]);
    expect(await lintAs('uses-context.ts', 'src/sources/apaleo/client.ts')).toEqual([]);
  });

  it('does not restrict the context factory in src/cli', async () => {
    expect(await lintAs('bypasses-context.ts', 'src/cli/context-like.ts')).toEqual([]);
  });
});
