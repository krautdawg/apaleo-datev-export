// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** PMS-neutral modules: they must never depend on a source adapter. */
export const CORE_MODULES = ['src/core/**', 'src/datev/**', 'src/mapping/**', 'src/posting/**'];

/**
 * Code that must get the clock, network and environment from the CommandContext:
 * everything in src except the CLI entry point and context factory (src/cli/*.ts).
 */
export const CONTEXT_ONLY_MODULES = [
  'src/cli/commands/**',
  'src/demo/**',
  'src/export/**',
  'src/schedule/**',
  'src/sources/**',
  ...CORE_MODULES,
];

const USE_CONTEXT = 'use the injected CommandContext (ctx.now, ctx.fetchFn, ctx.env) instead';

/** Importing the process module would reach process.env under another name. */
const PROCESS_IMPORTS = ['process', 'node:process'].map((name) => ({
  name,
  message: `Importing ${name}: ${USE_CONTEXT}. The global process (for example process.version) stays available.`,
}));

const SOURCE_IMPORT_PATTERNS = [
  {
    group: ['**/sources', '**/sources/**'],
    message:
      'Core modules (core, datev, mapping, posting) must not import source adapters. Wire sources in src/export or src/cli.',
  },
];

/**
 * no-restricted-properties also matches computed access (process['env']) and
 * destructuring (const { env } = process). The global-object entries close
 * globalThis.Date.now(), new globalThis.Date() and globalThis.fetch.
 */
const CONTEXT_PROPERTIES = [
  { object: 'process', property: 'env', message: `process.env: ${USE_CONTEXT}.` },
  { object: 'Date', property: 'now', message: `Date.now(): ${USE_CONTEXT}.` },
  ...['globalThis', 'global'].flatMap((object) =>
    ['fetch', 'Date', 'process'].map((property) => ({
      object,
      property,
      message: `${object}.${property}: ${USE_CONTEXT}.`,
    })),
  ),
];

export default defineConfig(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'test/fixtures/'] },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    files: CONTEXT_ONLY_MODULES,
    rules: {
      'no-restricted-imports': ['error', { paths: PROCESS_IMPORTS }],
      'no-restricted-globals': ['error', { name: 'fetch', message: `Bare fetch: ${USE_CONTEXT}.` }],
      'no-restricted-properties': ['error', ...CONTEXT_PROPERTIES],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: `new Date() without arguments: ${USE_CONTEXT}.`,
        },
        {
          selector: "CallExpression[callee.name='Date']",
          message: `Date() returns the current time: ${USE_CONTEXT}.`,
        },
      ],
    },
  },
  {
    // Comes after the context block: rule options are replaced, not merged,
    // so core modules repeat the process import restriction.
    files: CORE_MODULES,
    rules: {
      'no-restricted-imports': ['error', { paths: PROCESS_IMPORTS, patterns: SOURCE_IMPORT_PATTERNS }],
    },
  },
);
