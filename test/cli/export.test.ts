import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as nodeFs from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/run.js';
import { bodyOf, sha256, withoutCreationTime, type Manifest } from '../../src/export/index.js';
import { ApaleoError, ApaleoPermissionError } from '../../src/sources/apaleo/index.js';
import { BSP } from '../helpers/apaleo.js';
import { splitFields } from '../helpers/extf.js';
import { addSecondProperty, exportConfig, exportSetup, latePosting, type ExportSetup } from '../helpers/export.js';
import { describeDifference } from '../helpers/golden.js';

/**
 * End-to-end through `runCli` with a fake context: fixed clock 2026-10-20, the
 * Hotel Beispiel fixtures behind a `FakeSource` and a temporary working
 * directory. The fixture data lies in September 2026, so the spec's monthly
 * scenarios run on `--month 2026-09`. After an intended change to the output,
 * run `UPDATE_GOLDEN=1 pnpm test` and review the diff of test/golden/export/.
 */
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const GOLDEN = new URL('../golden/export/', import.meta.url);
const FILE = 'EXTF_Buchungsstapel_1234567_42_20260901-20260930_BSP.csv';
const PROTOCOL = 'EXTF_Buchungsstapel_1234567_42_20260901-20260930_BSP.protokoll.txt';

const folder = (setup: ExportSetup, month = '2026-09', property = BSP) => join(setup.ctx.cwd, 'exports', property, month);
const read = (setup: ExportSetup, name: string, month?: string) => readFileSync(join(folder(setup, month), name));
const manifestOf = (setup: ExportSetup, month?: string) => JSON.parse(read(setup, 'manifest.json', month).toString('utf8')) as Manifest;
const headerFields = (bytes: Uint8Array) => splitFields(new TextDecoder('windows-1252').decode(bytes).split('\r\n')[0] ?? '');

function expectGolden(name: string, actual: Uint8Array): void {
  const path = new URL(name, GOLDEN);
  if (UPDATE) writeFileSync(path, actual);
  const difference = describeDifference(readFileSync(path), actual);
  expect(difference, `${name} differs from the golden file:\n${difference}`).toBeUndefined();
}

/** A copy of the fixture's first logis charge on another business day. */
function chargeOn(day: `${number}-${number}-${number}`, entry: string) {
  return (data: ExportSetup['data']) => {
    const template = data.ledger[BSP]?.find((line) => line.credit.number === '5011');
    if (!template) throw new Error('fixture logis charge missing');
    data.ledger[BSP]?.push({ ...structuredClone(template), businessDate: day, postedAt: `${day}T15:00:00Z`, sourceEntryNumber: entry });
  };
}

describe('apaleo-datev export', () => {
  it('writes the golden EXTF file, its protocol and the manifest for a month and exits 0', async () => {
    const setup = exportSetup();
    expect(await runCli(['export', '--month', '2026-09', '--property', BSP], setup.ctx)).toBe(0);
    expect(setup.ctx.out()).toContain(`BSP 2026-09 (2026-09-01 to 2026-09-30): written exports/BSP/2026-09/${FILE} (22 bookings)`);
    expect(setup.ctx.out()).toContain('Result: 1 written, 0 unchanged, 0 failed.');
    expect(readdirSync(folder(setup)).sort()).toEqual([FILE, PROTOCOL, 'manifest.json']);

    const file = read(setup, FILE);
    expectGolden(FILE, file);
    const manifest = read(setup, 'manifest.json');
    expectGolden('manifest.json', manifest);
    const [entry] = manifestOf(setup).files;
    expect(entry).toMatchObject({ file: FILE, status: 'current', sha256: sha256(file), bodySha256: sha256(bodyOf(file)), bookings: 22 });
    expect(entry?.mappingSha256).toBe(sha256(readFileSync(join(setup.ctx.cwd, 'mapping-BSP.csv'))));

    const protocol = read(setup, PROTOCOL).toString('utf8');
    expect(protocol).toContain('Totals per DATEV account:');
    expect(protocol).toContain(`SHA-256: ${sha256(file)}`);
    expect(protocol).toContain('Tool: apaleo-datev 0.1.1');
  });

  it('exits 2 and explains --month and --from/--to when the period is missing', async () => {
    const setup = exportSetup();
    expect(await runCli(['export', '--property', BSP], setup.ctx)).toBe(2);
    expect(setup.ctx.err()).toContain('--month YYYY-MM');
    expect(setup.ctx.err()).toContain('--from YYYY-MM-DD --to YYYY-MM-DD');
    expect(setup.fake.calls).toEqual([]);
  });

  it('exits 2 when no property is configured or given', async () => {
    const setup = exportSetup({ config: exportConfig().replace(/properties:[\s\S]*$/, '') });
    expect(await runCli(['export', '--month', '2026-09'], setup.ctx)).toBe(2);
    expect(setup.ctx.err()).toContain('No property to export');
  });

  it('exports every configured property by default', async () => {
    const setup = exportSetup({
      config: exportConfig('  - id: BSP2'),
      files: { 'mapping-BSP2.csv': readFileSync(join(import.meta.dirname, '../fixtures/mapping/skr03-beispiel.csv'), 'utf8') },
      data: addSecondProperty,
    });
    expect(await runCli(['export', '--month', '2026-09'], setup.ctx)).toBe(0);
    expect(readdirSync(join(setup.ctx.cwd, 'exports')).sort()).toEqual([BSP, 'BSP2']);
  });

  it('splits a range across two months into two files', async () => {
    const setup = exportSetup({ data: chargeOn('2026-10-02', 'BSPE0100') });
    expect(await runCli(['export', '--from', '2026-09-20', '--to', '2026-10-05', '--property', BSP], setup.ctx)).toBe(0);
    expect(readdirSync(folder(setup, '2026-09'))).toContain('EXTF_Buchungsstapel_1234567_42_20260920-20260930_BSP.csv');
    expect(readdirSync(folder(setup, '2026-10'))).toContain('EXTF_Buchungsstapel_1234567_42_20261001-20261005_BSP.csv');
  });

  it('writes WJ-Beginn 20260701 for --month 2027-03 when the fiscal year starts on 07-01', async () => {
    const setup = exportSetup({
      config: exportConfig().replace('mandantennummer: 42\n', 'mandantennummer: 42\n  wjBeginn: "07-01"\n'),
      data: chargeOn('2027-03-05', 'BSPE0200'),
      now: new Date('2027-04-10T08:00:00Z'),
    });
    expect(await runCli(['export', '--month', '2027-03', '--property', BSP], setup.ctx)).toBe(0);
    const file = read(setup, 'EXTF_Buchungsstapel_1234567_42_20270301-20270331_BSP.csv', '2027-03');
    expect(headerFields(file).slice(12, 16)).toEqual(['20260701', '4', '20270301', '20270331']);
  });

  it('refuses a period that reaches today in the property time zone, taken from ctx.now()', async () => {
    // 22:30 UTC on 2026-10-19 is already 2026-10-20 in Berlin.
    const setup = exportSetup({ now: new Date('2026-10-19T22:30:00Z') });
    expect(await runCli(['export', '--from', '2026-10-01', '--to', '2026-10-20', '--property', BSP], setup.ctx)).toBe(1);
    expect(setup.ctx.out()).toContain('E-DAY-NOT-CLOSED');
    expect(setup.ctx.out()).toContain('not closed that day with the night audit yet');
    expect(setup.fake.calls).toEqual(['listProperties']);
    expect(existsSync(join(setup.ctx.cwd, 'exports'))).toBe(false);
  });

  it('warns about a period ending yesterday', async () => {
    const setup = exportSetup({ now: new Date('2026-10-01T08:00:00Z') });
    expect(await runCli(['export', '--month', '2026-09', '--property', BSP], setup.ctx)).toBe(0);
    expect(setup.ctx.out()).toContain('W-RECENT-DAY');
  });

  it('writes BSP2 but not BSP when BSP has an unmapped account, prints E-UNMAPPED and exits 1', async () => {
    const mapping = readFileSync(join(import.meta.dirname, '../fixtures/mapping/skr03-beispiel.csv'), 'utf8');
    const setup = exportSetup({
      config: exportConfig('  - id: BSP2'),
      files: { 'mapping-BSP.csv': mapping.replace(/^5121;.*\r?\n/m, ''), 'mapping-BSP2.csv': mapping },
      data: addSecondProperty,
    });
    expect(await runCli(['export', '--month', '2026-09'], setup.ctx)).toBe(1);
    const out = setup.ctx.out();
    expect(out).toContain('BSP 2026-09 (2026-09-01 to 2026-09-30): failed, no file written');
    expect(out).toMatch(/E-UNMAPPED \(apaleo_account\): apaleo account 5121 \(Revenues, "Beverages 19%"\) is not mapped .*: add a row/);
    expect(out).toContain('BSP2 2026-09 (2026-09-01 to 2026-09-30): written');
    expect(out).toContain('Result: 1 written, 0 unchanged, 1 failed.');
    expect(readdirSync(join(setup.ctx.cwd, 'exports'))).toEqual(['BSP2']);
  });

  it('prints the summary in a dry run and creates no file or folder', async () => {
    const setup = exportSetup();
    expect(await runCli(['export', '--month', '2026-09', '--property', BSP, '--dry-run'], setup.ctx)).toBe(0);
    const out = setup.ctx.out();
    for (const text of [
      'Totals per DATEV account:',
      'Revenue and VAT per rate',
      'Deposits and their VAT per rate',
      'City tax: 15.00',
      'Payments per clearing account:',
      'Deposits: received 350.00, released 350.00, of it refunded 0.00',
      'Accounts receivable (collective debtor, Soll positive): 115.00',
      'gross (unsigned)',
      'Skipped lines:',
      'Findings:',
    ]) {
      expect(out).toContain(text);
    }
    expect(out).toContain('  7 %: gross 664.00, DATEV VAT 43.44, apaleo VAT 43.44, difference 0.00');
    expect(out).toContain('DATEV computes the VAT booking by booking and rounds each to the cent');
    expect(out).toContain(`File: a real run writes exports/BSP/2026-09/${FILE}`);
    expect(out).toContain('Result: dry run, nothing written');
    expect(readdirSync(setup.ctx.cwd).sort()).toEqual(['apaleo-datev.config.yaml', 'mapping-BSP.csv']);
  });

  it('exits 1 in a dry run with an error finding', async () => {
    const setup = exportSetup({ files: { 'mapping-BSP.csv': '' } });
    expect(await runCli(['export', '--month', '2026-09', '--property', BSP, '--dry-run'], setup.ctx)).toBe(1);
    expect(setup.ctx.out()).toContain('dry run, blocked');
  });
});

describe('re-running an export', () => {
  async function exportedOnce(): Promise<ExportSetup> {
    const setup = exportSetup();
    expect(await runCli(['export', '--month', '2026-09', '--property', BSP], setup.ctx)).toBe(0);
    setup.ctx.now = () => new Date('2026-10-21T09:30:00Z');
    return setup;
  }

  it('reports unchanged, rewrites nothing and exits 0 when the data did not change', async () => {
    const setup = await exportedOnce();
    const before = readdirSync(folder(setup)).map((name) => [name, read(setup, name)] as const);
    expect(await runCli(['export', '--month', '2026-09', '--property', BSP], setup.ctx)).toBe(0);
    expect(setup.ctx.out()).toContain(`unchanged exports/BSP/2026-09/${FILE}`);
    expect(readdirSync(folder(setup)).map((name) => [name, read(setup, name)] as const)).toEqual(before);
  });

  it('refuses a month a late posting changed with E-FILE-EXISTS and suggests --overwrite', async () => {
    const setup = await exportedOnce();
    latePosting(setup.data);
    const before = read(setup, FILE);
    expect(await runCli(['export', '--month', '2026-09', '--property', BSP], setup.ctx)).toBe(1);
    const out = setup.ctx.out();
    expect(out).toContain('E-FILE-EXISTS');
    expect(out).toContain('DATEV import is not idempotent');
    expect(out).toContain('the Kanzlei has imported the old file, it must delete that batch in DATEV first');
    expect(out).toContain('--overwrite');
    expect(read(setup, FILE)).toEqual(before);
  });

  it('with --overwrite keeps the old file as .replaced-<timestamp>.csv and records both in the manifest', async () => {
    const setup = await exportedOnce();
    const old = read(setup, FILE);
    latePosting(setup.data);
    expect(await runCli(['export', '--month', '2026-09', '--property', BSP, '--overwrite'], setup.ctx)).toBe(0);
    const backup = 'EXTF_Buchungsstapel_1234567_42_20260901-20260930_BSP.replaced-20261021T093000Z.csv';
    expect(readdirSync(folder(setup)).sort()).toEqual([
      FILE,
      PROTOCOL,
      backup,
      'EXTF_Buchungsstapel_1234567_42_20260901-20260930_BSP.replaced-20261021T093000Z.protokoll.txt',
      'manifest.json',
    ]);
    expect(read(setup, backup)).toEqual(old);
    const fresh = read(setup, FILE);
    expect(manifestOf(setup).files.map((e) => [e.file, e.status, e.sha256, e.bookings])).toEqual([
      [backup, 'replaced', sha256(old), 22],
      [FILE, 'current', sha256(fresh), 23],
    ]);
    expect(manifestOf(setup).files[0]).toMatchObject({ replacedBy: FILE, replacedAt: '2026-10-21T09:30:00.000Z' });
  });

  it('falls back to the file itself when the manifest was deleted', async () => {
    const setup = await exportedOnce();
    rmSync(join(folder(setup), 'manifest.json'));
    expect(await runCli(['export', '--month', '2026-09', '--property', BSP], setup.ctx)).toBe(0);
    expect(setup.ctx.out()).toContain('unchanged');
    expect(setup.ctx.out()).toContain('N-COMPANIONS-REPAIRED');
    expect(manifestOf(setup).files.map((e) => [e.file, e.status])).toEqual([[FILE, 'current']]);

    latePosting(setup.data);
    expect(await runCli(['export', '--month', '2026-09', '--property', BSP], setup.ctx)).toBe(1);
    expect(setup.ctx.out()).toContain('E-FILE-EXISTS');
    expect(await runCli(['export', '--month', '2026-09', '--property', BSP, '--overwrite'], setup.ctx)).toBe(0);
    expect(manifestOf(setup).files.map((e) => [e.status, e.from, e.to])).toEqual([
      ['replaced', '2026-09-01', '2026-09-30'],
      ['current', '2026-09-01', '2026-09-30'],
    ]);
  });

  it('rewrites a missing protocol and a stale manifest entry after an interrupted run, without touching the file', async () => {
    const setup = await exportedOnce();
    const csv = read(setup, FILE);
    rmSync(join(folder(setup), PROTOCOL));
    const stale = manifestOf(setup);
    writeFileSync(join(folder(setup), 'manifest.json'), JSON.stringify({ files: stale.files.map((e) => ({ ...e, sha256: 'stale' })) }));
    expect(await runCli(['export', '--month', '2026-09', '--property', BSP], setup.ctx)).toBe(0);
    const out = setup.ctx.out();
    expect(out).toContain(`unchanged exports/BSP/2026-09/${FILE}`);
    expect(out).toContain(`N-COMPANIONS-REPAIRED: ${PROTOCOL} and manifest.json did not match ${FILE}`);
    expect(read(setup, FILE)).toEqual(csv);
    expect(read(setup, PROTOCOL).toString('utf8')).toContain(`\nSHA-256: ${sha256(csv)}\n`);
    expect(manifestOf(setup).files.map((e) => [e.file, e.status, e.sha256])).toEqual([[FILE, 'current', sha256(csv)]]);
    expect(readdirSync(folder(setup)).sort()).toEqual([FILE, PROTOCOL, 'manifest.json']);
  });

  it('writes nothing while another run holds the folder lock', async () => {
    const setup = exportSetup();
    await nodeFs.mkdir(folder(setup), { recursive: true });
    writeFileSync(join(folder(setup), '.apaleo-datev.lock'), 'pid 1\n');
    expect(await runCli(['export', '--month', '2026-09', '--property', BSP], setup.ctx)).toBe(1);
    const out = setup.ctx.out();
    expect(out).toContain('E-EXPORT: another apaleo-datev run is writing into');
    expect(out).toContain('Result: 0 written, 0 unchanged, 1 failed.');
    expect(readdirSync(folder(setup))).toEqual(['.apaleo-datev.lock']);
  });

  it('does not write over a file another run created after this run checked the folder', async () => {
    const setup = exportSetup();
    setup.ctx.fs = {
      ...nodeFs,
      writeFile: async (path, data, options) => {
        // The other run finishes between this run's check and its write.
        if (String(path).endsWith('.apaleo-datev.lock')) writeFileSync(join(folder(setup), FILE), 'written by another run');
        return nodeFs.writeFile(path, data, options);
      },
    };
    expect(await runCli(['export', '--month', '2026-09', '--property', BSP], setup.ctx)).toBe(1);
    expect(setup.ctx.out()).toContain('changed while this run was checking it, probably by another apaleo-datev run');
    expect(read(setup, FILE).toString('utf8')).toBe('written by another run');
    expect(readdirSync(folder(setup))).toEqual([FILE]);
  });

  it('refuses a period that overlaps a file already in the folder', async () => {
    const setup = await exportedOnce();
    expect(await runCli(['export', '--from', '2026-09-20', '--to', '2026-09-30', '--property', BSP], setup.ctx)).toBe(1);
    expect(setup.ctx.out()).toContain('E-PERIOD-OVERLAP');
    expect(setup.ctx.out()).toContain('Importing both files would book those days twice in DATEV');
    expect(readdirSync(folder(setup))).toHaveLength(3);
  });

  it('refuses a re-run whose header changed (WJ-Beginn) and replaces the file with --overwrite', async () => {
    const setup = await exportedOnce();
    const configPath = join(setup.ctx.cwd, 'apaleo-datev.config.yaml');
    writeFileSync(configPath, readFileSync(configPath, 'utf8').replace('mandantennummer: 42\n', 'mandantennummer: 42\n  wjBeginn: "09-01"\n'));
    const old = read(setup, FILE);
    expect(headerFields(old)[12]).toBe('20260101');

    const start = setup.ctx.out().length;
    expect(await runCli(['export', '--month', '2026-09', '--property', BSP], setup.ctx)).toBe(1);
    const refused = setup.ctx.out().slice(start);
    expect(refused).toContain('E-FILE-EXISTS');
    expect(refused).toContain('same bookings but a different header line');
    expect(refused).not.toContain('unchanged exports');
    expect(read(setup, FILE)).toEqual(old);

    expect(await runCli(['export', '--month', '2026-09', '--property', BSP, '--overwrite'], setup.ctx)).toBe(0);
    expect(setup.ctx.out()).toContain('the previous file was kept as .replaced-*.csv');
    const fresh = read(setup, FILE);
    expect(headerFields(fresh)[12]).toBe('20260901');
    expect(sha256(bodyOf(fresh))).toBe(sha256(bodyOf(old)));
    expect(manifestOf(setup).files.map((e) => e.status)).toEqual(['replaced', 'current']);
  });

  it('ignores only the creation time when comparing', async () => {
    const setup = await exportedOnce();
    const file = read(setup, FILE);
    expect(headerFields(file)[5]).toMatch(/^\d{17}$/);
    const fields = headerFields(withoutCreationTime(file));
    expect(fields[5]).toBe('');
    expect(fields.length).toBe(headerFields(file).length);
    expect(sha256(bodyOf(withoutCreationTime(file)))).toBe(sha256(bodyOf(file)));
  });

  it('stops at a corrupt manifest.json with E-EXPORT and changes nothing', async () => {
    const setup = await exportedOnce();
    writeFileSync(join(folder(setup), 'manifest.json'), '{ not json');
    latePosting(setup.data);
    const before = readdirSync(folder(setup)).map((name) => [name, read(setup, name)] as const);
    expect(await runCli(['export', '--month', '2026-09', '--property', BSP, '--overwrite'], setup.ctx)).toBe(1);
    expect(setup.ctx.out()).toContain('E-EXPORT');
    expect(setup.ctx.out()).toContain('manifest.json is not a manifest written by apaleo-datev');
    expect(readdirSync(folder(setup)).map((name) => [name, read(setup, name)] as const)).toEqual(before);
  });
});

describe('export failures that stop one part', () => {
  const twoProperties = () =>
    exportSetup({
      config: exportConfig('  - id: BSP2'),
      files: { 'mapping-BSP2.csv': readFileSync(join(import.meta.dirname, '../fixtures/mapping/skr03-beispiel.csv'), 'utf8') },
      data: addSecondProperty,
    });

  it('exports each property once, in the order of repeated --property flags', async () => {
    const setup = twoProperties();
    expect(await runCli(['export', '--month', '2026-09', '--property', 'BSP2', '--property', BSP, '--property', 'BSP2'], setup.ctx)).toBe(0);
    const heads = setup.ctx.out().split('\n').filter((line) => line.includes(': written'));
    expect(heads.map((line) => line.split(' ')[0])).toEqual(['BSP2', BSP]);
    expect(setup.ctx.out()).toContain('Result: 2 written, 0 unchanged, 0 failed.');
  });

  it('turns a file system error into E-EXPORT for that property-month and still runs the others', async () => {
    const setup = twoProperties();
    setup.ctx.fs = {
      ...nodeFs,
      writeFile: async (path, data, options) => {
        if (String(path).includes(`${join('exports', BSP)}/`)) {
          throw Object.assign(new Error(`EACCES: permission denied, open '${String(path)}'`), { code: 'EACCES', syscall: 'open', path: String(path) });
        }
        return nodeFs.writeFile(path, data, options);
      },
    };
    expect(await runCli(['export', '--month', '2026-09'], setup.ctx)).toBe(1);
    const out = setup.ctx.out();
    expect(out).toContain('BSP 2026-09 (2026-09-01 to 2026-09-30): failed');
    expect(out).toMatch(/E-EXPORT: the file system refused a step of the export: EACCES: permission denied/);
    expect(out).toContain('belongs to another user');
    expect(out).toContain('sudo chown -R 1000:1000 data');
    expect(out).toContain('BSP2 2026-09 (2026-09-01 to 2026-09-30): written');
    expect(out).toContain('Result: 1 written, 0 unchanged, 1 failed.');
  });

  it('gives the permission hint only when apaleo refuses the aggregates with 403', async () => {
    const setup = exportSetup({ config: `${exportConfig()}checks:\n  aggregates: true\n` });
    setup.fake.getAccountTotals = async () => {
      throw new ApaleoPermissionError('the daily aggregates');
    };
    expect(await runCli(['export', '--month', '2026-09', '--property', BSP], setup.ctx)).toBe(1);
    expect(setup.ctx.out()).toContain('E-AGGREGATE-CHECK');
    expect(setup.ctx.out()).toContain('core.subledger_aggregate.create, or set checks.aggregates: false');
  });

  it('asks to try again, without the permission hint, when the aggregate request fails otherwise', async () => {
    const setup = exportSetup({ config: `${exportConfig()}checks:\n  aggregates: true\n` });
    setup.fake.getAccountTotals = async () => {
      throw new ApaleoError('apaleo did not answer the daily aggregates request (HTTP 503 Service Unavailable).', 503);
    };
    expect(await runCli(['export', '--month', '2026-09', '--property', BSP], setup.ctx)).toBe(1);
    const out = setup.ctx.out();
    expect(out).toContain('E-AGGREGATE-CHECK');
    expect(out).toContain('HTTP 503');
    expect(out).toContain('This is not a missing permission');
    expect(out).toContain('Try again later');
    expect(out).not.toContain('Give the custom app the permission core.subledger_aggregate.create');
    expect(existsSync(join(setup.ctx.cwd, 'exports'))).toBe(false);
  });
});
