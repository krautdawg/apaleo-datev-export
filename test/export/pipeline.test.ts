import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/core/config.js';
import { runExport, type ExportRequest } from '../../src/export/index.js';
import { buildBookings } from '../../src/posting/index.js';
import { ApaleoPermissionError } from '../../src/sources/apaleo/index.js';
import { BSP } from '../helpers/apaleo.js';
import { splitFields } from '../helpers/extf.js';
import { addSecondProperty, exportConfig, exportSetup, type ExportSetup } from '../helpers/export.js';

const SEPTEMBER = { from: '2026-09-01', to: '2026-09-30' } as const;

async function run(setup: ExportSetup, request: Partial<ExportRequest> = {}, post?: typeof buildBookings) {
  const { ctx, fake } = setup;
  const loaded = await loadConfig({ path: join(ctx.cwd, 'apaleo-datev.config.yaml'), env: ctx.env, readFile: ctx.fs.readFile });
  const full: ExportRequest = { period: SEPTEMBER, propertyIds: [BSP], dryRun: false, overwrite: false, ...request };
  return runExport(full, { loaded, source: fake, ctx, ...(post ? { post } : {}) });
}

const exportsOf = (setup: ExportSetup) => join(setup.ctx.cwd, 'exports');
const header = (path: string) => splitFields(new TextDecoder('windows-1252').decode(readFileSync(path)).split('\r\n')[0] ?? '');

describe('the period-part runner', () => {
  it('fetches the chart once per property and the ledger once per month through the source', async () => {
    const setup = exportSetup();
    const outcomes = await run(setup, { period: { from: '2026-08-25', to: '2026-09-30' } });
    expect(outcomes.map((o) => [o.part.month, o.status])).toEqual([
      ['2026-08', 'empty'],
      ['2026-09', 'written'],
    ]);
    expect(setup.fake.calls).toEqual([
      'listProperties',
      'getChartOfAccounts BSP',
      'getLedger BSP 2026-08-25 2026-09-01',
      'getLedger BSP 2026-09-01 2026-10-01',
    ]);
    expect(outcomes[0]?.findings.map((f) => f.code)).toEqual(['N-NO-BOOKINGS']);
  });

  it('renders the bookings through the writer with the DATEV profile in the header', async () => {
    const setup = exportSetup({
      config: exportConfig('    mandantennummer: 43').replace('mandantennummer: 42\n', 'mandantennummer: 42\n  festschreibung: 1\n'),
    });
    const [outcome] = await run(setup);
    expect(outcome?.status).toBe('written');
    expect(outcome?.bookings).toBe(22);
    const path = join(exportsOf(setup), BSP, '2026-09', 'EXTF_Buchungsstapel_1234567_43_20260901-20260930_BSP.csv');
    expect(outcome?.path).toBe(path);
    const fields = header(path);
    expect(fields.slice(10, 21)).toEqual(['1234567', '43', '20260101', '4', '20260901', '20260930', '"apaleo BSP 2026-09"', '""', '1', '0', '1']);
    expect(fields[26]).toBe('"03"');
    const text = new TextDecoder('windows-1252').decode(readFileSync(path));
    expect(text.split('\r\n')).toHaveLength(2 + 22 + 1);
    expect(text).not.toContain('Müller');
  });

  it('stops a part on an E- finding of the coverage check or the posting rules, before writing', async () => {
    const unmapped = exportSetup({ files: { 'mapping-BSP.csv': readMapping().replace(/^5121;.*\r?\n/m, '') } });
    const [first] = await run(unmapped);
    expect(first?.status).toBe('failed');
    expect(first?.findings.filter((f) => f.code.startsWith('E-')).map((f) => [f.code, f.value])).toEqual([['E-UNMAPPED', '5121']]);
    expect(existsSync(exportsOf(unmapped))).toBe(false);

    const wrongRate = exportSetup({ files: { 'mapping-BSP.csv': readMapping().replace('5011;Revenues;Accommodation 7%;7;8300;;7', '5011;Revenues;Accommodation 7%;7;8400;;19') } });
    const [second] = await run(wrongRate);
    expect(second?.status).toBe('failed');
    expect(new Set(second?.findings.filter((f) => f.code.startsWith('E-')).map((f) => f.code))).toEqual(new Set(['E-VAT-RATE']));
    expect(existsSync(exportsOf(wrongRate))).toBe(false);
  });

  it('isolates property-months: an unmapped account blocks only its property', async () => {
    const setup = exportSetup({
      config: exportConfig('  - id: BSP2'),
      files: { 'mapping-BSP.csv': readMapping().replace(/^5121;.*\r?\n/m, ''), 'mapping-BSP2.csv': readMapping() },
      data: addSecondProperty,
    });
    const outcomes = await run(setup, { propertyIds: [BSP, 'BSP2'] });
    expect(outcomes.map((o) => [o.propertyId, o.status])).toEqual([
      [BSP, 'failed'],
      ['BSP2', 'written'],
    ]);
    expect(readdirSync(exportsOf(setup))).toEqual(['BSP2']);
  });

  it('reports a property the custom app cannot see, a missing mapping file and an unknown SKR per property', async () => {
    const setup = exportSetup({
      config: exportConfig('  - id: HBW', '  - id: NOPE'),
      files: { 'mapping-BSP.csv': readMapping().replace(/^# .*\r?\n/, '') },
    });
    const outcomes = await run(setup, { propertyIds: [BSP, 'HBW', 'NOPE'] });
    expect(outcomes.map((o) => [o.propertyId, o.status, o.findings.filter((f) => f.code.startsWith('E-')).map((f) => f.code)])).toEqual([
      [BSP, 'failed', ['E-SKR-UNKNOWN']],
      ['HBW', 'failed', ['E-EXPORT']],
      ['NOPE', 'failed', ['E-PROPERTY-UNKNOWN']],
    ]);
    expect(outcomes[1]?.findings[0]?.message).toContain('No mapping file at');
  });

  it('refuses a datev.skr that contradicts the mapping file', async () => {
    const setup = exportSetup({ config: exportConfig().replace('mandantennummer: 42\n', 'mandantennummer: 42\n  skr: "04"\n') });
    const [outcome] = await run(setup);
    expect(outcome?.findings.map((f) => f.code)).toEqual(['E-SKR-CONFLICT']);
  });

  it('refuses a property that does not keep its books in EUR, before reading its ledger', async () => {
    const setup = exportSetup({
      data: (data) => {
        for (const property of data.properties) property.currency = 'CHF';
      },
    });
    const [outcome] = await run(setup);
    expect(outcome?.status).toBe('failed');
    expect(outcome?.findings.map((f) => [f.code, f.value])).toEqual([['E-CURRENCY', 'CHF']]);
    expect(outcome?.findings[0]?.message).toContain('writes DATEV files in EUR only');
    expect(setup.fake.calls.some((call) => call.startsWith('getLedger'))).toBe(false);
    expect(existsSync(exportsOf(setup))).toBe(false);
  });

  it('refuses a month with a ledger line in another currency than EUR', async () => {
    const setup = exportSetup({
      data: (data) => {
        const [line] = data.ledger[BSP] ?? [];
        if (line) line.currency = 'USD';
      },
    });
    const [outcome] = await run(setup);
    expect(outcome?.status).toBe('failed');
    expect(outcome?.findings.map((f) => [f.code, f.value])).toEqual([['E-CURRENCY', 'USD']]);
    expect(outcome?.findings[0]?.message).toContain('1 apaleo line(s) of BSP are in USD');
    expect(existsSync(exportsOf(setup))).toBe(false);
  });

  it('writes nothing in a dry run but reports what a real run would do', async () => {
    const setup = exportSetup();
    const [outcome] = await run(setup, { dryRun: true });
    expect(outcome?.status).toBe('checked');
    expect(outcome?.plan).toBe('write');
    expect(outcome?.summary).toContain('Totals per DATEV account:');
    expect(readdirSync(setup.ctx.cwd).sort()).toEqual(['apaleo-datev.config.yaml', 'mapping-BSP.csv']);
  });
});

describe('plausibility checks in the pipeline', () => {
  it('blocks the file when a defect writes a booking with the wrong side', async () => {
    const setup = exportSetup();
    const sideBug: typeof buildBookings = (...args) => {
      const result = buildBookings(...args);
      const booking = result.bookings[1];
      if (booking) booking.side = booking.side === 'S' ? 'H' : 'S';
      return result;
    };
    const [outcome] = await run(setup, {}, sideBug);
    expect(outcome?.status).toBe('failed');
    expect(outcome?.findings[0]?.code).toBe('E-ACCOUNT-BALANCE');
    expect(outcome?.findings[0]?.message).toMatch(/^on 2026-09-14 DATEV account \d+ moves -?\d+\.\d\d in the bookings, but the apaleo lines mapped to it move/);
    expect(existsSync(exportsOf(setup))).toBe(false);
  });

  it('blocks the file when a defect drops a line', async () => {
    const setup = exportSetup();
    const dropBug: typeof buildBookings = (...args) => {
      const result = buildBookings(...args);
      return { ...result, bookings: result.bookings.slice(1) };
    };
    const [outcome] = await run(setup, {}, dropBug);
    expect(outcome?.findings.map((f) => f.code)).toContain('E-CONSERVATION');
    expect(existsSync(exportsOf(setup))).toBe(false);
  });

  it('sends no aggregate request unless checks.aggregates is true', async () => {
    const setup = exportSetup();
    await run(setup);
    expect(setup.fake.calls.filter((call) => call.startsWith('getAccountTotals'))).toEqual([]);
  });

  it('with checks.aggregates, warns about a difference and still writes the file', async () => {
    const setup = exportSetup({
      config: `${exportConfig()}checks:\n  aggregates: true\n`,
      data: (data) => {
        const day = data.totals?.[BSP]?.find((t) => t.businessDate === '2026-09-15');
        const revenue = day?.accounts.find((a) => a.account.number === '5000');
        if (revenue) revenue.credited.value = '1.00';
      },
    });
    const [outcome] = await run(setup);
    expect(setup.fake.calls.filter((call) => call.startsWith('getAccountTotals'))).toHaveLength(30);
    expect(outcome?.status).toBe('written');
    expect(outcome?.findings.map((f) => [f.code, f.value])).toEqual([['W-AGGREGATE-DIFF', '5000']]);
    expect(outcome?.findings[0]?.message).toContain("on 2026-09-15 apaleo's daily aggregate for main account 5000 (Revenues)");
  });

  it('with checks.aggregates, blocks the part with a hint when apaleo refuses the aggregates', async () => {
    const setup = exportSetup({ config: `${exportConfig()}checks:\n  aggregates: true\n` });
    setup.fake.getAccountTotals = async () => {
      throw new ApaleoPermissionError('the daily aggregates');
    };
    const [outcome] = await run(setup);
    expect(outcome?.status).toBe('failed');
    expect(outcome?.findings[0]?.code).toBe('E-AGGREGATE-CHECK');
    expect(outcome?.findings[0]?.message).toContain('core.subledger_aggregate.create, or set checks.aggregates: false');
  });
});

function readMapping(): string {
  return readFileSync(new URL('../fixtures/mapping/skr03-beispiel.csv', import.meta.url), 'utf8');
}
