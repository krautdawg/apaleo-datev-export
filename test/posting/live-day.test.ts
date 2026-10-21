import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ChartIndex } from '../../src/core/chart.js';
import { sumDecimals } from '../../src/core/money.js';
import { parseMapping } from '../../src/mapping/index.js';
import { buildBookings } from '../../src/posting/index.js';
import { LIVE_DAY, fixturePath, loadLiveData } from '../helpers/apaleo.js';

/**
 * The recorded BER business day 2026-10-21 (test/fixtures/apaleo/live/README.md)
 * posted with the committed live SKR03 mapping (template skr03-hotel@2).
 * Hand-checked totals:
 *
 * Revenue 7 % (8300): 114 − 10 + 124 + 114.02 + 84 + 38.40 + 46.80 + 60 = 571.22;
 *   DATEV VAT per booking 7.46 − 0.65 + 8.11 + 7.46 + 5.50 + 2.51 + 3.06 + 3.93 = 37.38,
 *   apaleo's precise taxes add up to 37.3695327 (37.37).
 * Revenue 19 % (8400): 14.90 + 19.98 + 12.50 = 47.38; DATEV 2.38 + 3.19 + 2.00 = 7.57,
 *   apaleo 7.56487395 (7.56). Revenue 0 % (8200): the cancellation fee 45.00.
 * Deposits: received 124 + 228.04 + 39.96 + 84 + 104 + 10 (overpayment parked at 0 %)
 *   = 590.00; released 124 + 114.02 + 19.98 + 84 + 10 (refund to the Girocard) =
 *   352.00, of it refunded 10.00. Deposits at 7 %: 124 + 228.04 + 84 + 104 − 124 − 114.02
 *   − 84 = 218.02, DATEV VAT 8.11 + 14.92 + 5.50 + 6.80 − 8.11
 *   − 7.46 − 5.50 = 14.26 (apaleo 14.26299065); 19 %: 6.38 − 3.19 = 3.19 (3.19008404).
 * Payments: Kasse 1000 = 61.70 + 50 = 111.70; Geldtransit 1360 = Girocard 0.90 + 124
 *   − 10, Visa Debit 60, Amex 228.04 + 39.96, Visa 84 + 104, Mastercard 45 = 675.90.
 * Accounts receivable: 114.00 Soll on the collective debtor 10000.
 * Skipped: the six second lines of the payments and the AR transfer
 *   (`<folio>_Receivables → <folio>_Receivables/Offset`), 61.70 + 114 + 0.90 + 60
 *   + 50 + 45 = 331.60 unsigned, all SAME_ACCOUNT. 35 − 6 = 29 bookings.
 */
const data = await loadLiveData();
const lines = (data.ledger.BER ?? []).filter((line) => line.businessDate === LIVE_DAY);
const chart = new ChartIndex(data.charts.BER ?? []);
const mapping = parseMapping(readFileSync(fixturePath('live/BER/mapping-BER.live.csv')), { path: 'mapping-BER.live.csv', sachkontenlaenge: 4 });
const result = buildBookings(lines, mapping, chart, { belegfeld1: 'receipt', sachkontenlaenge: 4, skr: '03' });

describe('posting the recorded BER day 2026-10-21', () => {
  it('books 29 of the 35 lines without a finding and skips the six /Offset second lines', () => {
    expect(lines).toHaveLength(35);
    expect(result.findings).toEqual([]);
    expect(result.bookings).toHaveLength(29);
    expect(result.summary.skipped).toEqual([{ reason: 'SAME_ACCOUNT', lines: 6, grossCents: 33_160 }]);
  });

  it('adds up the precise 7 % taxes exactly: 37.3695327, against 37.38 rounded per line', () => {
    const taxes = lines.filter((line) => line.credit.type === 'Revenues').flatMap((line) => line.taxes.filter((tax) => tax.percent === 7));
    expect(taxes).toHaveLength(8);
    expect(sumDecimals(taxes.map((tax) => tax.amountPrecise))).toBe('37.3695327');
    expect(taxes.reduce((sum, tax) => sum + tax.amountCents, 0)).toBe(3_738);
  });

  it('matches the hand-checked summary', () => {
    const { summary } = result;
    expect(summary.revenueByRate).toEqual([
      { ratePercent: 0, grossCents: 4_500, vatCents: 0, apaleoVat: '0' },
      { ratePercent: 7, grossCents: 57_122, vatCents: 3_738, apaleoVat: '37.3695327' },
      { ratePercent: 19, grossCents: 4_738, vatCents: 757, apaleoVat: '7.56487395' },
    ]);
    expect(summary.depositVatByRate).toEqual([
      { ratePercent: 0, grossCents: 0, vatCents: 0, apaleoVat: '0' },
      { ratePercent: 7, grossCents: 21_802, vatCents: 1_426, apaleoVat: '14.26299065' },
      { ratePercent: 19, grossCents: 1_998, vatCents: 319, apaleoVat: '3.19008404' },
    ]);
    expect(summary.payments).toEqual([
      { account: '1000', cents: 11_170 },
      { account: '1360', cents: 67_590 },
    ]);
    expect(summary.deposits).toEqual({ receivedCents: 59_000, releasedCents: 35_200, refundedCents: 1_000 });
    expect(summary.accountsReceivableCents).toBe(11_400);
    expect(summary.accounts.find((account) => account.account === '10000')).toEqual({ account: '10000', sollCents: 11_400, habenCents: 0, balanceCents: 11_400 });
    expect(summary.roundingCents).toBe(0);
    expect(summary.findings).toEqual([]);
  });

  it('writes German booking texts only', () => {
    const texts = result.bookings.map((booking) => booking.buchungstext ?? '');
    for (const english of ['Revenues', 'Payment', 'Liabilities', 'Receivables', 'Credit Card', 'Accommodation']) {
      expect(texts.filter((text) => text.includes(english))).toEqual([]);
    }
    expect(new Set(texts)).toEqual(
      new Set([
        'Zahlung Bar',
        'Erlös Speisen und Getränke 19 %',
        'Erlös Speisen und Getränke 7 %',
        'Forderung an Debitor',
        'Erlös Logis 7 %',
        'Erstattung Anzahlung 0 %',
        'Umbuchung Anzahlung 0 %',
        'Erlösminderung Logis 7 %',
        'Auflösung Anzahlung 7 %',
        'Anzahlung 7 %',
        'Zahlung Girocard',
        'Zahlung Visa Debit',
        'Erlös No-Show 7 %',
        'Auflösung Anzahlung 19 %',
        'Anzahlung 19 %',
        'Zahlung Mastercard',
        'Erlös Stornogebühr 0 %',
      ]),
    );
  });
});
