import { describe, expect, it } from 'vitest';
import { ChartIndex } from '../../src/core/chart.js';
import { accountLabel, buchungstext, commandLabel, paymentLabel, revenueLabel } from '../../src/posting/index.js';
import { lineRate } from '../../src/mapping/index.js';
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
  it('starts with "Zahlung" and names the card, never the guest, for a payment crediting the folio "Müller, Hans"', () => {
    const [booking] = post([payment({ credit: ACCOUNTS.folio })]).bookings;
    expect(booking?.buchungstext).toBe('Zahlung Visa');
    expect(booking?.buchungstext).not.toContain('Müller');
  });

  it('names revenue in German: "Erlös" plus the standard group, "Erlösminderung" for an allowance', () => {
    const [charge, allowance] = post([ledgerLine(), ledgerLine({ grossCents: -1_000, taxes: [tax('Reduced', 7, -65)] })]).bookings;
    expect(charge?.buchungstext).toBe('Erlös Logis 7 %');
    expect(allowance?.buchungstext).toBe('Erlösminderung Logis 7 %');
  });

  it('names revenue by its economic sign on the debit side: negative is "Erlös", positive is "Erlösminderung"', () => {
    const debited = (grossCents: number, amount: number) =>
      ledgerLine({ debit: ACCOUNTS.accommodation7, credit: ACCOUNTS.receivables, grossCents, taxes: [tax('Reduced', 7, amount)] });
    const [revenue, reduction] = post([debited(-1_000, -65), debited(1_000, 65)]).bookings;
    expect(revenue?.buchungstext).toBe('Erlös Logis 7 %');
    expect(reduction?.buchungstext).toBe('Erlösminderung Logis 7 %');
  });

  it('names city tax and levies in German, never as revenue, with the rate only when it is not 0', () => {
    const levy = (type: string, grossCents = 500, rate = 0) =>
      ledgerLine({ credit: { number: `${type}-1`, name: `${type} English name`, type }, grossCents, taxes: rate === 0 ? [] : [tax('Normal', rate, 80)] });
    const texts = [levy('CityTaxes'), levy('SecondCityTax'), levy('GuestLevies'), levy('CityTaxes', -500), levy('GuestLevies', 500, 19)].map((line) =>
      buchungstext(line, line.credit, CHART, lineRate(line) ?? 0),
    );
    expect(texts).toEqual(['Kurtaxe / City Tax', 'Kurtaxe / City Tax 2', 'Gästeabgabe', 'Korrektur Kurtaxe / City Tax', 'Gästeabgabe 19 %']);
  });

  it('names a deposit by side and sign, with its rate', () => {
    const prepayment = ledgerLine({ debit: ACCOUNTS.visa, credit: ACCOUNTS.liabilities, command: 'PostPrepayment', grossCents: 20_000, taxes: [tax('Reduced', 7, 1_308)] });
    const release = ledgerLine({ debit: ACCOUNTS.receivables, credit: ACCOUNTS.liabilities, grossCents: -20_000, taxes: [tax('Reduced', 7, -1_308)] });
    const refund = ledgerLine({ ...prepayment, grossCents: -20_000, taxes: [tax('Reduced', 7, -1_308)] });
    const parked = ledgerLine({ debit: ACCOUNTS.receivables, credit: ACCOUNTS.liabilities, grossCents: 20_000, taxes: [tax('Reduced', 7, 1_308)] });
    expect(post([prepayment, release, refund, parked]).bookings.map((b) => b.buchungstext)).toEqual([
      'Anzahlung 7 %',
      'Auflösung Anzahlung 7 %',
      'Erstattung Anzahlung 7 %',
      'Umbuchung Anzahlung 7 %',
    ]);
  });

  it('names a payment refund "Erstattung", a debtor transfer "Forderung an Debitor" and city tax as "Kurtaxe / City Tax"', () => {
    const [refund, transfer, cityTax, move] = post([
      payment({ grossCents: -5_000 }),
      ledgerLine({ debit: ACCOUNTS.accountsReceivable, credit: ACCOUNTS.receivables, command: 'PostToAccountsReceivables', taxes: [] }),
      ledgerLine({ credit: ACCOUNTS.cityTax, grossCents: 500, taxes: [] }),
      ledgerLine({ debit: ACCOUNTS.folio, credit: ACCOUNTS.receivables, command: 'MoveLineItem', taxes: [] }),
    ]).bookings;
    expect(refund?.buchungstext).toBe('Erstattung Visa');
    expect(transfer?.buchungstext).toBe('Forderung an Debitor');
    expect(cityTax?.buchungstext).toBe('Kurtaxe / City Tax');
    // Both sides map to 1410: skipped, so only three bookings.
    expect(move).toBeUndefined();
  });

  it('is cut to 60 characters', () => {
    const credit = { number: '5500', name: `Spa ${'x'.repeat(80)}`, type: 'Revenues' };
    const mapping = mappingWith(mappingRow({ apaleoAccount: '5500', apaleoType: 'Revenues', datevAccount: '8300', datevVatPercent: '7' }));
    const text = post([ledgerLine({ credit })], mapping).bookings[0]?.buchungstext ?? '';
    expect(text).toHaveLength(60);
    expect(text.startsWith('Erlös Spa x')).toBe(true);
  });

  it('labels the remaining apaleo commands in German', () => {
    expect(['MoveLineItem', 'PostToAccountsReceivables', 'PostToLossOfAccountsReceivables', 'PostPrepaymentVat', 'PostCharge', 'Unknown'].map(commandLabel)).toEqual([
      'Umbuchung',
      'Forderung an Debitor',
      'Forderungsverlust',
      'USt Anzahlung',
      'Buchung',
      'Buchung',
    ]);
  });
});

describe('revenueLabel', () => {
  const chart = new ChartIndex([
    { number: '5000', name: 'Revenues', type: 'Revenues', ledger: 'global', isArchived: false, hasChildren: true },
    { number: 'RevenueNoShow', name: 'Revenues No-show', type: 'Revenues', parentNumber: '5000', ledger: 'global', isArchived: false, hasChildren: true },
  ]);
  const revenue = (number: string, name: string, parentNumber?: string) => ({ number, name, type: 'Revenues', ...(parentNumber ? { parentNumber } : {}) });

  it.each([
    ['RevenueAccommodation_Reduced:7.00', 'Revenues Accommodation (7%)', 7, 'Logis 7 %'],
    ['RevenueFoodAndBeverages_Normal:19.00', 'Revenues Food and beverages (19%)', 19, 'Speisen und Getränke 19 %'],
    ['RevenueCancellationFees_Without:0.00', 'Revenues Cancellation fees (no VAT)', 0, 'Stornogebühr 0 %'],
    ['RevenueOther_Reduced:7.00', 'Revenues Other (7%)', 7, 'Sonstige Erlöse 7 %'],
    ['5011', 'Accommodation 7%', 7, 'Accommodation 7%'],
    ['5500', 'Revenues Spa (19%)', 19, 'Spa (19%)'],
  ])('labels %s as "%s"', (number, name, rate, label) => {
    expect(revenueLabel(revenue(number, name), chart, rate)).toBe(label);
  });

  it('finds the standard group through the chart parents', () => {
    expect(revenueLabel(revenue('NS-7', 'Revenues No-show (7%)', 'RevenueNoShow'), chart, 7)).toBe('No-Show 7 %');
  });

  it('gives "Erlös Logis 7 %" for a charge on RevenueAccommodation_Reduced:7.00', () => {
    const credit = { number: 'RevenueAccommodation_Reduced:7.00', name: 'Revenues Accommodation (7%)', type: 'Revenues', parentNumber: 'RevenueAccommodation' };
    const mapping = mappingWith(mappingRow({ apaleoAccount: credit.number, apaleoType: 'Revenues', apaleoVatPercent: '7', datevAccount: '8300', datevVatPercent: '7' }));
    expect(post([ledgerLine({ credit })], mapping).bookings[0]?.buchungstext).toBe('Erlös Logis 7 %');
  });
});

describe('paymentLabel', () => {
  it.each([
    ['Cash Payment', 'Bar'],
    ['Bank Transfer', 'Überweisung'],
    ['Direct Debit', 'Lastschrift'],
    ['Voucher Payment', 'Gutschein'],
    ['Other Payment', 'Sonstige'],
    ['Visa Credit Card Payment', 'Visa'],
    ['Visa Debit Card Payment', 'Visa Debit'],
    ['Amex Credit Card Payment', 'Amex'],
    ['MasterCard Credit Card Payment', 'Mastercard'],
    ['GiroCard Payment', 'Girocard'],
    ['Maestro Card Payment', 'Maestro'],
    ['Payment by Booking.com', 'Booking.com'],
    ['PayPal Payment', 'PayPal'],
    ['Visa', 'Visa'],
  ])('labels %s as %s', (name, label) => {
    expect(paymentLabel(name)).toBe(label);
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
