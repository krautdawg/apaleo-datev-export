import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/run.js';
import type { SourceAccount } from '../../src/core/source.js';
import { encodeCp1252 } from '../../src/datev/cp1252.js';
import { decodeCsv } from '../../src/mapping/csv.js';
import { parseMapping } from '../../src/mapping/index.js';
import { BSP, CLIENT_ID, FIXTURE_FILES, createApaleoContext, fixturePath, loadBeispielData } from '../helpers/apaleo.js';
import { createTestContext, type TestContext } from '../helpers/context.js';
import { FakeSource, type FakeSourceData } from '../helpers/fake-source.js';

const CONFIG = FIXTURE_FILES['apaleo-datev.config.yaml'];

async function fakeContext(options: { config?: string; files?: Record<string, string>; extraAccounts?: SourceAccount[] } = {}) {
  const data: FakeSourceData = await loadBeispielData();
  data.charts[BSP] = [...(data.charts[BSP] ?? []), ...(options.extraAccounts ?? [])];
  const fake = new FakeSource(data);
  const ctx = createTestContext({
    files: { 'apaleo-datev.config.yaml': options.config ?? CONFIG, ...options.files },
    sourceFactory: () => fake,
  });
  return { ctx, fake };
}

const read = (ctx: TestContext, file = 'mapping-BSP.csv') => readFileSync(join(ctx.cwd, file));
const text = (ctx: TestContext, file?: string) => decodeCsv(read(ctx, file)).text;
const rowOf = (ctx: TestContext, account: string, file?: string) =>
  text(ctx, file)
    .split('\r\n')
    .find((line) => line.startsWith(`${account};`));

const SPA: SourceAccount = {
  number: '5020',
  name: 'Spa 19%',
  type: 'Revenues',
  parentNumber: '5000',
  ledger: 'global',
  vat: { type: 'Normal', percent: 19 },
  isArchived: false,
  hasChildren: false,
};

describe('apaleo-datev init-mapping', () => {
  it('writes mapping-BSP.csv with every leaf account and prints mapped and unmapped counts', async () => {
    const { ctx, fake } = await fakeContext();
    expect(await runCli(['init-mapping', '--property', BSP, '--skr', '04'], ctx)).toBe(0);
    expect(fake.calls).toEqual([`getChartOfAccounts ${BSP}`]);

    const bytes = read(ctx);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const mapping = parseMapping(bytes, { path: 'x', sachkontenlaenge: 4 });
    expect(mapping.skr).toBe('04');
    const accounts = mapping.rows.filter((r) => r.apaleoAccount !== '*').map((r) => r.apaleoAccount);
    expect(accounts).toEqual(['5011', '5019', '5111', '5121', '5919', '5990', '1600', '1611', '1612', '3007', '3019', '1200', '2007', '2019', '9000', '1400', '3501', '2107', '2119']);
    expect(rowOf(ctx, '5011')).toMatch(/^5011;Revenues;Accommodation 7%;7;4300;;7;;;Vorschlag: Erlöse 7 % USt \(Logis\)/);
    expect(rowOf(ctx, '3501')).toMatch(/^3501;CityTaxes;City Tax 0%;0;;;;;;Vorschlag: bitte entscheiden/);

    expect(ctx.out()).toContain(`Wrote ${join(ctx.cwd, 'mapping-BSP.csv')} from template skr04-hotel@2 for property BSP.`);
    expect(ctx.out()).toContain(
      '29 rows: 21 mapped, 2 unmapped, 2 historical row(s) at the 2020 rates 16 % and 5 %, left empty on purpose, ' +
        '4 VAT account row(s) that need no DATEV account.',
    );
    expect(ctx.out()).toContain('have your Steuerberater check the file');
  });

  it('reads the chart through the apaleo API (ctx.fetchFn)', async () => {
    const ctx = createApaleoContext();
    expect(await runCli(['init-mapping', '--property', BSP, '--skr', '03', '--out', 'maps/bsp.csv'], ctx)).toBe(0);
    expect(rowOf(ctx, '1611', 'maps/bsp.csv')).toMatch(/^1611;Payments;Visa;;1360;/);
    expect(ctx.fetchCalls.some((call) => call.includes('/finance/v1/accounts/schema'))).toBe(true);
    expect(text(ctx, 'maps/bsp.csv')).not.toContain(CLIENT_ID);
  });

  it('writes to properties[].mapping when the config names one', async () => {
    const { ctx } = await fakeContext({ config: `${CONFIG}properties:\n  - id: BSP\n    mapping: ./mappings/hotel.csv\n` });
    expect(await runCli(['init-mapping', '--property', BSP, '--skr', 'SKR03'], ctx)).toBe(0);
    expect(rowOf(ctx, '1611', 'mappings/hotel.csv')).toBeDefined();
  });

  it('scales the template to Sachkontenlänge 5 and prints a note', async () => {
    const { ctx } = await fakeContext({ config: CONFIG.replace('mandantennummer: 42', 'mandantennummer: 42\n  sachkontenlaenge: 5') });
    expect(await runCli(['init-mapping', '--property', BSP, '--skr', '03'], ctx)).toBe(0);
    expect(rowOf(ctx, '5011')).toContain(';83000;');
    expect(rowOf(ctx, '1400')).toContain(';100000;');
    expect(ctx.out()).toContain('N-TEMPLATE-SCALED');
    expect(ctx.out()).toContain('Sachkontenlänge 5');
  });

  it('refuses to overwrite an existing file without --update, exits 1 and writes nothing', async () => {
    const { ctx, fake } = await fakeContext({ files: { 'mapping-BSP.csv': 'edited by hand' } });
    expect(await runCli(['init-mapping', '--property', BSP, '--skr', '04'], ctx)).toBe(1);
    expect(read(ctx).toString()).toBe('edited by hand');
    expect(ctx.err()).toContain('already exists and was not changed');
    expect(ctx.err()).toContain('--update');
    expect(fake.calls).toEqual([]);
  });

  it('--update keeps edited rows byte for byte and appends rows for new apaleo accounts', async () => {
    const first = await fakeContext();
    expect(await runCli(['init-mapping', '--property', BSP, '--skr', '04'], first.ctx)).toBe(0);
    const edited = text(first.ctx).replace(/^5011;.*$/m, '5011;Revenues;Accommodation 7%;7;4301;;7;LOGIS;;Kanzlei: eigenes Konto');
    const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(edited)]);

    const { ctx } = await fakeContext({ files: {}, extraAccounts: [SPA] });
    await ctx.fs.writeFile(join(ctx.cwd, 'mapping-BSP.csv'), original);
    expect(await runCli(['init-mapping', '--property', BSP, '--skr', '04', '--update'], ctx)).toBe(0);

    const updated = read(ctx);
    expect(updated.subarray(0, original.length).equals(original)).toBe(true);
    expect(decodeCsv(updated.subarray(original.length)).text).toBe(
      '5020;Revenues;Spa 19%;19;4400;;19;;;Vorschlag: Erlöse 19 % USt, Automatikkonto. Quelle: DATEV SKR 04 2026, Art.-Nr. 11175 ' +
        '(Stand 2026-01-01), https://www.collmex.de/skr04.pdf, geprüft 2026-10-20.\r\n',
    );
    expect(rowOf(ctx, '5011')).toBe('5011;Revenues;Accommodation 7%;7;4301;;7;LOGIS;;Kanzlei: eigenes Konto');
    expect(ctx.out()).toContain('Added 1 row(s) for new apaleo accounts:');
    expect(ctx.out()).toMatch(/5020\s+Revenues\s+Spa 19%\s+19 %\s+4400/);
  });

  it('--update says so when there is nothing new', async () => {
    const { ctx } = await fakeContext();
    expect(await runCli(['init-mapping', '--property', BSP, '--skr', '04'], ctx)).toBe(0);
    const before = read(ctx);
    expect(await runCli(['init-mapping', '--property', BSP, '--skr', '04', '--update'], ctx)).toBe(0);
    expect(read(ctx).equals(before)).toBe(true);
    expect(ctx.out()).toContain('No new apaleo accounts');
  });

  it('--update appends in the encoding, separator and line breaks of a file Excel saved', async () => {
    const saved = 'apaleo_account,apaleo_type,datev_account,comment\n5011,Revenues,4300,Logis für Gäste\n';
    const { ctx } = await fakeContext({ extraAccounts: [SPA] });
    await ctx.fs.writeFile(join(ctx.cwd, 'mapping-BSP.csv'), encodeCp1252(saved).bytes);
    expect(await runCli(['init-mapping', '--property', BSP, '--skr', '04', '--update'], ctx)).toBe(0);
    const decoded = decodeCsv(read(ctx));
    expect(decoded.encoding).toBe('windows-1252');
    expect(decoded.text.startsWith(saved)).toBe(true);
    expect(decoded.text).toMatch(/\n5020,Revenues,4400,"Vorschlag: Erlöse 19 % USt, Automatikkonto\. Quelle: DATEV SKR 04 2026, Art\.-Nr\. 11175 \(Stand 2026-01-01\), https:\/\/www\.collmex\.de\/skr04\.pdf, geprüft 2026-10-20\."\n/);
    expect(decoded.text).not.toContain('\r');
  });

  it('--update converts a Grman export, keeping its accounts and the original file', async () => {
    const grman = 'ApaleoAccountNumber;DatevAccountNumber;CostCenter;CostCenter2\r\n5011;4301;LOGIS;\r\n1200;1211;;\r\n7777;4999;;\r\n';
    const { ctx } = await fakeContext({ files: { 'mapping-BSP.csv': grman } });
    expect(await runCli(['init-mapping', '--property', BSP, '--skr', '04', '--update'], ctx)).toBe(0);
    expect(read(ctx, 'mapping-BSP.grman.csv').toString()).toBe(grman);
    expect(rowOf(ctx, '5011')).toBe('5011;Revenues;Accommodation 7%;7;4301;;;LOGIS;;Aus dem Grman-Export übernommen: BU-Schlüssel und USt-Satz prüfen.');
    expect(rowOf(ctx, '1200')).toMatch(/^1200;Receivables;Guest Receivables;;1211;/);
    expect(rowOf(ctx, '7777')).toMatch(/^7777;\*any\*;;;4999;/);
    expect(rowOf(ctx, '5019')).toMatch(/^5019;Revenues;Accommodation 19%;19;4400;/);
    expect(ctx.out()).toContain('Converted the Grman export');
  });

  it('refuses to convert a Grman export when the .grman.csv backup already exists, changing nothing', async () => {
    const grman = 'ApaleoAccountNumber;DatevAccountNumber;CostCenter;CostCenter2\r\n5011;4301;LOGIS;\r\n';
    const older = 'ApaleoAccountNumber;DatevAccountNumber;CostCenter;CostCenter2\r\n5011;4300;;\r\n';
    const { ctx, fake } = await fakeContext({ files: { 'mapping-BSP.csv': grman, 'mapping-BSP.grman.csv': older } });
    expect(await runCli(['init-mapping', '--property', BSP, '--skr', '04', '--update'], ctx)).toBe(1);
    expect(ctx.err()).toContain(`keeps the original as ${join(ctx.cwd, 'mapping-BSP.grman.csv')}, but that file already exists`);
    expect(read(ctx).toString()).toBe(grman);
    expect(read(ctx, 'mapping-BSP.grman.csv').toString()).toBe(older);
    expect(fake.calls).toEqual([]);
  });

  it('leaves the Grman export in place when writing the converted file fails', async () => {
    const grman = 'ApaleoAccountNumber;DatevAccountNumber;CostCenter;CostCenter2\r\n5011;4301;LOGIS;\r\n';
    const { ctx } = await fakeContext({ files: { 'mapping-BSP.csv': grman } });
    const fs = ctx.fs;
    ctx.fs = { ...fs, writeFile: () => Promise.reject(Object.assign(new Error('disk full'), { code: 'ENOSPC' })) };
    expect(await runCli(['init-mapping', '--property', BSP, '--skr', '04', '--update'], ctx)).not.toBe(0);
    expect(ctx.err()).toContain('disk full');
    expect(read(ctx).toString()).toBe(grman);
    expect(() => read(ctx, 'mapping-BSP.grman.csv')).toThrow();
  });

  it('moves the Grman export back when the converted file cannot be moved into place', async () => {
    const grman = 'ApaleoAccountNumber;DatevAccountNumber;CostCenter;CostCenter2\r\n5011;4301;LOGIS;\r\n';
    const { ctx } = await fakeContext({ files: { 'mapping-BSP.csv': grman } });
    const fs = ctx.fs;
    ctx.fs = {
      ...fs,
      rename: (from, to) => (String(from).endsWith('.tmp') ? Promise.reject(new Error('rename failed')) : fs.rename(from, to)),
    };
    expect(await runCli(['init-mapping', '--property', BSP, '--skr', '04', '--update'], ctx)).not.toBe(0);
    expect(read(ctx).toString()).toBe(grman);
    expect(() => read(ctx, 'mapping-BSP.grman.csv')).toThrow();
  });

  it('--update appends below a header whose cells are all quoted', async () => {
    const quoted =
      '"apaleo_account";"apaleo_type";"apaleo_name";"apaleo_vat_percent";"datev_account";"bu_key";"datev_vat_percent";"kost1";"kost2";"comment"\r\n' +
      '"5011";"Revenues";"Accommodation 7%";"7";"4300";"";"7";"";"";""\r\n';
    const { ctx } = await fakeContext({ files: { 'mapping-BSP.csv': quoted }, extraAccounts: [SPA] });
    expect(await runCli(['init-mapping', '--property', BSP, '--skr', '04', '--update'], ctx)).toBe(0);
    const mapping = parseMapping(read(ctx), { path: 'x', sachkontenlaenge: 4 });
    expect(mapping.rows.find((r) => r.apaleoAccount === '5020')).toMatchObject({ apaleoType: 'Revenues', datevAccount: '4400' });
    expect(mapping.rows.find((r) => r.apaleoAccount === '5011')).toMatchObject({ datevAccount: '4300' });
  });

  it('refuses --update with another SKR than the file was made from', async () => {
    const { ctx } = await fakeContext();
    expect(await runCli(['init-mapping', '--property', BSP, '--skr', '04'], ctx)).toBe(0);
    expect(await runCli(['init-mapping', '--property', BSP, '--skr', '03', '--update'], ctx)).toBe(1);
    expect(ctx.err()).toContain('was made from the SKR 04 template');
  });

  it.each([
    [['init-mapping', '--skr', '03'], '--property'],
    [['init-mapping', '--property', BSP], '--skr 03 or --skr 04'],
    [['init-mapping', '--property', BSP, '--skr', '05'], '--skr must be 03 or 04'],
  ])('exits 2 on %j', async (argv, message) => {
    const { ctx } = await fakeContext();
    expect(await runCli(argv, ctx)).toBe(2);
    expect(ctx.err()).toContain(message);
  });
});

describe('init-mapping on the recorded apaleo sandbox charts', () => {
  const live = () => createApaleoContext({ live: true });
  const lines = (ctx: TestContext, file: string) => text(ctx, file).split('\r\n');

  it('BER (SKR03): no 3000 row, deposit and debtor wildcards, no-show and cancellation fees at 7 %, empty 2020 rows', async () => {
    const ctx = live();
    expect(await runCli(['init-mapping', '--property', 'BER', '--skr', '03'], ctx)).toBe(0);
    const file = 'mapping-BER.csv';
    expect(rowOf(ctx, '3000', file)).toBeUndefined();
    expect(rowOf(ctx, 'CollectiveDebitor_LossOfAccountsReceivable', file)).toBeUndefined();
    const wildcards = lines(ctx, file).filter((line) => line.startsWith('*;')).map((line) => line.split(';').slice(0, 7).join(';'));
    expect(wildcards).toEqual(
      expect.arrayContaining(['*;Liabilities;;7;1711;;7', '*;Liabilities;;19;1718;;19', '*;Liabilities;;0;1719;;0', '*;AccountsReceivable;;;10000;;']),
    );
    expect(rowOf(ctx, 'RevenueNoShow_Reduced:7.00', file)).toMatch(/^RevenueNoShow_Reduced:7\.00;Revenues;Revenues No-show \(7%\);7;8300;;7;/);
    expect(rowOf(ctx, 'RevenueCancellationFees_Reduced:7.00', file)).toMatch(/;7;8300;;7;;;archiviert\. Vorschlag: No-Show/);
    const historical = lines(ctx, file).filter((line) => /^Revenue\w+_(Normal:16|Reduced:5)\.00;/.test(line));
    expect(historical).toHaveLength(10);
    for (const line of historical) expect(line).toMatch(/;(16|5);;;;;;(archiviert\. )?Vorschlag: leer lassen, historischer Satz 1\.7\.–31\.12\.2020/);
    expect(ctx.out()).toMatch(/\d+ rows: \d+ mapped, \d+ unmapped, 12 historical row\(s\) at the 2020 rates 16 % and 5 %, left empty on purpose/);
    expect(ctx.out()).not.toContain('N-FOREIGN-VAT-RATES');
  });

  it('writes the committed live mapping of BER byte for byte', async () => {
    const ctx = live();
    expect(await runCli(['init-mapping', '--property', 'BER', '--skr', '03'], ctx)).toBe(0);
    expect(read(ctx, 'mapping-BER.csv').equals(readFileSync(fixturePath('live/BER/mapping-BER.live.csv')))).toBe(true);
  });

  it('VIE (Austrian rates): leaves 4.9, 10, 13 and 20 % empty and prints N-FOREIGN-VAT-RATES', async () => {
    const ctx = live();
    expect(await runCli(['init-mapping', '--property', 'VIE', '--skr', '03'], ctx)).toBe(0);
    expect(ctx.out()).toContain('N-FOREIGN-VAT-RATES');
    expect(ctx.out()).toContain('4.9 %, 10 %, 13 %, 20 %');
    for (const number of ['RevenueAccommodation_Reduced:13.00', 'RevenueFoodAndBeverages_VeryReduced:10.00', 'RevenueFoodAndBeverages_Normal:20.00']) {
      expect(rowOf(ctx, number, 'mapping-VIE.csv')).toMatch(/^[^;]+;Revenues;[^;]*;[\d.]+;;/);
    }
  });

  it('--update of a template version 1 file keeps every row, appends the debtor wildcard and prints migration notes', async () => {
    const ctx = live();
    const v1 = readFileSync(fixturePath('live/BER/mapping-BER.v1.csv'));
    await ctx.fs.writeFile(join(ctx.cwd, 'mapping-BER.csv'), v1);
    expect(await runCli(['init-mapping', '--property', 'BER', '--skr', '03', '--update'], ctx)).toBe(0);

    const updated = read(ctx, 'mapping-BER.csv');
    expect(updated.subarray(0, v1.length).equals(v1)).toBe(true);
    const appended = decodeCsv(updated.subarray(v1.length)).text;
    expect(appended).toMatch(/^\*;AccountsReceivable;;;10000;;;;;Vorschlag: Sammeldebitor/m);
    const out = ctx.out();
    expect(out).toMatch(/N-PARENT-ROW-EMPTY: line 67: the parent account 3000 \(Liabilities\) has no DATEV account\. It no longer blocks/);
    expect(out).toMatch(/N-TEMPLATE-SUGGESTION: line 25: the template now suggests DATEV account 8300 for RevenueNoShow_Reduced:7\.00 \(Revenues\) at 7 %/);
    expect(out).toMatch(/N-TEMPLATE-SUGGESTION: line \d+: the template now suggests DATEV account 8300 for RevenueCancellationFees_Reduced:7\.00 \(Revenues\) at 7 %/);
    expect(out.match(/N-TEMPLATE-SUGGESTION/g)).toHaveLength(2);
  });
});
