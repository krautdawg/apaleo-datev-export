import { describe, expect, it } from 'vitest';
import { isErrorFinding } from '../../src/core/findings.js';
import type { LedgerLine } from '../../src/core/source.js';
import { ledgerLine, tax as taxEntry } from '../helpers/ledger.js';
import { mappingRow } from '../helpers/mapping.js';
import { ACCOUNTS, mappingWith, post } from '../helpers/posting.js';

/**
 * Hand-computed examples (rates as of 2026: food in restaurants 7 %, drinks
 * 19 %), posted with the SKR03 fixture mapping: receivables 1410, cards 1360,
 * cash 1000, logis and food 8300 (7 %), drinks 8400 (19 %), deposits 1711
 * (7 %), city tax 1590 (0 %), collective debtor 10000.
 * DATEV's VAT is round(|gross| × rate / (100 + rate)), half away from zero.
 */

const codes = (findings: readonly { code: string }[]) => findings.map((f) => f.code);
const tax = (percent: number, amountCents: number) => [taxEntry(percent === 7 ? 'Reduced' : 'Normal', percent, amountCents)];

function single(line: LedgerLine, mapping = mappingWith()) {
  const result = post([line], mapping);
  return { ...result, booking: result.bookings[0] };
}

describe('one booking per ledger line', () => {
  it('books a card payment 120.00 as Konto 1360, Gegenkonto 1410, side S, no BU key', () => {
    const { booking, findings } = single(
      ledgerLine({ debit: ACCOUNTS.visa, credit: ACCOUNTS.receivables, command: 'PostPayment', grossCents: 12_000, netCents: 12_000, taxes: [], businessDate: '2026-09-16', sourceEntryNumber: 'BSPE0014' }),
    );
    expect(findings).toEqual([]);
    expect(booking).toMatchObject({ amountCents: 12_000, konto: '1360', gegenkonto: '1410', side: 'S', belegdatum: '2026-09-16', sourceEntryNumbers: ['BSPE0014'] });
    expect(booking?.buKey).toBeUndefined();
  });

  it('books a cash payment 23.80 to the Kasse 1000', () => {
    const { booking } = single(ledgerLine({ debit: ACCOUNTS.cash, credit: ACCOUNTS.receivables, command: 'PostPayment', grossCents: 2_380, taxes: [] }));
    expect(booking).toMatchObject({ amountCents: 2_380, konto: '1000', gegenkonto: '1410', side: 'S' });
  });

  it('is deterministic: the same lines and mapping give the same result', () => {
    const lines = [ledgerLine(), ledgerLine({ debit: ACCOUNTS.visa, credit: ACCOUNTS.receivables, taxes: [], command: 'PostPayment' })];
    expect(post(lines)).toEqual(post(structuredClone(lines)));
  });
});

describe('VAT side in Gegenkonto', () => {
  it('books an accommodation charge 100.00 at 7 % (VAT 6.54) as 1410 against 8300, side S', () => {
    // 10000 × 7 / 107 = 654.2 → 6.54, equal to apaleo's tax.
    const { booking, findings } = single(ledgerLine());
    expect(findings).toEqual([]);
    expect(booking).toMatchObject({ amountCents: 10_000, konto: '1410', gegenkonto: '8300', side: 'S' });
  });

  it('books an allowance that debits revenue as 1410 against 8300, side H', () => {
    // Debit 5011, credit receivables, gross 10.00, tax 0.65: 1000 × 7 / 107 = 65.4 → 0.65.
    const { booking, findings } = single(
      ledgerLine({ debit: ACCOUNTS.accommodation7, credit: ACCOUNTS.receivables, grossCents: 1_000, netCents: 935, taxes: tax(7, 65) }),
    );
    expect(findings).toEqual([]);
    expect(booking).toMatchObject({ amountCents: 1_000, konto: '1410', gegenkonto: '8300', side: 'H' });
  });

  it('books a negative gross amount −10.00 with its absolute value and the side flipped', () => {
    // Allowance on logis: gross −10.00, tax −0.65. |−1000| × 7 / 107 = 65.4 → 0.65 = |−0.65|, signs agree.
    const { booking, findings } = single(ledgerLine({ grossCents: -1_000, netCents: -935, taxes: tax(7, -65), sourceEntryNumber: 'BSPE0010' }));
    expect(findings).toEqual([]);
    expect(booking).toMatchObject({ amountCents: 1_000, konto: '1410', gegenkonto: '8300', side: 'H' });
  });

  it('takes the BU key from the VAT-side row', () => {
    // A 19 % revenue account on 8200 (no Automatik) with BU key 3: 11900 × 19 / 119 = 1900.
    const mapping = mappingWith(mappingRow({ apaleoAccount: '5919', apaleoType: 'Revenues', apaleoVatPercent: '19', datevAccount: '8200', buKey: '3' }));
    const other = { number: '5919', name: 'Other Revenues 19%', type: 'Revenues', parentNumber: 'RevenueOther' };
    const { booking, findings } = single(ledgerLine({ credit: other, grossCents: 11_900, taxes: tax(19, 1_900) }), mapping);
    expect(findings).toEqual([]);
    expect(booking).toMatchObject({ konto: '1410', gegenkonto: '8200', buKey: '3', side: 'S' });
  });

  it('reports E-TWO-VAT-SIDES for a move between two revenue accounts and books nothing', () => {
    const { bookings, findings } = single(
      ledgerLine({ debit: ACCOUNTS.accommodation7, credit: ACCOUNTS.accommodation19, command: 'MoveLineItem', sourceEntryNumber: 'BSPE0099' }),
    );
    expect(bookings).toEqual([]);
    expect(codes(findings)).toEqual(['E-TWO-VAT-SIDES']);
    expect(findings[0]?.message).toContain('apaleo entry BSPE0099');
    expect(findings[0]?.message).toContain('debit 5011 (Revenues)');
    expect(findings[0]?.message).toContain('credit 5019 (Revenues)');
    expect(findings[0]?.message).toMatch(/DATEV 8300\) at 7 %.*DATEV 8400\) at 19 %/);
  });
});

describe('VAT consistency guard', () => {
  it('passes drinks 23.80 at 19 % (VAT 3.80) and counts them as revenue at 19 %', () => {
    // 2380 × 19 / 119 = 380 exactly.
    const { booking, findings, summary } = single(ledgerLine({ credit: ACCOUNTS.beverages19, grossCents: 2_380, netCents: 2_000, taxes: tax(19, 380) }));
    expect(findings).toEqual([]);
    expect(booking).toMatchObject({ gegenkonto: '8400', amountCents: 2_380 });
    expect(summary.revenueByRate).toEqual([{ ratePercent: 19, grossCents: 2_380, vatCents: 380, apaleoVat: '3.8' }]);
  });

  it('passes breakfast food 12.00 at 7 % (VAT 0.79) and coffee 3.00 at 19 % (VAT 0.48) of a package night', () => {
    // 1200 × 7 / 107 = 78.5 → 0.79; 300 × 19 / 119 = 47.9 → 0.48.
    const food = ledgerLine({ credit: ACCOUNTS.food7, grossCents: 1_200, netCents: 1_121, taxes: tax(7, 79), sourceEntryNumber: 'BSPE0003' });
    const coffee = ledgerLine({ credit: ACCOUNTS.beverages19, grossCents: 300, netCents: 252, taxes: tax(19, 48), sourceEntryNumber: 'BSPE0003' });
    const { bookings, findings } = post([food, coffee]);
    expect(findings).toEqual([]);
    expect(bookings.map((b) => [b.gegenkonto, b.amountCents])).toEqual([['8300', 1_200], ['8400', 300]]);
  });

  it('drops a Without entry of 0 % and 0.00 on city tax instead of raising E-VAT-MISSING', () => {
    const { booking, findings } = single(
      ledgerLine({ credit: ACCOUNTS.cityTax, grossCents: 500, netCents: 500, taxes: [taxEntry('Without', 0, 0)] }),
    );
    expect(findings).toEqual([]);
    expect(booking).toMatchObject({ konto: '1410', gegenkonto: '1590', side: 'S', amountCents: 500 });
  });

  it('compares the magnitudes of a negative allowance and its negative tax', () => {
    const { findings, summary } = single(ledgerLine({ grossCents: -1_000, taxes: tax(7, -65) }));
    expect(findings).toEqual([]);
    expect(summary.revenueByRate).toEqual([{ ratePercent: 7, grossCents: -1_000, vatCents: -65, apaleoVat: '-0.65' }]);
  });

  it('blocks a line taxed at 7 % on an account mapped to 19 % with E-VAT-RATE', () => {
    const mapping = mappingWith(mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', apaleoVatPercent: '7', datevAccount: '8400' }));
    const { bookings, findings } = single(ledgerLine(), mapping);
    expect(bookings).toEqual([]);
    expect(codes(findings)).toEqual(['E-VAT-RATE']);
    expect(findings.every(isErrorFinding)).toBe(true);
    expect(findings[0]?.message).toContain('apaleo taxed it at 7 %, but DATEV will apply 19 % on 5011 (Revenues) on mapping line 2 (DATEV 8400)');
  });

  it('blocks a taxed line on an untaxed DATEV account with E-VAT-MISSING', () => {
    const mapping = mappingWith(mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', apaleoVatPercent: '7', datevAccount: '8200' }));
    const { bookings, findings } = single(ledgerLine(), mapping);
    expect(bookings).toEqual([]);
    expect(codes(findings)).toEqual(['E-VAT-MISSING']);
    expect(findings[0]?.message).toContain('carries 6.54 VAT at 7 %');
    expect(findings[0]?.message).toContain('Change the row for 5011 (Revenues) on mapping line 2 (DATEV 8200)');
  });

  it('blocks an untaxed line on a VAT account with E-VAT-UNEXPECTED', () => {
    const { bookings, findings } = single(ledgerLine({ taxes: [] }));
    expect(bookings).toEqual([]);
    expect(codes(findings)).toEqual(['E-VAT-UNEXPECTED']);
  });

  it('warns W-VAT-ROUNDING for a one-cent difference and adds it to the rounding total', () => {
    // 10000 × 7 / 107 = 654.2 → 6.54 in DATEV, apaleo charged 6.55: DATEV's VAT is 0.01 lower.
    const { bookings, findings, summary, vatRoundingByRate } = single(ledgerLine({ taxes: tax(7, 655) }));
    expect(bookings).toHaveLength(1);
    expect(codes(findings)).toEqual(['W-VAT-ROUNDING']);
    expect([...vatRoundingByRate]).toEqual([[7, 1]]);
    expect(summary.roundingCents).toBe(-1);
    expect(summary.findings).toEqual([{ code: 'W-VAT-ROUNDING', count: 1 }]);
  });

  it('blocks a larger difference with E-VAT-AMOUNT', () => {
    const { bookings, findings } = single(ledgerLine({ taxes: tax(7, 700) }));
    expect(bookings).toEqual([]);
    expect(codes(findings)).toEqual(['E-VAT-AMOUNT']);
    expect(findings[0]?.message).toContain('DATEV will compute 6.54 VAT at 7 % on 100.00, but apaleo charged 7.00');
  });

  it('blocks a line with two tax rates with E-VAT-MIXED', () => {
    const { bookings, findings } = single(ledgerLine({ taxes: [...tax(7, 654), ...tax(19, 100)] }));
    expect(bookings).toEqual([]);
    expect(codes(findings)).toEqual(['E-VAT-MIXED']);
  });

  it('blocks a tax with the opposite sign of the gross amount with E-VAT-SIGN', () => {
    const { bookings, findings } = single(ledgerLine({ taxes: tax(7, -654) }));
    expect(bookings).toEqual([]);
    expect(codes(findings)).toEqual(['E-VAT-SIGN']);
  });

  it('blocks a row whose DATEV rate is unknown with E-DATEV-RATE-UNKNOWN', () => {
    const mapping = mappingWith(mappingRow({ apaleoAccount: '5011', apaleoType: 'Revenues', apaleoVatPercent: '7', datevAccount: '8200', buKey: '5' }));
    const { bookings, findings } = single(ledgerLine(), mapping);
    expect(bookings).toEqual([]);
    expect(codes(findings)).toEqual(['E-DATEV-RATE-UNKNOWN']);
    expect(findings[0]?.message).toContain('Fill in datev_vat_percent');
  });

  it('reports an unmapped account once with E-UNMAPPED and books none of its lines', () => {
    const spa = { number: '5050', name: 'Spa', type: 'Revenues' };
    const lines = [ledgerLine({ credit: spa }), ledgerLine({ credit: spa, sourceEntryNumber: 'BSPE0002' })];
    const { bookings, findings } = post(lines);
    expect(bookings).toEqual([]);
    expect(codes(findings)).toEqual(['E-UNMAPPED']);
    expect(findings[0]?.message).toContain('apaleo account 5050 (Revenues, "Spa") is not mapped (2 lines, gross 200.00)');
  });
});

describe('city tax and guest levies', () => {
  it('books guest-owed Kurtaxe 5.00 on Durchlaufende Posten 1590 without VAT', () => {
    const { booking, findings, summary } = single(ledgerLine({ credit: ACCOUNTS.cityTax, grossCents: 500, netCents: 500, taxes: [] }));
    expect(findings).toEqual([]);
    expect(booking).toMatchObject({ amountCents: 500, konto: '1410', gegenkonto: '1590', side: 'S' });
    expect(booking?.buKey).toBeUndefined();
    expect(summary.cityTaxCents).toBe(500);
    expect(summary.revenueByRate).toEqual([]);
  });

  it('books an operator-owed tax that apaleo taxes at 7 % on a 7 % revenue account under the guard', () => {
    // Beherbergungsteuer 5.35 at 7 %: 535 × 7 / 107 = 35 exactly.
    const mapping = mappingWith(mappingRow({ apaleoAccount: '3501', apaleoType: 'CityTaxes', apaleoVatPercent: '7', datevAccount: '8300' }));
    const line = ledgerLine({ credit: ACCOUNTS.cityTax, grossCents: 535, netCents: 500, taxes: tax(7, 35) });
    const { booking, findings, summary } = single(line, mapping);
    expect(findings).toEqual([]);
    expect(booking).toMatchObject({ konto: '1410', gegenkonto: '8300', amountCents: 535 });
    expect(summary.cityTaxCents).toBe(535);
    expect(codes(post([{ ...line, taxes: tax(7, 50) }], mapping).findings)).toEqual(['E-VAT-AMOUNT']);
  });
});

describe('real apaleo shapes (recorded sandbox, 2026-10-21)', () => {
  const girocard = { number: '1107', name: 'GiroCard Payment', type: 'Payments', parentNumber: '1000' };
  const folio = { number: 'LJJRUJKV-1_Receivables', name: 'Receivables for Reservation LJJRUJKV-1', type: 'Receivables', parentNumber: '1200' };
  const deposit7 = { number: 'LJJRUJKV-1_Liabilities/Reduced:7.00', name: 'Liabilities for Reservation LJJRUJKV-1 (7%)', type: 'Liabilities', parentNumber: '3000' };
  const deposit0 = { number: 'EPEBVUIU-1_Liabilities/Null:0.00', name: 'Liabilities for Reservation EPEBVUIU-1 (0%)', type: 'Liabilities', parentNumber: '3000' };

  it('passes a precise tax: gross 114.00 with 7.45794393 at 7 % is 7.46 in DATEV and in apaleo', () => {
    // 11400 × 7 / 107 = 745.79 → 7.46; apaleo's 7.45794393 rounds half away from zero to 7.46.
    const { findings, summary } = single(ledgerLine({ grossCents: 11_400, taxes: [taxEntry('Reduced', 7, 746, '7.45794393')] }));
    expect(findings).toEqual([]);
    expect(summary.revenueByRate).toEqual([{ ratePercent: 7, grossCents: 11_400, vatCents: 746, apaleoVat: '7.45794393' }]);
  });

  it('books a release as a negative charge: 1410 against 1711, side H, counted as released', () => {
    // 8400 × 7 / 107 = 549.53 → 5.50, apaleo -5.4953271 → -5.50.
    const line = ledgerLine({ debit: folio, credit: deposit7, grossCents: -8_400, taxes: [taxEntry('Reduced', 7, -550, '-5.4953271')] });
    const { booking, findings, summary } = single(line);
    expect(findings).toEqual([]);
    expect(booking).toMatchObject({ amountCents: 8_400, konto: '1410', gegenkonto: '1711', side: 'H', buchungstext: 'Auflösung Anzahlung 7 %' });
    expect(summary.deposits).toEqual({ receivedCents: 0, releasedCents: 8_400, refundedCents: 0 });
    expect(summary.depositVatByRate).toEqual([{ ratePercent: 7, grossCents: -8_400, vatCents: -550, apaleoVat: '-5.4953271' }]);
  });

  it('books a refund as a negative prepayment: 1360 against 1719, side H, counted as released and refunded', () => {
    const line = ledgerLine({ debit: girocard, credit: deposit0, command: 'PostPrepayment', grossCents: -1_000, taxes: [] });
    const { booking, findings, summary } = single(line);
    expect(findings).toEqual([]);
    expect(booking).toMatchObject({ amountCents: 1_000, konto: '1360', gegenkonto: '1719', side: 'H', buchungstext: 'Erstattung Anzahlung 0 %' });
    expect(summary.deposits).toEqual({ receivedCents: 0, releasedCents: 1_000, refundedCents: 1_000 });
    expect(summary.payments).toEqual([{ account: '1360', cents: -1_000 }]);
  });

  it('counts an overpayment parked on the 0 % deposit as received', () => {
    const line = ledgerLine({ debit: folio, credit: deposit0, grossCents: 1_000, taxes: [] });
    const { booking, summary } = single(line);
    expect(booking).toMatchObject({ konto: '1410', gegenkonto: '1719', side: 'S', buchungstext: 'Umbuchung Anzahlung 0 %' });
    expect(summary.deposits).toEqual({ receivedCents: 1_000, releasedCents: 0, refundedCents: 0 });
  });

  it('sums the accounts-receivable movement and lists skipped lines unsigned', () => {
    const debtor = { number: 'ZAQSEFYC-1_AccountsReceivable', name: 'AR', type: 'AccountsReceivable', parentNumber: '9999' };
    const offset = { ...debtor, number: `${debtor.number}/Offset` };
    const mapping = mappingWith(mappingRow({ apaleoAccount: '*', apaleoType: 'AccountsReceivable', datevAccount: '10000' }));
    const transfer = { command: 'PostToAccountsReceivables', taxes: [] };
    const { bookings, skipped, summary } = post(
      [
        ledgerLine({ ...transfer, debit: folio, credit: offset, grossCents: -11_400, sourceEntryNumber: '000000030' }),
        ledgerLine({ ...transfer, debit: debtor, credit: offset, grossCents: 11_400, sourceEntryNumber: '000000030' }),
        ledgerLine({ debit: girocard, credit: { ...folio, number: `${folio.number}/Offset` }, command: 'PostPayment', grossCents: 90, taxes: [] }),
        ledgerLine({ debit: folio, credit: { ...folio, number: `${folio.number}/Offset` }, command: 'PostPayment', grossCents: -90, taxes: [] }),
      ],
      mapping,
    );
    expect(bookings.map((b) => [b.konto, b.gegenkonto, b.side, b.amountCents, b.buchungstext])).toEqual([
      ['1410', '10000', 'H', 11_400, 'Forderung an Debitor'],
      ['1360', '1410', 'S', 90, 'Zahlung Girocard'],
    ]);
    expect(summary.accountsReceivableCents).toBe(11_400);
    expect(skipped).toHaveLength(2);
    expect(summary.skipped).toEqual([{ reason: 'SAME_ACCOUNT', lines: 2, grossCents: 11_490 }]);
  });
});

describe('deposits and accounts receivable', () => {
  it('books a prepayment 200.00 at 7 % (VAT 13.08) to the versteuerte Anzahlungen 1711', () => {
    // Per-reservation _Liabilities account without parent: resolved through the 7 % Liabilities wildcard.
    // 20000 × 7 / 107 = 1308.4 → 13.08.
    const { booking, findings, summary } = single(
      ledgerLine({ debit: ACCOUNTS.visa, credit: ACCOUNTS.liabilities, command: 'PostPrepayment', grossCents: 20_000, netCents: 18_692, taxes: tax(7, 1_308) }),
    );
    expect(findings).toEqual([]);
    expect(booking).toMatchObject({ amountCents: 20_000, konto: '1360', gegenkonto: '1711', side: 'S' });
    expect(summary.deposits).toEqual({ receivedCents: 20_000, releasedCents: 0, refundedCents: 0 });
    expect(booking?.buchungstext).toBe('Anzahlung 7 %');
  });

  it('books a check-out on accounts receivable 300.00 to the collective debtor with the invoice number', () => {
    const { booking, findings } = single(
      ledgerLine({
        debit: ACCOUNTS.accountsReceivable,
        credit: ACCOUNTS.receivables,
        command: 'PostToAccountsReceivables',
        grossCents: 30_000,
        taxes: [],
        receipt: { type: 'Invoice', number: 'BSP-2026-0042' },
      }),
    );
    expect(findings).toEqual([]);
    expect(booking).toMatchObject({ amountCents: 30_000, konto: '10000', gegenkonto: '1410', side: 'S', belegfeld1: 'BSP-2026-0042' });
  });
});

describe('skipped lines', () => {
  it('skips a 50.00 move between two guest folios that both map to 1410 as SAME_ACCOUNT', () => {
    const { bookings, skipped, summary, findings } = single(
      ledgerLine({ debit: ACCOUNTS.receivables, credit: ACCOUNTS.folio, command: 'MoveLineItem', grossCents: 5_000, taxes: [] }),
    );
    expect(bookings).toEqual([]);
    expect(findings).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(['SAME_ACCOUNT']);
    expect(summary.skipped).toEqual([{ reason: 'SAME_ACCOUNT', lines: 1, grossCents: 5_000 }]);
  });

  it('always skips lines on Vat and VatOnLiabilities accounts, without needing a mapping row', () => {
    const unmappedVat = { number: '2099', name: 'VAT 16%', type: 'Vat' };
    const lines = [
      ledgerLine({ debit: ACCOUNTS.receivables, credit: unmappedVat, grossCents: 160, taxes: [] }),
      ledgerLine({ debit: ACCOUNTS.liabilities, credit: ACCOUNTS.vatOnLiabilities7, command: 'PostPrepaymentVat', grossCents: 981, taxes: tax(7, 981) }),
    ];
    const { bookings, skipped, summary, findings } = post(lines);
    expect(bookings).toEqual([]);
    expect(findings).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(['VAT_ACCOUNT_LINE', 'VAT_ACCOUNT_LINE']);
    expect(summary.skipped).toEqual([{ reason: 'VAT_ACCOUNT_LINE', lines: 2, grossCents: 1_141 }]);
  });

  it('skips lines with a zero gross amount as ZERO_AMOUNT', () => {
    const { bookings, skipped, summary } = single(ledgerLine({ grossCents: 0, netCents: 0, taxes: [] }));
    expect(bookings).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(['ZERO_AMOUNT']);
    expect(summary.skipped).toEqual([{ reason: 'ZERO_AMOUNT', lines: 1, grossCents: 0 }]);
  });
});
