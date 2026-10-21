import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/run.js';
import { formatCents } from '../../src/core/money.js';
import { FIXTURE_FILES, createApaleoContext, fixturePath } from '../helpers/apaleo.js';
import { lines, splitFields } from '../helpers/extf.js';

/**
 * The CLI on the recorded apaleo sandbox responses (`test/fixtures/apaleo/live/`)
 * through the fake apaleo API: what v0.1.0 could not read at all.
 */

const decodeCp1252 = (bytes: Uint8Array) => new TextDecoder('windows-1252').decode(bytes);

/** After the recorded days, so both are closed. */
const AFTER_THE_DAY = new Date('2026-10-25T08:00:00Z');
const LIVE_MAPPING = readFileSync(fixturePath('live/BER/mapping-BER.live.csv'), 'utf8');

function liveContext(extraConfig = '', files: Record<string, string> = {}) {
  const config = `${FIXTURE_FILES['apaleo-datev.config.yaml']}  skr: '03'\nproperties:\n  - id: BER\n  - id: VIE\n${extraConfig}`;
  return createApaleoContext({ live: true }, { files: { 'apaleo-datev.config.yaml': config, 'mapping-BER.csv': LIVE_MAPPING, ...files }, now: AFTER_THE_DAY });
}

describe('mapping check on the recorded BER day', () => {
  it('passes with the committed live SKR03 mapping', async () => {
    const ctx = liveContext();
    expect(await runCli(['mapping', 'check', '--property', 'BER', '--from', '2026-10-21', '--to', '2026-10-21'], ctx)).toBe(0);
    expect(ctx.out()).not.toMatch(/sub-cent|not a whole number of cents/);
    expect(ctx.out()).toContain('Result: mapping OK.');
  });
});

describe('export of the recorded BER day 2026-10-21 (full pipeline, aggregate check on)', () => {
  const FILE = 'EXTF_Buchungsstapel_1234567_42_20261021-20261021_BER.csv';

  async function exportBer() {
    const ctx = liveContext('checks:\n  aggregates: true\n');
    const code = await runCli(['export', '--from', '2026-10-21', '--to', '2026-10-21', '--property', 'BER'], ctx);
    return { ctx, code, folder: join(ctx.cwd, 'exports', 'BER', '2026-10') };
  }

  it('writes one file without E- findings or W-AGGREGATE-DIFF: 35 lines, 29 bookings, 6 skipped', async () => {
    const { ctx, code, folder } = await exportBer();
    expect(ctx.err()).toBe('');
    expect(code).toBe(0);
    expect(ctx.out()).not.toMatch(/E-[A-Z-]+|W-AGGREGATE-DIFF/);
    expect(readdirSync(folder).sort()).toEqual([FILE, FILE.replace('.csv', '.protokoll.txt'), 'manifest.json']);
    const protocol = readFileSync(join(folder, FILE.replace('.csv', '.protokoll.txt')), 'utf8');
    expect(protocol).toContain('Property BER, 2026-10-21 to 2026-10-21: 35 apaleo lines, 29 DATEV bookings');
    expect(protocol).toMatch(/both sides on the same DATEV account\s+6\s+331\.60/);
    // The writer validated every booking; the file has the header line, the column line and 29 bookings.
    expect(lines(decodeCp1252(readFileSync(join(folder, FILE))))).toHaveLength(2 + 29);
  });

  it('shows DATEV VAT beside apaleo precise VAT, with one cent of line rounding at 7 % and at 19 % and no E-VAT-TOTAL', async () => {
    const { folder } = await exportBer();
    const protocol = readFileSync(join(folder, FILE.replace('.csv', '.protokoll.txt')), 'utf8');
    expect(protocol).toContain('7 %: gross 571.22, DATEV VAT 37.38, apaleo VAT 37.37, difference 0.01 (apaleo precise 37.3695327)');
    expect(protocol).toContain('19 %: gross 47.38, DATEV VAT 7.57, apaleo VAT 7.56, difference 0.01 (apaleo precise 7.56487395)');
    expect(protocol).toContain('0 %: gross 45.00, DATEV VAT 0.00, apaleo VAT 0.00, difference 0.00');
    expect(protocol).toContain('7 %: gross 218.02, DATEV VAT 14.26, apaleo VAT 14.26, difference 0.00 (apaleo precise 14.26299065)');
    expect(protocol).toContain('19 %: gross 19.98, DATEV VAT 3.19, apaleo VAT 3.19, difference 0.00 (apaleo precise 3.19008404)');
    expect(protocol).toContain('DATEV computes the VAT booking by booking and rounds each to the cent');
    expect(protocol).toContain('Deposits: received 590.00, released 352.00, of it refunded 10.00');
    expect(protocol).toContain('Accounts receivable (collective debtor, Soll positive): 114.00');
    expect(protocol).toMatch(/^ {2}1000 +111\.70$/m);
    expect(protocol).toMatch(/^ {2}1360 +675\.90$/m);
    expect(protocol).toContain('VAT rounding differences: 0.00');
    expect(protocol).not.toContain('E-VAT-TOTAL');
  });

  it('records amountTotal, sollTotal and habenTotal as the same sum of all booking amounts', async () => {
    const { folder } = await exportBer();
    const [entry] = (JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')) as { files: Record<string, unknown>[] }).files;
    const bookings = lines(decodeCp1252(readFileSync(join(folder, FILE)))).slice(2);
    const sum = bookings.reduce((total, line) => total + Math.round(Number((splitFields(line)[0] ?? '').replace(',', '.')) * 100), 0);
    expect(entry).toMatchObject({ bookings: 29, amountTotal: formatCents(sum), sollTotal: formatCents(sum), habenTotal: formatCents(sum) });
  });
});

describe('export of the recorded VIE day (Austrian rates) in the DATEV path', () => {
  it('raises no parse or sub-cent error and stops with E-UNMAPPED for the 13 %, 10 % and 20 % accounts', async () => {
    const ctx = liveContext();
    expect(await runCli(['init-mapping', '--property', 'VIE', '--skr', '03'], ctx)).toBe(0);
    expect(await runCli(['export', '--from', '2026-10-21', '--to', '2026-10-21', '--property', 'VIE'], ctx)).toBe(1);
    const out = ctx.out();
    expect(out).not.toMatch(/sub-cent|not a whole number of cents|does not match its API description/);
    const unmapped = out.split('\n').filter((line) => line.includes('E-UNMAPPED'));
    for (const account of ['RevenueAccommodation_Reduced:13.00', 'RevenueFoodAndBeverages_VeryReduced:10.00', 'RevenueFoodAndBeverages_Normal:20.00', 'RevenueNoShow_Reduced:13.00']) {
      expect(unmapped.some((line) => line.includes(`apaleo account ${account} (Revenues`)), account).toBe(true);
    }
    expect(unmapped.some((line) => /Liabilities accounts of reservations or folios under parent 3000 at 13 %/.test(line))).toBe(true);
    expect(unmapped.some((line) => /Liabilities accounts? of reservations or folios under parent 3000 at 20 %/.test(line))).toBe(true);
    expect(readdirSync(ctx.cwd)).not.toContain('exports');
  });
});
