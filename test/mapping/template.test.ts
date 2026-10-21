import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SourceAccount } from '../../src/core/source.js';
import {
  AUTOMATIC_ACCOUNTS,
  checkMapping,
  loadTemplate,
  parseTemplate,
  scaleAccount,
  suggestRows,
  type MappingRowValues,
  type Skr,
  type Template,
} from '../../src/mapping/index.js';
import { BSP, loadBeispielData } from '../helpers/apaleo.js';
import { mappingOf, mappingRow } from '../helpers/mapping.js';

const SKRS: Skr[] = ['03', '04'];

const account = (number: string, name: string, type: string, extra: Partial<SourceAccount> = {}): SourceAccount => ({
  number,
  name,
  type,
  ledger: 'global',
  isArchived: false,
  hasChildren: false,
  ...extra,
});

async function beispielChart(): Promise<SourceAccount[]> {
  return (await loadBeispielData()).charts[BSP] ?? [];
}

const find = (rows: MappingRowValues[], number: string, type?: string) =>
  rows.find((r) => r.apaleoAccount === number && (type === undefined || r.apaleoType === type));

/** Every rule of a template as a mapping row, so `checkMapping` can check the numbers. */
function templateRows(template: Template, sachkontenlaenge: number): MappingRowValues[] {
  return template.rules
    .filter((rule) => rule.datevAccount !== '')
    .map((rule, i) =>
      mappingRow({
        apaleoAccount: String(i),
        apaleoType: rule.apaleoType,
        apaleoVatPercent: rule.apaleoVatPercent === undefined ? '' : String(rule.apaleoVatPercent),
        datevAccount: scaleAccount(rule.datevAccount, rule.apaleoType, sachkontenlaenge),
        buKey: rule.buKey,
        datevVatPercent: rule.datevVatPercent,
      }),
    );
}

describe.each(SKRS)('SKR%s hotel template', (skr) => {
  it('names its version and has a "Vorschlag" comment and no BU key on every rule', async () => {
    const template = await loadTemplate(skr);
    expect(template.id).toBe(`skr${skr}-hotel@2`);
    expect(template.rules.length).toBeGreaterThan(15);
    for (const rule of template.rules) {
      expect(rule.comment).toMatch(/^Vorschlag/);
      expect(rule.buKey).toBe('');
      expect(rule.datevAccount).toMatch(/^(\d{4}|\d{5})?$/);
    }
  });

  it('records the verification source and date on every rule with an account', async () => {
    for (const rule of (await loadTemplate(skr)).rules.filter((r) => r.datevAccount !== '')) {
      expect(rule.comment).toContain(`https://www.collmex.de/skr${skr}.pdf, geprüft 2026-10-20`);
    }
  });

  it.each([4, 5, 8])('passes checkMapping at Sachkontenlänge %i', async (sachkontenlaenge) => {
    const template = await loadTemplate(skr);
    const mapping = mappingOf(templateRows(template, sachkontenlaenge), sachkontenlaenge);
    expect(checkMapping(mapping, { sachkontenlaenge, skr })).toEqual([]);
  });

  it('uses every Automatikkonto it lists and only with the matching rate', async () => {
    const template = await loadTemplate(skr);
    const used = new Set(template.rules.map((r) => r.datevAccount));
    for (const [number, rate] of AUTOMATIC_ACCOUNTS[skr]) {
      expect(used.has(number)).toBe(true);
      for (const rule of template.rules.filter((r) => r.datevAccount === number)) expect(rule.datevVatPercent).toBe(String(rate));
    }
  });

  it('suggests rows for the fixture chart: food 7 %, drinks 19 %, cards to Geldtransit, nothing guessed', async () => {
    const { rows } = suggestRows(await beispielChart(), await loadTemplate(skr), 4);
    const accounts = skr === '03'
      ? { e7: '8300', e19: '8400', e0: '8200', kasse: '1000', transit: '1360', ford: '1410', anz7: '1711', anz19: '1718', anz0: '1719' }
      : { e7: '4300', e19: '4400', e0: '4200', kasse: '1600', transit: '1460', ford: '1210', anz7: '3260', anz19: '3272', anz0: '3280' };
    const loss = skr === '03' ? { v7: '2401', v19: '2406' } : { v7: '6931', v19: '6936' };
    expect(find(rows, '5011')?.datevAccount).toBe(accounts.e7); // Accommodation 7%
    expect(find(rows, '5019')?.datevAccount).toBe(accounts.e19); // Accommodation 19%
    expect(find(rows, '5111')?.datevAccount).toBe(accounts.e7); // Food 7%
    expect(find(rows, '5111')?.comment).toContain('eigenes 7-%-Erlöskonto für Speisen');
    expect(find(rows, '5121')?.datevAccount).toBe(accounts.e19); // Beverages 19%
    expect(find(rows, '5990')).toMatchObject({ datevAccount: accounts.e0, comment: expect.stringMatching(/^archiviert\. Vorschlag/) });
    expect(find(rows, '1600')?.datevAccount).toBe(accounts.kasse); // Cash
    expect(find(rows, '1611')?.datevAccount).toBe(accounts.transit); // Visa
    expect(find(rows, '1612')?.datevAccount).toBe(accounts.transit); // Mastercard
    expect(find(rows, '1200', 'Receivables')?.datevAccount).toBe(accounts.ford);
    expect(find(rows, '1400')?.datevAccount).toBe('10000');
    expect(find(rows, '3007')?.datevAccount).toBe(accounts.anz7);
    expect(find(rows, '3019')?.datevAccount).toBe(accounts.anz19);
    for (const number of ['9000', '3501', '2007', '2107']) {
      const row = find(rows, number);
      expect(row?.datevAccount).toBe('');
      expect(row?.comment).toMatch(/^Vorschlag: /);
    }
    expect(find(rows, '3501')?.comment).toContain('Durchlaufende Posten SKR03 1590 / SKR04 1370, 0 %');
    expect(find(rows, '3501')?.comment).toContain('Erlös 7 %');
    // Wildcards, after the rows of their type.
    expect(rows.filter((r) => r.apaleoAccount === '*').map((r) => [r.apaleoType, r.apaleoVatPercent, r.datevAccount])).toEqual([
      ['Payments', '', accounts.transit],
      ['Liabilities', '7', accounts.anz7],
      ['Liabilities', '19', accounts.anz19],
      ['Liabilities', '0', accounts.anz0],
      ['Liabilities', '16', ''],
      ['Liabilities', '5', ''],
      ['Receivables', '', accounts.ford],
      ['AccountsReceivable', '', '10000'],
      ['LossOfAccountsReceivable', '7', loss.v7],
      ['LossOfAccountsReceivable', '19', loss.v19],
    ]);
    // Parents get no row; 3000 (guest and booking) has children of the same type.
    for (const parent of ['1000', '1610', '5000', '5010', '5100', '3000']) expect(find(rows, parent)).toBeUndefined();
  });
});

describe('template rules', () => {
  it('keeps House, TransitoryItems and CityTaxes empty with an explanatory comment', async () => {
    const chart = [
      account('9000', 'House', 'House'),
      account('9100', 'Transitory', 'TransitoryItems'),
      account('3501', 'Kurtaxe', 'CityTaxes', { vat: { type: 'Without', percent: 0 } }),
      account('3600', 'Zweite Stadtsteuer', 'SecondCityTax'),
      account('3700', 'Gästeabgabe', 'GuestLevies'),
    ];
    const { rows } = suggestRows(chart, await loadTemplate('03'), 4);
    for (const row of rows.filter((r) => r.apaleoAccount !== '*')) {
      expect(row.datevAccount).toBe('');
      expect(row.comment.length).toBeGreaterThan(40);
    }
  });

  it('maps "Frühstück Speisen" at 7 % to the 7 % and "Getränke" at 19 % to the 19 % revenue account', async () => {
    const chart = [
      account('5111', 'Frühstück Speisen', 'Revenues', { vat: { type: 'Reduced', percent: 7 } }),
      account('5121', 'Getränke', 'Revenues', { vat: { type: 'Normal', percent: 19 } }),
    ];
    const { rows } = suggestRows(chart, await loadTemplate('04'), 4);
    expect(rows.map((r) => [r.apaleoAccount, r.datevAccount, r.datevVatPercent])).toEqual([
      ['5111', '4300', '7'],
      ['5121', '4400', '19'],
      ['*', '1460', ''],
      ['*', '3260', '7'],
      ['*', '3272', '19'],
      ['*', '3280', '0'],
      ['*', '', ''],
      ['*', '', ''],
      ['*', '1210', ''],
      ['*', '10000', ''],
      ['*', '6931', '7'],
      ['*', '6936', '19'],
    ]);
  });

  it('matches name patterns on parent names too, and leaves an unmatched 7 % revenue empty', async () => {
    const chart = [
      account('5100', 'Restaurant', 'Revenues', { hasChildren: true }),
      account('5101', 'Menü 7%', 'Revenues', { parentNumber: '5100', vat: { type: 'Reduced', percent: 7 } }),
      account('5200', 'Spa 7%', 'Revenues', { vat: { type: 'Reduced', percent: 7 } }),
    ];
    const { rows } = suggestRows(chart, await loadTemplate('03'), 4);
    expect(find(rows, '5101')?.datevAccount).toBe('8300');
    expect(find(rows, '5200')).toMatchObject({ datevAccount: '', comment: expect.stringContaining('7 %: Logis oder Speisen? Bitte zuordnen') });
  });

  it('leaves accounts no rule matches unmapped', async () => {
    const { rows } = suggestRows([account('5300', 'Parking', 'Revenues', { vat: { type: 'Reduced', percent: 10 } })], await loadTemplate('03'), 4);
    expect(find(rows, '5300')).toMatchObject({ datevAccount: '', comment: expect.stringContaining('Keine Vorlage-Regel') });
  });

  it.each(SKRS)('SKR%s: suggests no-show and cancellation fees at 7 %% before the generic 7 %% rule', async (skr) => {
    const chart = [
      account('RevenueNoShow_Reduced:7.00', 'Revenues No-show (7%)', 'Revenues', { vat: { type: 'Reduced', percent: 7 } }),
      account('RevenueCancellationFees_Reduced:7.00', 'Revenues Cancellation fees (7%)', 'Revenues', { vat: { type: 'Reduced', percent: 7 } }),
      account('RevenueOther_Reduced:7.00', 'Revenues Other (7%)', 'Revenues', { vat: { type: 'Reduced', percent: 7 } }),
    ];
    const { rows } = suggestRows(chart, await loadTemplate(skr), 4);
    const revenue = skr === '03' ? '8300' : '4300';
    for (const number of ['RevenueNoShow_Reduced:7.00', 'RevenueCancellationFees_Reduced:7.00']) {
      expect(find(rows, number)).toMatchObject({ datevAccount: revenue, datevVatPercent: '7' });
      expect(find(rows, number)?.comment).toContain('entscheidet die Kanzlei');
    }
    expect(find(rows, 'RevenueOther_Reduced:7.00')?.datevAccount).toBe('');
  });

  it('leaves revenue at the 2020 rates 16 % and 5 % empty with the 2020 comment', async () => {
    const chart = [16, 5].map((percent) => account(`RevenueOther_X:${percent}.00`, `Revenues Other (${percent}%)`, 'Revenues', { vat: { type: 'X', percent } }));
    const { rows } = suggestRows(chart, await loadTemplate('03'), 4);
    for (const row of rows.filter((r) => r.apaleoType === 'Revenues')) {
      expect(row).toMatchObject({ datevAccount: '', comment: expect.stringContaining('historischer Satz 1.7.–31.12.2020') });
      expect(row.comment).toContain('E-UNMAPPED');
    }
  });

  it('writes no row for an empty container outside the global ledger, but keeps one a rule maps', async () => {
    const guest = { ledger: 'guest' as const, hasChildren: true };
    const chart = [
      account('3000', 'Liabilities', 'Liabilities', guest),
      account('1200', 'Receivables', 'Receivables', guest),
      account('6900', 'Loss of Accounts Receivable', 'LossOfAccountsReceivable', guest),
      account('CollectiveDebitor_LossOfAccountsReceivable', 'LossOfAccountsReceivable for …', 'LossOfAccountsReceivable', { ...guest, parentNumber: '6900' }),
      account('9000', 'House Account', 'House', { hasChildren: true }),
    ];
    const { rows } = suggestRows(chart, await loadTemplate('03'), 4);
    expect(find(rows, '3000')).toBeUndefined();
    expect(find(rows, 'CollectiveDebitor_LossOfAccountsReceivable')).toBeUndefined();
    expect(find(rows, '1200')?.datevAccount).toBe('1410');
    // Only containers of types with wildcard rules are left out.
    expect(find(rows, '9000')).toBeDefined();
  });

  it('notes VAT rates outside the German templates (Austrian property)', async () => {
    const chart = [4.9, 10, 13, 20, 7, 0].map((percent) => account(`R:${percent}`, `Revenues (${percent}%)`, 'Revenues', { vat: { type: 'X', percent } }));
    const { rows, findings } = suggestRows(chart, await loadTemplate('03'), 4);
    expect(findings).toEqual([expect.objectContaining({ code: 'N-FOREIGN-VAT-RATES', value: '4.9,10,13,20' })]);
    expect(findings[0]?.message).toContain('4.9 %, 10 %, 13 %, 20 %');
    for (const percent of [4.9, 10, 13, 20]) expect(find(rows, `R:${percent}`)?.datevAccount).toBe('');
  });

  it('scales template numbers with trailing zeros and notes the Sachkontenlänge', async () => {
    const chart = [
      account('5011', 'Accommodation 7%', 'Revenues', { vat: { type: 'Reduced', percent: 7 } }),
      account('1400', 'Accounts Receivable', 'AccountsReceivable'),
    ];
    const { rows, findings } = suggestRows(chart, await loadTemplate('03'), 5);
    expect(find(rows, '5011')?.datevAccount).toBe('83000');
    expect(find(rows, '1400')?.datevAccount).toBe('100000');
    expect(findings).toEqual([expect.objectContaining({ code: 'N-TEMPLATE-SCALED', message: expect.stringContaining('Sachkontenlänge 5') })]);
    expect(suggestRows(chart, await loadTemplate('03'), 4).findings).toEqual([]);
    expect(scaleAccount('', 'Revenues', 6)).toBe('');
  });

  it('rejects a template without version or with the wrong header', () => {
    expect(() => parseTemplate('apaleo_type;name_pattern\r\n', '03')).toThrow(/does not name its version/);
    expect(() => parseTemplate('# skr03-hotel@1\r\na;b\r\n', '03')).toThrow(/header must be/);
  });

  it('ships template files that are valid UTF-8 with CRLF and 7 columns per line', () => {
    for (const skr of SKRS) {
      const text = readFileSync(new URL(`../../templates/skr${skr}-hotel.rules.csv`, import.meta.url), 'utf8');
      const lines = text.split('\r\n').filter((l) => l !== '' && !l.startsWith('#'));
      for (const line of lines) expect(line.split(';')).toHaveLength(7);
    }
  });
});
