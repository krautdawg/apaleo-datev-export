import * as nodeFs from 'node:fs/promises';
import type { LoadedConfig } from '../core/config.js';
import type { SourceAdapter } from '../core/source.js';

export type ContextFs = Pick<
  typeof nodeFs,
  'readFile' | 'writeFile' | 'mkdir' | 'rename' | 'readdir' | 'stat' | 'rm'
>;

export interface OutputStream {
  write(text: string): void;
}

/**
 * Every side effect a command may have goes through this context: environment,
 * output, working directory, clock, network and file system. Tests build a fake
 * one with `createTestContext()` from `test/helpers/context.ts`.
 */
export interface CommandContext {
  env: Readonly<Record<string, string | undefined>>;
  stdout: OutputStream;
  stderr: OutputStream;
  cwd: string;
  /** The only clock. Never call `new Date()` or `Date.now()` in commands. */
  now(): Date;
  /** The only network access. */
  fetchFn: typeof fetch;
  fs: ContextFs;
  /** Builds the source adapter for a loaded config. Unset means apaleo; tests pass a `FakeSource`. */
  sourceFactory?: (loaded: LoadedConfig, ctx: CommandContext) => SourceAdapter;
}

/** The real context used by the installed binary. */
export function createNodeContext(): CommandContext {
  return {
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
    now: () => new Date(),
    fetchFn: globalThis.fetch.bind(globalThis),
    fs: {
      readFile: nodeFs.readFile,
      writeFile: nodeFs.writeFile,
      mkdir: nodeFs.mkdir,
      rename: nodeFs.rename,
      readdir: nodeFs.readdir,
      stat: nodeFs.stat,
      rm: nodeFs.rm,
    },
  };
}
