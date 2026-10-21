import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/run.js';
import { bodyOf, fileSystemFinding } from '../../src/export/index.js';
import { createTestContext } from '../helpers/context.js';
import { splitFields } from '../helpers/extf.js';

/** The demo marks its file name with `_DEMO`, so it never looks like a real export in a file list. */
const FILE = 'EXTF_Buchungsstapel_1234567_42_20260901-20260930_BSP_DEMO.csv';
const PROTOCOL = 'EXTF_Buchungsstapel_1234567_42_20260901-20260930_BSP_DEMO.protokoll.txt';
const GOLDEN = readFileSync(new URL('../golden/export/EXTF_Buchungsstapel_1234567_42_20260901-20260930_BSP.csv', import.meta.url));

/** No config file, no secret, and a fetch stub that throws on every request. */
function bareContext(env: Record<string, string> = {}) {
  return createTestContext({ env, fetchHandler: () => Promise.reject(new Error('the demo must not use the network')) });
}

describe('apaleo-datev export --demo', () => {
  it('runs the dry run on the bundled data without config, secret or network and marks it DEMO', async () => {
    const ctx = bareContext();
    expect(await runCli(['export', '--month', '2026-09', '--demo', '--dry-run'], ctx)).toBe(0);
    const out = ctx.out();
    expect(out.startsWith('DEMO: bundled sample data of the fabricated "Hotel Beispiel"')).toBe(true);
    expect(out).toContain('Property BSP, 2026-09-01 to 2026-09-30: 25 apaleo lines, 22 DATEV bookings');
    expect(out).toContain('Totals per DATEV account:');
    expect(out).toContain('File: a real run writes demo-output/BSP/2026-09/');
    expect(out).toContain('DEMO Result: dry run, nothing written; 1 file(s) passed every check.');
    expect(out).not.toContain('W-RECENT-DAY');
    expect(ctx.fetchCalls).toEqual([]);
    expect(ctx.err()).toBe('');
    expect(readdirSync(ctx.cwd)).toEqual([]);
  });

  it('does not count a month without bookings as a file that passed every check', async () => {
    const ctx = bareContext();
    expect(await runCli(['export', '--month', '2026-08', '--demo', '--dry-run'], ctx)).toBe(0);
    expect(ctx.out()).toContain('N-NO-BOOKINGS');
    expect(ctx.out()).toContain('DEMO Result: dry run, nothing written; 0 file(s) passed every check. 1 without bookings.');
  });

  it('writes the same bookings as the golden file into ./demo-output only, with DEMO in the Bezeichnung and the protocol', async () => {
    // A variable that would redirect a real export must not move the demo output.
    const ctx = bareContext({ APALEO_DATEV_OUTPUT_DIR: 'exports' });
    expect(await runCli(['export', '--month', '2026-09', '--demo'], ctx)).toBe(0);
    expect(readdirSync(ctx.cwd)).toEqual(['demo-output']);
    const folder = join(ctx.cwd, 'demo-output', 'BSP', '2026-09');
    expect(readdirSync(folder).sort()).toEqual([FILE, PROTOCOL, 'manifest.json']);

    const file = readFileSync(join(folder, FILE));
    expect(Buffer.from(bodyOf(file)).equals(Buffer.from(bodyOf(GOLDEN)))).toBe(true);
    const header = splitFields(new TextDecoder('windows-1252').decode(file).split('\r\n')[0] ?? '');
    expect(header[16]).toBe('"DEMO apaleo BSP 2026-09"');
    expect(header[5]?.startsWith('20261005')).toBe(true);
    expect(readFileSync(join(folder, PROTOCOL), 'utf8').split('\n')[0]).toMatch(/^DEMO: /);
    expect(ctx.fetchCalls).toEqual([]);

    // Running the demo again finds its own file and changes nothing.
    expect(await runCli(['export', '--month', '2026-09', '--demo'], ctx)).toBe(0);
    expect(readdirSync(folder).sort()).toEqual([FILE, PROTOCOL, 'manifest.json']);
  });

  it('names the working directory, not ./data, when the demo folder is not writable', () => {
    const error = Object.assign(new Error("EACCES: permission denied, mkdir '/config/demo-output'"), { code: 'EACCES' });
    const finding = fileSystemFinding(error, '/config/demo-output', true);
    expect(finding.code).toBe('E-EXPORT');
    expect(finding.message).toContain('The demo writes into /config/demo-output');
    expect(finding.message).toContain('add -w /data');
    expect(finding.message).not.toContain('chown -R 1000:1000 data');
  });

  it('refuses --config, because the demo brings its own', async () => {
    const ctx = bareContext();
    expect(await runCli(['export', '--month', '2026-09', '--demo', '--config', 'mine.yaml'], ctx)).toBe(2);
    expect(ctx.err()).toContain('--demo brings its own config');
  });

  it('refuses a month that is not closed on the demo clock (2026-10-05)', async () => {
    const ctx = bareContext();
    expect(await runCli(['export', '--month', '2026-10', '--demo', '--dry-run'], ctx)).toBe(1);
    expect(ctx.out()).toContain('E-DAY-NOT-CLOSED');
    expect(existsSync(join(ctx.cwd, 'demo-output'))).toBe(false);
  });
});
