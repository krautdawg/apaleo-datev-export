import { describe, expect, it } from 'vitest';
import { ChartIndex } from '../../src/core/chart.js';
import type { LedgerLine } from '../../src/core/source.js';
import {
  automaticRate,
  checkCoverage,
  checkMapping,
  datevVatRate,
  impliedVatRate,
  type CoverageOptions,
  type Mapping,
  type MappingRowValues,
} from '../../src/mapping/index.js';
import { releaseRateOf } from '../../src/posting/index.js';
import { BSP, loadBeispielData } from '../helpers/apaleo.js';
import { FakeSource } from '../helpers/fake-source.js';
import { ledgerLine, tax } from '../helpers/ledger.js';
import { mappingOf, mappingRow } from '../helpers/mapping.js';

const check = (rows: MappingRowValues[], sachkontenlaenge = 4, skr: '03' | '04' = '03') =>
  checkMapping(mappingOf(rows, sachkontenlaenge), { sachkontenlaenge, skr });
const codes = (findings: { code: string }[]) => findings.map((f) => f.code);

describe('checkMapping', () => {
  it('passes a valid mapping', () => {
    const findings = check([
      mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', apaleoVatPercent: '7', datevAccount: '8300', datevVatPercent: '7' }),
      mappingRow({ apaleoAccount: '5121', apaleoType: 'Revenues', apaleoVatPercent: '19', datevAccount: '8400' }),
      mappingRow({ apaleoAccount: '1400', apaleoType: 'AccountsReceivable', datevAccount: '10000' }),
      mappingRow({ apaleoAccount: '*', apaleoType: 'Payments', datevAccount: '1360' }),
      mappingRow({ apaleoAccount: '5990', apaleoType: 'Revenues', apaleoVatPercent: '0', datevAccount: '8200' }),
      mappingRow({ apaleoAccount: '5200', apaleoType: 'Revenues', apaleoVatPercent: '19', datevAccount: '8200', buKey: '3' }),
    ]);
    expect(findings).toEqual([]);
  });

  it('reports a VAT mismatch naming the row and both rates', () => {
    const [finding] = check([
      mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', apaleoVatPercent: '7', datevAccount: '8400', datevVatPercent: '19' }),
    ]);
    expect(finding?.code).toBe('E-VAT-MISMATCH');
    expect(finding?.message).toContain('line 2');
    expect(finding?.message).toContain('VAT 7 %');
    expect(finding?.message).toContain('apply 19 %');
  });

  it('derives the DATEV rate from an Automatikkonto or a BU key, else no VAT', () => {
    const rows = mappingOf([
      mappingRow({ apaleoAccount: '1', apaleoType: 'Revenues', datevAccount: '8400' }),
      mappingRow({ apaleoAccount: '2', apaleoType: 'Revenues', datevAccount: '8200', buKey: '2' }),
      mappingRow({ apaleoAccount: '3', apaleoType: 'Revenues', datevAccount: '8200' }),
      mappingRow({ apaleoAccount: '4', apaleoType: 'Revenues', datevAccount: '8200', datevVatPercent: '7,0' }),
    ]).rows;
    expect(rows.map((row) => datevVatRate(row, 4, '03'))).toEqual([19, 7, 0, 7]);
    expect(rows.map((row) => datevVatRate(row, 4, undefined))).toEqual([undefined, 7, undefined, 7]);
    expect(codes(check([mappingRow({ apaleoAccount: '1', apaleoType: 'Revenues', apaleoVatPercent: '7', datevAccount: '8400' })]))).toEqual([
      'E-VAT-MISMATCH',
    ]);
  });

  it('reports E-ACCOUNT-LENGTH for 1360 at Sachkontenlänge 5, suggesting 13600 and never padding to 01360', () => {
    const [finding, ...rest] = check([mappingRow({ apaleoAccount: '*', apaleoType: 'Payments', datevAccount: '1360' })], 5);
    expect(rest).toEqual([]);
    expect(finding?.code).toBe('E-ACCOUNT-LENGTH');
    expect(finding?.message).toContain('needs exactly 5 digits');
    expect(finding?.message).toContain('for example 13600');
    expect(finding?.message).toContain('Format the column as Text');
    expect(finding?.message).not.toContain('01360');
  });

  it('wants exactly one more digit for AccountsReceivable rows', () => {
    expect(codes(check([mappingRow({ apaleoAccount: '1400', apaleoType: 'AccountsReceivable', datevAccount: '1400' })]))).toEqual([
      'E-ACCOUNT-LENGTH',
    ]);
    expect(check([mappingRow({ apaleoAccount: '1400', apaleoType: 'AccountsReceivable', datevAccount: '100000' })], 5)).toEqual([]);
    expect(codes(check([mappingRow({ apaleoAccount: '9000', apaleoType: 'House', datevAccount: '123456' })]))).toEqual(['E-ACCOUNT-LENGTH']);
  });

  it('rejects non-digit accounts and malformed BU keys and percentages', () => {
    expect(
      codes(
        check([
          mappingRow({ apaleoAccount: '1', apaleoType: 'House', datevAccount: '83O0' }),
          mappingRow({ apaleoAccount: '2', apaleoType: 'House', datevAccount: '4900', buKey: '12345' }),
          mappingRow({ apaleoAccount: '3', apaleoType: 'House', datevAccount: '4900', datevVatPercent: 'sieben' }),
        ]),
      ),
    ).toEqual(['E-ACCOUNT-DIGITS', 'E-BU-KEY', 'E-VAT-PERCENT']);
  });

  it('reports E-BU-ON-AUTOMATIC for SKR03 8300 with BU key 2, also scaled to length 5', () => {
    const [finding] = check([mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', apaleoVatPercent: '7', datevAccount: '8300', buKey: '2' })]);
    expect(finding?.code).toBe('E-BU-ON-AUTOMATIC');
    expect(finding?.message).toContain('line 2');
    const scaled = check([mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', apaleoVatPercent: '7', datevAccount: '83000', buKey: '2' })], 5);
    expect(codes(scaled)).toEqual(['E-BU-ON-AUTOMATIC']);
  });

  it('reports E-VAT-CONFLICT when datev_vat_percent contradicts the Automatikkonto, and uses the account rate', () => {
    // An edited row: food at 7 % moved to the 19 % Automatikkonto 8400 but the rate column left at 7.
    const findings = check([mappingRow({ apaleoAccount: '5111', apaleoType: 'Revenues', apaleoName: 'Food 7%', apaleoVatPercent: '7', datevAccount: '8400', datevVatPercent: '7' })]);
    expect(codes(findings)).toEqual(['E-VAT-CONFLICT', 'E-VAT-MISMATCH']);
    expect(findings[0]?.message).toContain('datev_vat_percent says 7 %, but DATEV will apply 19 % because of Automatikkonto 8400');
    expect(findings[1]?.message).toContain('apply 19 % on account 8400');
    const [row] = mappingOf([mappingRow({ apaleoAccount: '5111', apaleoType: 'Revenues', datevAccount: '8400', datevVatPercent: '7' })]).rows;
    expect(row && datevVatRate(row, 4, '03')).toBe(19);
  });

  it('reports E-VAT-CONFLICT when datev_vat_percent contradicts an output-tax BU key, and uses the key rate', () => {
    const findings = check([mappingRow({ apaleoAccount: '5111', apaleoType: 'Revenues', apaleoVatPercent: '7', datevAccount: '8200', buKey: '3', datevVatPercent: '7' })]);
    expect(codes(findings)).toEqual(['E-VAT-CONFLICT', 'E-VAT-MISMATCH']);
    expect(findings[0]?.message).toContain('BU key 3 (19 % output tax)');
    // Without an SKR the key still decides.
    const mapping = mappingOf([mappingRow({ apaleoAccount: '5111', apaleoType: 'Revenues', apaleoVatPercent: '7', datevAccount: '8200', buKey: '3', datevVatPercent: '7' })]);
    expect(codes(checkMapping(mapping, { sachkontenlaenge: 4 }))).toEqual(['N-SKR-UNKNOWN', 'E-VAT-CONFLICT', 'E-VAT-MISMATCH']);
  });

  it('accepts a datev_vat_percent that agrees with the account or key', () => {
    expect(check([mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', apaleoVatPercent: '7', datevAccount: '8300', datevVatPercent: '7,0' })])).toEqual([]);
    expect(check([mappingRow({ apaleoAccount: '5200', apaleoType: 'Revenues', apaleoVatPercent: '19', datevAccount: '8200', buKey: '3', datevVatPercent: '19' })])).toEqual([]);
  });

  it('treats the Aufhebung key 40 on an Automatikkonto as no VAT', () => {
    const findings = check([mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', apaleoName: 'Acc 7%', apaleoVatPercent: '7', datevAccount: '8300', buKey: '40' })]);
    expect(codes(findings)).toEqual(['E-VAT-MISMATCH']);
    expect(findings[0]?.message).toContain('apply 0 % on account 8300 (BU key 40, which lifts the automatic 7 %');
    expect(impliedVatRate({ datevAccount: '8300', buKey: '40' }, 4, '03')?.rate).toBe(0);
    expect(impliedVatRate({ datevAccount: '8300', buKey: '43' }, 4, '03')?.rate).toBe(19);
    // The Generalumkehr keeps the automatic rate.
    expect(impliedVatRate({ datevAccount: '8300', buKey: '20' }, 4, '03')?.rate).toBe(7);
    expect(check([mappingRow({ apaleoAccount: '5990', apaleoType: 'Revenues', apaleoVatPercent: '0', datevAccount: '8300', buKey: '40' })])).toEqual([]);
  });

  it('allows a Generalumkehr or Aufhebung key on an Automatikkonto', () => {
    expect(check([mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', datevAccount: '8300', buKey: '40' })])).toEqual([]);
    expect(check([mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', datevAccount: '8300', buKey: '20' })])).toEqual([]);
  });

  it('reports E-BU-INPUT-TAX for an input-tax key on a revenue, deposit or bad-debt row', () => {
    const nine = check([mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', apaleoName: 'A', apaleoVatPercent: '7', datevAccount: '8200', buKey: '9', datevVatPercent: '7' })]);
    expect(codes(nine)).toEqual(['E-BU-INPUT-TAX', 'E-VAT-CONFLICT', 'E-VAT-MISMATCH']);
    expect(nine[0]?.message).toContain('BU key 9 books 19 % input tax (Vorsteuer)');
    expect(nine[2]?.message).toContain('BU key 9 (19 % input tax)');
    const eight = check([mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', apaleoVatPercent: '7', datevAccount: '8200', buKey: '8', datevVatPercent: '7' })]);
    expect(codes(eight)).toEqual(['E-BU-INPUT-TAX']);
    for (const apaleoType of ['Liabilities', 'CityTaxes', 'SecondCityTax', 'GuestLevies', 'LossOfAccountsReceivable']) {
      expect(codes(check([mappingRow({ apaleoAccount: '1', apaleoType, datevAccount: '1590', buKey: '28' })]))).toEqual(['E-BU-INPUT-TAX']);
    }
    // Lifting an Automatikkonto to an input-tax key is just as wrong.
    expect(codes(check([mappingRow({ apaleoAccount: '5121', apaleoType: 'Revenues', apaleoVatPercent: '19', datevAccount: '8400', buKey: '49' })]))).toEqual([
      'E-BU-INPUT-TAX',
    ]);
    expect(check([mappingRow({ apaleoAccount: '9000', apaleoType: 'House', datevAccount: '4900', buKey: '9' })])).toEqual([]);
  });

  it('knows the tax keys 2, 3, 8 and 9, also after a Generalumkehr', () => {
    expect(impliedVatRate({ datevAccount: '8200', buKey: '8' }, 4, '03')).toEqual({ rate: 7, reason: 'BU key 8 (7 % input tax)' });
    expect(impliedVatRate({ datevAccount: '8200', buKey: '23' }, 4, '03')?.rate).toBe(19);
    expect(impliedVatRate({ datevAccount: '8200', buKey: '29' }, 4, undefined)?.rate).toBe(19);
    expect(impliedVatRate({ datevAccount: '8200', buKey: '5' }, 4, '03')).toBeUndefined();
    expect(impliedVatRate({ datevAccount: '8300', buKey: '41' }, 4, '03')).toBeUndefined();
  });

  it('warns W-BU-KEY-UNCHECKED for a key it does not know, and does not guess its rate', () => {
    const trusted = check([mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', apaleoVatPercent: '7', datevAccount: '8200', buKey: '5', datevVatPercent: '7' })]);
    expect(codes(trusted)).toEqual(['W-BU-KEY-UNCHECKED']);
    expect(trusted[0]?.message).toContain('so it trusts datev_vat_percent (7 %)');
    const blind = mappingOf([mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', apaleoVatPercent: '7', datevAccount: '8200', buKey: '12' })]);
    const findings = checkMapping(blind, { sachkontenlaenge: 4 });
    expect(codes(findings)).toEqual(['N-SKR-UNKNOWN', 'W-BU-KEY-UNCHECKED']);
    expect(findings[1]?.message).toContain('datev_vat_percent is empty, so it cannot check');
    expect(blind.rows[0] && datevVatRate(blind.rows[0], 4, undefined)).toBeUndefined();
    expect(blind.rows[0] && datevVatRate(blind.rows[0], 4, '03')).toBeUndefined();
    expect(codes(check([mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', apaleoVatPercent: '7', datevAccount: '8300', buKey: '41' })]))).toEqual([
      'W-BU-KEY-UNCHECKED',
    ]);
  });

  it('knows the Automatikkonten per SKR', () => {
    expect(automaticRate('03', '8300', 4)).toBe(7);
    expect(automaticRate('04', '8300', 4)).toBeUndefined();
    expect(automaticRate('04', '43000', 5)).toBe(7);
    expect(automaticRate('04', '43001', 5)).toBeUndefined();
    expect(automaticRate('03', '1718', 4)).toBe(19);
  });

  it('skips the Automatikkonto checks with a note when the SKR is unknown', () => {
    const mapping = mappingOf([mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', datevAccount: '8300', buKey: '2' })]);
    const findings = checkMapping(mapping, { sachkontenlaenge: 4 });
    expect(codes(findings)).toEqual(['N-SKR-UNKNOWN']);
  });

  it('takes the SKR from the template marker of the file', () => {
    const mapping = mappingOf([mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', datevAccount: '4300', buKey: '2' })], 4, [
      'Vorlage skr04-hotel@1',
    ]);
    expect(codes(checkMapping(mapping, { sachkontenlaenge: 4 }))).toEqual(['E-BU-ON-AUTOMATIC']);
  });

  it('ignores rows for Vat and VatOnLiabilities accounts with a note', () => {
    const findings = check([
      mappingRow({ apaleoAccount: '2007', apaleoType: 'Vat', datevAccount: 'x' }),
      mappingRow({ apaleoAccount: '2107', apaleoType: 'VatOnLiabilities' }),
    ]);
    expect(codes(findings)).toEqual(['N-VAT-ROW-IGNORED']);
    expect(findings[0]?.message).toContain('2 row(s)');
  });

  it('warns about unknown apaleo types', () => {
    expect(codes(check([mappingRow({ apaleoAccount: '1', apaleoType: 'Revenue', datevAccount: '8200' })]))).toEqual(['W-UNKNOWN-TYPE']);
  });

  it('warns that a Grman export lacks BU keys and VAT rates and suggests init-mapping --update', () => {
    const grman = { ...mappingOf([]), layout: 'grman' as const };
    const [finding] = checkMapping(grman, { sachkontenlaenge: 4, skr: '03' });
    expect(finding?.code).toBe('W-GRMAN-LAYOUT');
    expect(finding?.message).toContain('init-mapping --update');
  });
});

describe('checkCoverage', () => {
  const lines = (overrides: Partial<LedgerLine>[]) => overrides.map((o) => ledgerLine(o));
  const coverage = (mapping: Mapping, ledger: LedgerLine[], chart?: ChartIndex, options: Partial<CoverageOptions> = {}) =>
    checkCoverage(mapping, ledger, chart, { sachkontenlaenge: 4, rateOf: releaseRateOf(ledger, chart), ...options });

  it('reports a new revenue account with number, type, name, line count and gross total', () => {
    const mapping = mappingOf([mappingRow({ apaleoAccount: '*', apaleoType: 'Receivables', datevAccount: '1410' })]);
    const credit = { number: '5010', name: 'Spa', type: 'Revenues' };
    const findings = coverage(mapping, lines([{ credit, grossCents: 5000 }, { credit, grossCents: 2550 }]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: 'E-UNMAPPED', value: '5010' });
    expect(findings[0]?.message).toBe(
      'apaleo account 5010 (Revenues, "Spa") is not mapped (2 lines, gross 75.50): add a row with apaleo_account 5010, apaleo_type Revenues and a DATEV account',
    );
  });

  it('treats a row without a DATEV account as unmapped and points at its line', () => {
    const mapping = mappingOf([
      mappingRow({ apaleoAccount: '*', apaleoType: 'Receivables', datevAccount: '1410' }),
      mappingRow({ apaleoAccount: '3501', apaleoType: 'CityTaxes' }),
    ]);
    const [finding] = coverage(mapping, lines([{ credit: { number: '3501', name: 'City Tax 0%', type: 'CityTaxes' }, taxes: [] }]));
    expect(finding?.message).toContain('fill in datev_account on line 3');
  });

  it('suggests a rate wildcard for a VAT-relevant account without a row', () => {
    const mapping = mappingOf([mappingRow({ apaleoAccount: '*', apaleoType: 'Receivables', datevAccount: '1410' })]);
    const credit = { number: 'BSP-X-1_Liabilities', name: 'Liabilities', type: 'Liabilities' };
    const [finding] = coverage(mapping, lines([{ credit }]));
    expect(finding?.message).toContain('or a wildcard row (*) for Liabilities at 7 %');
  });

  it('resolves an untaxed deposit release with the inferred rate only, never through the 0 % row', () => {
    const liabilities = { number: 'BSP-X-1_Liabilities', name: 'Liabilities', type: 'Liabilities' };
    const receivables = { number: 'BSP-X-1_Receivables', name: 'R', type: 'Receivables' };
    const release = ledgerLine({ debit: liabilities, credit: receivables, taxes: [], reference: 'BSP-X-1' });
    const without = ledgerLine({ debit: liabilities, credit: receivables, taxes: [tax('Without', 0, 0)] });
    const taxed = ledgerLine({ debit: liabilities, credit: receivables, taxes: [tax('Reduced', 7, 654)] });
    const untaxedRevenue = ledgerLine({ credit: { number: '5990', name: 'No VAT', type: 'Revenues' }, taxes: [] });
    const rateOf = releaseRateOf([release, without, taxed, untaxedRevenue], undefined);
    expect([release, without, taxed, untaxedRevenue].map(rateOf)).toEqual([undefined, undefined, 7, 0]);

    const pair = ledgerLine({
      debit: { number: '2107', name: 'VAT on Liabilities 7%', type: 'VatOnLiabilities' },
      credit: liabilities,
      command: 'PostPrepaymentVat',
      grossCents: 654,
      taxes: [tax('Reduced', 7, 654)],
      reference: 'BSP-X-1',
    });
    expect(releaseRateOf([release, pair], undefined)(release)).toBe(7);

    // An untaxed refund resolves through the same pair; without it, it stays at 0 %.
    const refund = ledgerLine({ debit: liabilities, credit: { number: '1611', name: 'Visa', type: 'Payments' }, taxes: [], reference: 'BSP-X-1' });
    expect(releaseRateOf([refund, pair], undefined)(refund)).toBe(7);
    expect(releaseRateOf([refund], undefined)(refund)).toBe(0);
  });

  it('skips lines with a Vat or VatOnLiabilities side and accepts rates from the caller', () => {
    const mapping = mappingOf([
      mappingRow({ apaleoAccount: '*', apaleoType: 'Liabilities', apaleoVatPercent: '7', datevAccount: '1711' }),
      mappingRow({ apaleoAccount: '*', apaleoType: 'Receivables', datevAccount: '1410' }),
    ]);
    const liabilities = { number: 'BSP-X-1_Liabilities', name: 'Liabilities', type: 'Liabilities' };
    const vat = { number: '2107', name: 'VAT on Liabilities 7%', type: 'VatOnLiabilities' };
    const release = { debit: liabilities, credit: { number: 'BSP-X-1_Receivables', name: 'R', type: 'Receivables' }, taxes: [] };
    expect(coverage(mapping, lines([{ debit: liabilities, credit: vat }]))).toEqual([]);
    expect(codes(coverage(mapping, lines([release])))).toEqual(['E-VAT-RATE-UNKNOWN']);
    expect(coverage(mapping, lines([release]), undefined, { rateOf: () => 7 })).toEqual([]);
  });

  it('finds the unmapped accounts of the Hotel Beispiel fixtures through a FakeSource', async () => {
    const fake = new FakeSource(await loadBeispielData());
    const chart = new ChartIndex(await fake.getChartOfAccounts(BSP));
    const ledger = await fake.getLedger(BSP, '2026-09-14', '2026-09-23');
    const mapping = mappingOf([
      mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', datevAccount: '8300' }),
      mappingRow({ apaleoAccount: '1200', apaleoType: 'Receivables', datevAccount: '1410' }),
      mappingRow({ apaleoAccount: '*', apaleoType: 'Receivables', datevAccount: '1410' }),
      mappingRow({ apaleoAccount: '*', apaleoType: 'Payments', datevAccount: '1360' }),
      mappingRow({ apaleoAccount: '*', apaleoType: 'Liabilities', apaleoVatPercent: '7', datevAccount: '1711' }),
      mappingRow({ apaleoAccount: '*', apaleoType: 'Liabilities', apaleoVatPercent: '0', datevAccount: '1719' }),
      mappingRow({ apaleoAccount: '3501', apaleoType: 'CityTaxes' }),
    ]);
    const findings = coverage(mapping, ledger, chart, { skr: '03' });
    // The untaxed deposit release of 2026-09-22 gets 7 % from its PostPrepaymentVat line and resolves to 1711.
    expect(findings.map((f) => [f.code, f.value])).toEqual([
      ['E-UNMAPPED', '1400'],
      ['E-UNMAPPED', '3501'],
      ['E-UNMAPPED', '5111'],
      ['E-UNMAPPED', '5121'],
    ]);
  });

  it('reports untaxed deposit releases without an inferable rate once, never through the 0 % row', () => {
    const receivables = mappingRow({ apaleoAccount: '*', apaleoType: 'Receivables', datevAccount: '1410' });
    const release = (n: number) => ({
      debit: { number: `BSP-X-${n}_Liabilities`, name: 'Liabilities', type: 'Liabilities' },
      credit: { number: `BSP-X-${n}_Receivables`, name: 'R', type: 'Receivables' },
      taxes: [],
      grossCents: 5000,
      reference: `BSP-X-${n}`,
    });
    const ledger = lines([release(1), release(2), release(3), release(4), release(1)]);
    const zero = mappingOf([receivables, mappingRow({ apaleoAccount: '*', apaleoType: 'Liabilities', apaleoVatPercent: '0', datevAccount: '1719' })]);
    const findings = coverage(zero, ledger);
    expect(codes(findings)).toEqual(['E-VAT-RATE-UNKNOWN']);
    expect(findings[0]).toMatchObject({ value: 'BSP-X-1_Liabilities' });
    expect(findings[0]?.message).toMatch(
      /^5 deposit releases \(5 lines, gross 250\.00, accounts BSP-X-1_Liabilities, BSP-X-2_Liabilities, BSP-X-3_Liabilities and 1 more\): apaleo settled a guest's prepaid deposit against the bill without a VAT amount, and the VAT rate cannot be found/,
    );
    expect(findings[0]?.message).not.toContain('1719');
  });

  it('asks for a deposit row at the inferred rate when the mapping has none', () => {
    const liabilities = { number: 'BSP-X-1_Liabilities', name: 'Liabilities', type: 'Liabilities' };
    const ledger = lines([
      { debit: liabilities, credit: { number: 'BSP-X-1_Receivables', name: 'R', type: 'Receivables' }, taxes: [], grossCents: 11900, reference: 'BSP-X-1' },
      {
        debit: { number: '2119', name: 'VAT on Liabilities 19%', type: 'VatOnLiabilities' },
        credit: liabilities,
        command: 'PostPrepaymentVat',
        grossCents: 1900,
        taxes: [tax('Normal', 19, 1900)],
        reference: 'BSP-X-1',
      },
    ]);
    const mapping = mappingOf([
      mappingRow({ apaleoAccount: '*', apaleoType: 'Receivables', datevAccount: '1410' }),
      mappingRow({ apaleoAccount: '*', apaleoType: 'Liabilities', apaleoVatPercent: '7', datevAccount: '1711' }),
    ]);
    const [finding, ...rest] = coverage(mapping, ledger);
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({ code: 'E-UNMAPPED', value: 'BSP-X-1_Liabilities' });
    expect(finding?.message).toContain('or a wildcard row (*) for Liabilities at 19 %');
  });

  describe('accounts of reservations and folios (outside the chart, with a parent)', () => {
    const chart = new ChartIndex([
      { number: '3000', name: 'Liabilities', type: 'Liabilities', ledger: 'guest', isArchived: false, hasChildren: true },
      { number: '9999', name: 'Accounts Receivable', type: 'AccountsReceivable', ledger: 'guest', isArchived: false, hasChildren: true },
    ]);
    const receivables = { number: 'R-1_Receivables', name: 'Receivables for Reservation R-1', type: 'Receivables', parentNumber: '1200' };
    const deposit = (id: string) => ({ number: `${id}_Liabilities/Reduced:7.00`, name: `Liabilities for Reservation ${id} (7%)`, type: 'Liabilities', parentNumber: '3000' });
    const base = [mappingRow({ apaleoAccount: '*', apaleoType: 'Receivables', datevAccount: '1410' }), mappingRow({ apaleoAccount: '*', apaleoType: 'Payments', datevAccount: '1360' })];

    it('reports five deposits under the empty 3000 row once, with three examples and the wildcard row to add', () => {
      const mapping = mappingOf([...base, mappingRow({ apaleoAccount: '3000', apaleoType: 'Liabilities', apaleoName: 'Liabilities' })]);
      const ledger = ['A-1', 'B-1', 'C-1', 'D-1', 'E-1'].map((id) => ledgerLine({ debit: receivables, credit: deposit(id), command: 'PostCharge', grossCents: -1000, taxes: [tax('Reduced', 7, -65)] }));
      const findings = coverage(mapping, ledger, chart, { skr: '03' });
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ code: 'E-UNMAPPED', value: '3000' });
      expect(findings[0]?.message).toBe(
        '5 Liabilities accounts of reservations or folios under parent 3000 at 7 % (A-1_Liabilities/Reduced:7.00, B-1_Liabilities/Reduced:7.00, ' +
          'C-1_Liabilities/Reduced:7.00 and 2 more) are not mapped (5 lines, gross -50.00): the parent row for 3000 on line 4 has no DATEV account ' +
          'and does not apply to Liabilities at different VAT rates; add a wildcard row `*;Liabilities;;7;<DATEV account>;;7` (template: 1711)',
      );
      expect(findings[0]?.message).not.toContain('fill in');
    });

    it('suggests the same wildcard row when there is no parent row at all, and the account only without an SKR', () => {
      const ledger = [ledgerLine({ debit: receivables, credit: deposit('A-1'), grossCents: -1000, taxes: [tax('Reduced', 7, -65)] })];
      expect(coverage(mappingOf(base), ledger, chart, { skr: '04' })[0]?.message).toMatch(/: add a wildcard row `\*;Liabilities;;7;<DATEV account>;;7` \(template: 3260\)$/);
      expect(coverage(mappingOf(base), ledger, chart)[0]?.message).toMatch(/: add a wildcard row `\*;Liabilities;;7;<DATEV account>;;7`$/);
    });

    it('reports a per-reservation debtor and its /Offset once and suggests a 9999 row or the collective-debtor wildcard', () => {
      const debtor = { number: 'ZAQSEFYC-1_AccountsReceivable', name: 'AccountsReceivable for Reservation ZAQSEFYC-1', type: 'AccountsReceivable', parentNumber: '9999' };
      const offset = { ...debtor, number: `${debtor.number}/Offset`, name: `${debtor.name} (Offset)` };
      const ledger = [
        ledgerLine({ debit: receivables, credit: offset, command: 'PostToAccountsReceivables', grossCents: -11400, taxes: [] }),
        ledgerLine({ debit: debtor, credit: offset, command: 'PostToAccountsReceivables', grossCents: 11400, taxes: [] }),
      ];
      const findings = coverage(mappingOf(base), ledger, chart, { skr: '03' });
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toMatch(
        /^2 AccountsReceivable accounts of reservations or folios under parent 9999 \(ZAQSEFYC-1_AccountsReceivable, ZAQSEFYC-1_AccountsReceivable\/Offset\) are not mapped \(3 lines, gross [-\d.]+\): add a row for 9999 AccountsReceivable or the wildcard row `\*;AccountsReceivable;;;10000` \(collective debtor\)$/,
      );
    });

    it('passes once the AccountsReceivable wildcard exists', () => {
      const debtor = { number: 'ZAQSEFYC-1_AccountsReceivable', name: 'AR', type: 'AccountsReceivable', parentNumber: '9999' };
      const mapping = mappingOf([...base, mappingRow({ apaleoAccount: '*', apaleoType: 'AccountsReceivable', datevAccount: '10000' })]);
      expect(coverage(mapping, [ledgerLine({ debit: debtor, credit: receivables, taxes: [] })], chart, { skr: '03' })).toEqual([]);
    });
  });

  it('reports E-VAT-MISMATCH when a parent row maps a 7 % revenue account to a 19 % Automatikkonto', () => {
    const mapping = mappingOf([
      mappingRow({ apaleoAccount: '5000', apaleoType: 'Revenues', apaleoName: 'Revenues', datevAccount: '8400' }),
      mappingRow({ apaleoAccount: '*', apaleoType: 'Receivables', datevAccount: '1410' }),
    ]);
    const food = { number: '5111', name: 'Food 7%', type: 'Revenues', parentNumber: '5000' };
    const drinks = { number: '5121', name: 'Beverages 19%', type: 'Revenues', parentNumber: '5000' };
    const ledger = lines([
      { credit: food, grossCents: 1200 },
      { credit: food, grossCents: 1200 },
      { credit: drinks, grossCents: 380, taxes: [tax('Normal', 19, 61)] },
    ]);
    const findings = coverage(mapping, ledger, undefined, { skr: '03' });
    expect(codes(findings)).toEqual(['E-VAT-MISMATCH']);
    expect(findings[0]).toMatchObject({ value: '5111' });
    expect(findings[0]?.message).toBe(
      'apaleo account 5111 (Revenues, "Food 7%") is booked at 7 % (2 lines, gross 24.00), but it uses line 2 (apaleo account 5000) ' +
        'of the mapping, and DATEV will apply 19 % on account 8400 (Automatikkonto 8400 (SKR 03, 19 %)). ' +
        'Add a row for 5111 Revenues with a DATEV account for 7 %',
    );
    // Without the SKR the Automatikkonto is unknown, so the rate cannot be checked.
    expect(coverage(mapping, ledger)).toEqual([]);
    // A Grman row matches the number with any type and is checked the same way.
    const grman = { ...mappingOf([mappingRow({ apaleoAccount: '5000', apaleoType: '*any*', datevAccount: '8400' }), mappingRow({ apaleoAccount: '*', apaleoType: 'Receivables', datevAccount: '1410' })]), layout: 'grman' as const };
    expect(codes(coverage(grman, ledger, undefined, { skr: '03' }))).toEqual(['E-VAT-MISMATCH']);
  });

  it('leaves the rate of a row with its own apaleo_vat_percent to checkMapping', () => {
    const mapping = mappingOf([
      mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', apaleoVatPercent: '7', datevAccount: '8400' }),
      mappingRow({ apaleoAccount: '*', apaleoType: 'Receivables', datevAccount: '1410' }),
    ]);
    expect(coverage(mapping, lines([{}]), undefined, { skr: '03' })).toEqual([]);
    expect(codes(checkMapping(mapping, { sachkontenlaenge: 4, skr: '03' }))).toEqual(['E-VAT-MISMATCH']);
  });
});
