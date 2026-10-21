import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/run.js';
import type { LedgerLine } from '../../src/core/source.js';
import { BSP, FIXTURE_FILES, loadBeispielData } from '../helpers/apaleo.js';
import { createTestContext } from '../helpers/context.js';
import { FakeSource } from '../helpers/fake-source.js';
import { ledgerLine } from '../helpers/ledger.js';

const CONFIG = FIXTURE_FILES['apaleo-datev.config.yaml'];
const HEADER = 'apaleo_account;apaleo_type;apaleo_name;apaleo_vat_percent;datev_account;bu_key;datev_vat_percent;kost1;kost2;comment';
const csv = (...lines: string[]) => [HEADER, ...lines].map((l) => `${l}\r\n`).join('');

const VALID = csv(
  '5011;Revenues;Accommodation 7%;7;8300;;7;;;',
  '1611;Payments;Visa;;1360;;;;;',
  '*;Payments;;;1360;;;;;',
  '*;Liabilities;;7;1711;;7;;;',
  '3501;CityTaxes;City Tax;0;;;;;;',
);

const BEISPIEL = await loadBeispielData();

function context(files: Record<string, string>, ledger?: LedgerLine[], config = CONFIG) {
  const data = structuredClone(BEISPIEL);
  if (ledger) data.ledger[BSP] = ledger;
  const fake = new FakeSource(data);
  const ctx = createTestContext({ files: { 'apaleo-datev.config.yaml': config, ...files }, sourceFactory: () => fake });
  return { ctx, fake };
}

describe('apaleo-datev mapping check (offline)', () => {
  it('prints a summary of rows by type and exits 0 for a valid mapping', async () => {
    const { ctx, fake } = context({ 'mapping-BSP.csv': VALID });
    expect(await runCli(['mapping', 'check', '--property', BSP, '--skr', '03'], ctx)).toBe(0);
    expect(ctx.out()).toContain(`Mapping file: ${join(ctx.cwd, 'mapping-BSP.csv')} (apaleo-datev layout, 5 rows, SKR 03)`);
    expect(ctx.out()).toMatch(/type\s+rows\s+mapped\s+unmapped/);
    expect(ctx.out()).toMatch(/Revenues\s+1\s+1\s+0/);
    expect(ctx.out()).toMatch(/Payments\s+2\s+2\s+0/);
    expect(ctx.out()).toMatch(/CityTaxes\s+1\s+0\s+1/);
    expect(ctx.out()).toContain('Result: mapping OK.');
    expect(fake.calls).toEqual([]);
  });

  it('uses --mapping and the only configured property by default', async () => {
    const { ctx } = context({ 'maps/hotel.csv': VALID }, undefined, `${CONFIG}properties:\n  - id: BSP\n    mapping: maps/hotel.csv\n`);
    expect(await runCli(['mapping', 'check', '--skr', '03'], ctx)).toBe(0);
    expect(ctx.out()).toContain(join(ctx.cwd, 'maps/hotel.csv'));
    const other = context({ 'other.csv': VALID });
    expect(await runCli(['mapping', 'check', '--mapping', 'other.csv', '--skr', '03'], other.ctx)).toBe(0);
  });

  it('reports E-BU-ON-AUTOMATIC for SKR03 8300 with BU key 2 and exits 1', async () => {
    const { ctx } = context({ 'mapping-BSP.csv': csv('5011;Revenues;Accommodation 7%;7;8300;2;;;;') });
    expect(await runCli(['mapping', 'check', '--property', BSP, '--skr', '03'], ctx)).toBe(1);
    expect(ctx.out()).toContain('E-BU-ON-AUTOMATIC');
    expect(ctx.out()).toContain('line 2');
    expect(ctx.out()).toContain('Result: 1 error, 0 warnings.');
  });

  it('reports E-ACCOUNT-LENGTH for 1360 at Sachkontenlänge 5', async () => {
    const config = CONFIG.replace('mandantennummer: 42', 'mandantennummer: 42\n  sachkontenlaenge: 5');
    const { ctx } = context({ 'mapping-BSP.csv': csv('1611;Payments;Visa;;1360;;;;;') }, undefined, config);
    expect(await runCli(['mapping', 'check', '--property', BSP, '--skr', '03'], ctx)).toBe(1);
    expect(ctx.out()).toContain('E-ACCOUNT-LENGTH');
    expect(ctx.out()).toContain('for example 13600');
    expect(ctx.out()).not.toContain('01360');
  });

  it('reports a VAT mismatch with both rates', async () => {
    const { ctx } = context({ 'mapping-BSP.csv': csv('5011;Revenues;Accommodation 7%;7;8400;;19;;;') });
    expect(await runCli(['mapping', 'check', '--property', BSP, '--skr', '03'], ctx)).toBe(1);
    expect(ctx.out()).toMatch(/E-VAT-MISMATCH .*VAT 7 %.*19 %/);
  });

  it('prints the W-PADDED warning for leading zeros Excel removed and still passes', async () => {
    const { ctx } = context({ 'mapping-BSP.csv': csv('9000;House;House;;650;;;;;') });
    expect(await runCli(['mapping', 'check', '--property', BSP, '--skr', '03'], ctx)).toBe(0);
    expect(ctx.out()).toContain('W-PADDED');
    expect(ctx.out()).toContain('Result: mapping OK (1 warning).');
  });

  it('fails with exit 1 on duplicate keys, naming both lines', async () => {
    const { ctx } = context({ 'mapping-BSP.csv': csv('5011;Revenues;A;7;8300;;;;;', '5011;Revenues;A;7;8301;;;;;') });
    expect(await runCli(['mapping', 'check', '--property', BSP], ctx)).toBe(1);
    expect(ctx.err()).toContain('lines 2 and 3 both map apaleo account 5011 of type Revenues');
  });

  it('fails with exit 1 and a hint when the mapping file is missing', async () => {
    const { ctx } = context({});
    expect(await runCli(['mapping', 'check', '--property', BSP], ctx)).toBe(1);
    expect(ctx.err()).toContain('No mapping file at');
    expect(ctx.err()).toContain('init-mapping');
  });

  it('warns about a Grman export and suggests init-mapping --update', async () => {
    const { ctx } = context({ 'grman.csv': 'ApaleoAccountNumber;DatevAccountNumber;CostCenter;CostCenter2\r\n5011;8300;;\r\n' });
    expect(await runCli(['mapping', 'check', '--mapping', 'grman.csv', '--skr', '03'], ctx)).toBe(0);
    expect(ctx.out()).toContain('Grman export layout');
    expect(ctx.out()).toContain('W-GRMAN-LAYOUT');
    expect(ctx.out()).toContain('init-mapping --update');
  });
});

describe('apaleo-datev mapping check --from --to', () => {
  it('fails with E-UNMAPPED for a new revenue account 5010, naming type, name, line count and gross total', async () => {
    const credit = { number: '5010', name: 'Spa', type: 'Revenues' };
    const ledger = [
      ledgerLine({ credit, grossCents: 4000 }),
      ledgerLine({ credit, grossCents: 6000, businessDate: '2026-09-15', sourceEntryNumber: 'BSPE0002' }),
    ];
    const { ctx, fake } = context({ 'mapping-BSP.csv': csv('*;Receivables;;;1410;;;;;') }, ledger);
    expect(await runCli(['mapping', 'check', '--property', BSP, '--from', '2026-09-14', '--to', '2026-09-15'], ctx)).toBe(1);
    expect(fake.calls).toContain(`getLedger ${BSP} 2026-09-14 2026-09-16`);
    expect(ctx.out()).toContain('Checked 2 ledger lines of BSP from 2026-09-14 to 2026-09-15: 1 unmapped account(s).');
    expect(ctx.out()).toContain('E-UNMAPPED');
    expect(ctx.out()).toContain('apaleo account 5010 (Revenues, "Spa") is not mapped (2 lines, gross 100.00)');
  });

  it('reports the empty city tax row of a fresh init-mapping file as E-UNMAPPED until it is filled in, then passes', async () => {
    const { ctx } = context({});
    expect(await runCli(['init-mapping', '--property', BSP, '--skr', '03'], ctx)).toBe(0);
    const period = ['mapping', 'check', '--property', BSP, '--from', '2026-09-14', '--to', '2026-09-22'];
    expect(await runCli(period, ctx)).toBe(1);
    const unmapped = ctx.out().split('\n').filter((line) => line.startsWith('E-UNMAPPED'));
    expect(unmapped.some((line) => line.includes('apaleo account 3501 (CityTaxes'))).toBe(true);

    const path = join(ctx.cwd, 'mapping-BSP.csv');
    const text = (await ctx.fs.readFile(path, 'utf8')).replace(/^3501;CityTaxes;City Tax 0%;0;;/m, '3501;CityTaxes;City Tax 0%;0;1590;');
    await ctx.fs.writeFile(path, text);
    const after = createTestContext({ files: { 'apaleo-datev.config.yaml': CONFIG, 'mapping-BSP.csv': text }, sourceFactory: () => new FakeSource(BEISPIEL) });
    expect(await runCli(period, after)).toBe(0);
    expect(after.out()).not.toContain('E-');
    // The untaxed deposit release of 2026-09-22 takes 7 % from its PostPrepaymentVat line and resolves to the 7 % deposit row.
    expect(after.out()).not.toMatch(/^W-/m);
    expect(after.out()).toContain('every booked account is mapped.');
    expect(after.out()).toContain('Result: mapping OK.');
  });

  it('fails with E-VAT-MISMATCH when a parent row maps 7 % revenue accounts to 8400', async () => {
    const parent = csv('5000;Revenues;Revenues;;8400;;;;;', '*;Receivables;;;1410;;;;;', '*;Payments;;;1360;;;;;');
    const ledger = BEISPIEL.ledger[BSP]?.filter((line) => line.credit.type === 'Revenues' && line.debit.type === 'Receivables') ?? [];
    const args = ['mapping', 'check', '--property', BSP, '--skr', '03', '--from', '2026-09-14', '--to', '2026-09-22'];
    const { ctx } = context({ 'mapping-BSP.csv': parent }, ledger);
    expect(await runCli(args, ctx)).toBe(1);
    const mismatches = ctx.out().split('\n').filter((line) => line.startsWith('E-VAT-MISMATCH'));
    expect(mismatches.some((line) => line.includes('apaleo account 5011 (Revenues') && line.includes('DATEV will apply 19 % on account 8400'))).toBe(true);
    expect(mismatches.some((line) => line.includes('apaleo account 5111 (Revenues'))).toBe(true);
    expect(ctx.out()).toContain('account(s) with the wrong VAT rate');
    expect(ctx.out()).not.toContain('Result: mapping OK');

    const grman = context({ 'grman.csv': 'ApaleoAccountNumber;DatevAccountNumber;CostCenter;CostCenter2\r\n5000;8400;;\r\n' }, ledger);
    expect(await runCli([...args, '--mapping', 'grman.csv'], grman.ctx)).toBe(1);
    expect(grman.ctx.out()).toContain('W-GRMAN-LAYOUT');
    expect(grman.ctx.out()).toMatch(/E-VAT-MISMATCH .*apaleo account 5011/);
  });

  it('does not resolve an untaxed deposit release through the 0 % Liabilities wildcard', async () => {
    const liabilities = { number: 'BSP-X-1_Liabilities', name: 'Liabilities', type: 'Liabilities' };
    const receivables = { number: 'BSP-X-1_Receivables', name: 'Receivables', type: 'Receivables' };
    const release = ledgerLine({ debit: liabilities, credit: receivables, taxes: [], command: 'System', reference: 'BSP-X-1' });
    const pair = ledgerLine({
      debit: { number: '2107', name: 'VAT on Liabilities 7%', type: 'VatOnLiabilities' },
      credit: liabilities,
      command: 'PostPrepaymentVat',
      grossCents: 654,
      taxes: [{ vatType: 'Reduced', percent: 7, amountCents: 654 }],
      reference: 'BSP-X-1',
    });
    const mapping = (...rows: string[]) => csv('*;Receivables;;;1410;;;;;', '*;Liabilities;;7;1711;;7;;;', '*;Liabilities;;19;1718;;19;;;', ...rows);
    const args = ['mapping', 'check', '--property', BSP, '--skr', '03', '--from', '2026-09-14', '--to', '2026-09-14'];

    const paired = context({ 'mapping-BSP.csv': mapping('*;Liabilities;;0;1719;;;;;') }, [release, pair]);
    expect(await runCli(args, paired.ctx)).toBe(0);
    expect(paired.ctx.out()).toContain('every booked account is mapped.');

    const unknown = context({ 'mapping-BSP.csv': mapping('*;Liabilities;;0;1719;;;;;') }, [release]);
    expect(await runCli(args, unknown.ctx)).toBe(1);
    expect(unknown.ctx.out()).toMatch(/E-VAT-RATE-UNKNOWN .*1 deposit release .*account BSP-X-1_Liabilities/);
    expect(unknown.ctx.out()).toContain('deposit releases without a known VAT rate');
    expect(unknown.ctx.out()).not.toContain('1719');
    expect(unknown.ctx.out()).not.toContain('wildcard row (*) for Liabilities at 0 %');
  });

  it('uses Grman rows for resolution', async () => {
    const grman = 'ApaleoAccountNumber;DatevAccountNumber;CostCenter;CostCenter2\r\n5010;8300;;\r\n';
    const ledger = [ledgerLine({ debit: { number: '1611', name: 'Visa', type: 'Payments' }, credit: { number: '5010', name: 'Spa', type: 'Revenues' } })];
    const { ctx } = context({ 'grman.csv': grman }, ledger);
    expect(await runCli(['mapping', 'check', '--property', BSP, '--mapping', 'grman.csv', '--from', '2026-09-14', '--to', '2026-09-14'], ctx)).toBe(1);
    expect(ctx.out()).toContain('apaleo account 1611 (Payments');
    expect(ctx.out()).not.toContain('apaleo account 5010');
  });
});

describe('apaleo-datev mapping usage', () => {
  it.each([
    [['mapping'], 'Usage: apaleo-datev mapping check'],
    [['mapping', 'lint'], 'Usage: apaleo-datev mapping check'],
    [['mapping', 'check', '--from', '2026-09-01'], '--from and --to go together'],
    [['mapping', 'check', '--from', '2026-09-31', '--to', '2026-10-01'], '--from must be a date'],
    [['mapping', 'check', '--from', '2026-09-02', '--to', '2026-09-01'], 'lies before'],
    [['mapping', 'check'], 'Name the mapping with --mapping'],
    [['mapping', 'check', '--mapping', 'x.csv', '--from', '2026-09-01', '--to', '2026-09-02'], 'needs --property'],
  ])('exits 2 on %j', async (argv, message) => {
    const { ctx } = context({});
    expect(await runCli(argv, ctx)).toBe(2);
    expect(ctx.err()).toContain(message);
  });
});
