import { describe, expect, it } from 'vitest';
import { ChartIndex } from '../../src/core/chart.js';
import { accountLabel, commandLabel } from '../../src/posting/index.js';
import { ledgerLine, tax } from '../helpers/ledger.js';
import { mappingRow } from '../helpers/mapping.js';
import { ACCOUNTS, CHART, mappingWith, post } from '../helpers/posting.js';

const payment = (overrides: Parameters<typeof ledgerLine>[0] = {}) =>
  ledgerLine({ debit: ACCOUNTS.visa, credit: ACCOUNTS.receivables, command: 'PostPayment', grossCents: 12_000, taxes: [], ...overrides });

describe('Belegfeld 1', () => {
  it('is the receipt number of a payment without invoice, for example a PSP reference', () => {
    const [booking] = post([payment({ receipt: { type: 'PspReference', number: 'PSP123' }, reference: 'BSP-ABCDEF-1' })]).bookings;
    expect(booking?.belegfeld1).toBe('PSP123');
  });

  it('is the reference with posting.belegfeld1 "reference", or when there is no receipt number', () => {
    const line = payment({ receipt: { type: 'PspReference', number: 'PSP123' }, reference: 'BSP-ABCDEF-1' });
    expect(post([line], undefined, { belegfeld1: 'reference' }).bookings[0]?.belegfeld1).toBe('BSP-ABCDEF-1');
    expect(post([payment({ receipt: { number: '' }, reference: 'BSP-ABCDEF-1' })]).bookings[0]?.belegfeld1).toBe('BSP-ABCDEF-1');
  });

  it('never falls back to an account name', () => {
    const [booking] = post([payment({ credit: ACCOUNTS.folio, receipt: { number: ' ' }, reference: 'BSP-12345-1' })]).bookings;
    expect(booking?.belegfeld1).toBe('BSP-12345-1');
  });
});

describe('Buchungstext', () => {
  it('is "Zahlung Gastforderung" for a payment crediting the guest folio "Müller, Hans"', () => {
    const [booking] = post([payment({ credit: ACCOUNTS.folio })]).bookings;
    expect(booking?.buchungstext).toBe('Zahlung Gastforderung');
    expect(booking?.buchungstext).not.toContain('Müller');
  });

  it('names the VAT side for charges, else the credit side', () => {
    const [charge, cityTax, payout] = post([
      ledgerLine(),
      ledgerLine({ credit: ACCOUNTS.cityTax, grossCents: 500, taxes: [] }),
      ledgerLine({ debit: ACCOUNTS.accountsReceivable, credit: ACCOUNTS.receivables, command: 'PostToAccountsReceivables', taxes: [] }),
    ]).bookings;
    expect(charge?.buchungstext).toBe('Erlös Accommodation 7%');
    expect(cityTax?.buchungstext).toBe('Erlös City Tax 0%');
    expect(payout?.buchungstext).toBe('Forderung Gastforderung');
  });

  it('does not repeat the command label: a prepayment on a guest deposit is "Anzahlung Gast"', () => {
    const line = ledgerLine({ debit: ACCOUNTS.visa, credit: ACCOUNTS.liabilities, command: 'PostPrepayment', grossCents: 20_000, taxes: [tax('Reduced', 7, 1_308)] });
    expect(post([line]).bookings[0]?.buchungstext).toBe('Anzahlung Gast');
  });

  it('is cut to 60 characters', () => {
    const credit = { ...ACCOUNTS.accommodation7, name: `Accommodation ${'x'.repeat(80)}` };
    const text = post([ledgerLine({ credit })]).bookings[0]?.buchungstext ?? '';
    expect(text).toHaveLength(60);
    expect(text.startsWith('Erlös Accommodation x')).toBe(true);
  });

  it('labels each apaleo command in German', () => {
    expect(
      ['PostCharge', 'PostPayment', 'PostPrepayment', 'MoveLineItem', 'PostToAccountsReceivables', 'PostToLossOfAccountsReceivables', 'PostPrepaymentVat', 'System', 'Unknown'].map(commandLabel),
    ).toEqual(['Erlös', 'Zahlung', 'Anzahlung', 'Umbuchung', 'Forderung', 'Forderungsverlust', 'USt Anzahlung', 'Buchung', 'Buchung']);
  });
});

describe('accountLabel', () => {
  const chart = new ChartIndex([
    ...CHART.accounts,
    { number: '1450', name: 'Company Receivables', type: 'AccountsReceivable', ledger: 'global', isArchived: false, hasChildren: true },
  ]);

  it('keeps the name of global accounts and of accounts of other types', () => {
    expect(accountLabel(ACCOUNTS.accountsReceivable, chart)).toBe('Accounts Receivable');
    expect(accountLabel(ACCOUNTS.beverages19, chart)).toBe('Beverages 19%');
    expect(accountLabel({ number: '9999', name: 'Anything', type: 'House' }, chart)).toBe('Anything');
  });

  it('uses the global parent name or a fixed label for guest, booking and per-reservation accounts', () => {
    expect(accountLabel({ number: 'ACME-1', name: 'Müller GmbH', type: 'AccountsReceivable', parentNumber: '1450' }, chart)).toBe('Company Receivables');
    expect(accountLabel({ number: 'ACME-2', name: 'Müller GmbH', type: 'AccountsReceivable' }, chart)).toBe('Debitor');
    expect(accountLabel(ACCOUNTS.folio, chart)).toBe('Gastforderung'); // parent 1200 lives in the guest ledger
    expect(accountLabel({ number: '1200', name: 'Guest Receivables', type: 'Receivables' }, chart)).toBe('Gastforderung');
    expect(accountLabel(ACCOUNTS.liabilities, chart)).toBe('Anzahlung Gast');
  });
});

describe('KOST1 and KOST2', () => {
  it('come from the VAT-side row first', () => {
    // The fixture maps drinks 5121 to 8400 with KOST1 BAR.
    const [booking] = post([ledgerLine({ credit: ACCOUNTS.beverages19, grossCents: 2_380, taxes: [tax('Normal', 19, 380)] })]).bookings;
    expect(booking).toMatchObject({ kost1: 'BAR' });
    expect(booking?.kost2).toBeUndefined();
  });

  it('then from the Konto row, then from the Gegenkonto row, field by field', () => {
    const mapping = mappingWith(
      mappingRow({ apaleoAccount: '5121', apaleoType: 'Revenues', apaleoVatPercent: '19', datevAccount: '8400', kost2: 'FB' }),
      mappingRow({ apaleoAccount: '*', apaleoType: 'Receivables', datevAccount: '1410', kost1: 'LOGIS', kost2: 'X' }),
      mappingRow({ apaleoAccount: '1611', apaleoType: 'Payments', datevAccount: '1360', kost1: 'KARTE' }),
    );
    const drinks = ledgerLine({ credit: ACCOUNTS.beverages19, grossCents: 2_380, taxes: [tax('Normal', 19, 380)] });
    const [charge, card] = post([drinks, payment()], mapping).bookings;
    expect(charge).toMatchObject({ kost1: 'LOGIS', kost2: 'FB' });
    expect(card).toMatchObject({ kost1: 'KARTE', kost2: 'X' });
  });
});
