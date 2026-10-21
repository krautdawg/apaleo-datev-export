import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as nodeFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished } from 'vitest';
import type { CommandContext } from '../../src/cli/context.js';

export const FIXED_NOW = new Date('2026-10-20T08:00:00Z');

/** Canned responses keyed by `"<METHOD> <url>"`, for example `"GET https://api.apaleo.com/..."`. */
export type FetchRoutes = Record<string, (request: Request) => Response | Promise<Response>>;

export interface TestContextOptions {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetchRoutes?: FetchRoutes;
  /** Called for requests without an exact route; returning undefined fails the request like a missing route. */
  fetchHandler?: (request: Request) => Response | undefined | Promise<Response | undefined>;
  /** Files to create in the temporary working directory, relative path to content. */
  files?: Record<string, string>;
  sourceFactory?: CommandContext['sourceFactory'];
}

export interface TestContext extends CommandContext {
  /** Everything written to stdout so far. */
  readonly out: () => string;
  /** Everything written to stderr so far. */
  readonly err: () => string;
  /** Every fetch call, in order, as `"<METHOD> <url>"`. */
  readonly fetchCalls: string[];
}

/**
 * A fake `CommandContext`: captured stdout and stderr, a fixed clock, a fetch
 * stub that throws on any URL without a route, and a fresh temporary working
 * directory (removed after the test) for real file system access.
 */
export function createTestContext(options: TestContextOptions = {}): TestContext {
  const cwd = mkdtempSync(join(tmpdir(), 'apaleo-datev-test-'));
  try {
    onTestFinished(() => rmSync(cwd, { recursive: true, force: true }));
  } catch {
    // Called outside a running test: the OS cleans the temp dir eventually.
  }
  for (const [relative, content] of Object.entries(options.files ?? {})) {
    const path = join(cwd, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }

  let stdout = '';
  let stderr = '';
  const fetchCalls: string[] = [];
  const routes = options.fetchRoutes ?? {};
  const now = options.now ?? FIXED_NOW;

  const fetchFn: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const key = `${request.method} ${request.url}`;
    fetchCalls.push(key);
    const route = routes[key];
    if (route) return route(request);
    const handled = await options.fetchHandler?.(request);
    if (!handled) throw new Error(`Unexpected fetch in test: ${key}`);
    return handled;
  };

  const ctx: TestContext = {
    env: { ...options.env },
    stdout: { write: (text) => void (stdout += text) },
    stderr: { write: (text) => void (stderr += text) },
    cwd,
    now: () => new Date(now.getTime()),
    fetchFn,
    fs: nodeFs,
    out: () => stdout,
    err: () => stderr,
    fetchCalls,
  };
  if (options.sourceFactory) ctx.sourceFactory = options.sourceFactory;
  return ctx;
}
