import { describe, expect, it } from 'vitest';
import { renderBuchungsstapel } from '../../src/datev/index.js';
import { FIXED_CLOCK } from '../helpers/extf.js';
import { LEDGER, post } from '../helpers/posting.js';

/**
 * The Hotel Beispiel fixture period 2026-09-14 to 2026-09-22 (25 ledger lines,
 * see test/fixtures/apaleo/README.md), posted with the SKR03 fixture mapping.
 * Totals computed by hand:
 *
 * Revenue 7 % (8300): logis 100 + 100 + 100 (Müller) + 200 + 150, food 12 + 12,
 *   allowance −10 = 664.00. VAT per booking: 6.54 × 3 + 13.08 + 9.81 + 0.79 × 2
 *   − 0.65 = 43.44.
 * Revenue 19 % (8400): coffee 3 + 3, drinks 23.80 = 29.80; VAT 0.48 × 2 + 3.80 = 4.76.
 * City tax (1590): 5 × 3 = 15.00.
 * Payments: 1360 = prepayments 200 + 150, card 120 + 100 = 570.00; Kasse 1000 = 23.80.
 * Deposits (1711): received 200 + 150 = 350.00, released 200 (with taxes) +
 *   150 (from the PostPrepaymentVat pair, 9.81 = 150 × 7 / 107) = 350.00.
 * Debtor 10000: 115.00.
 * 1410 Soll: charges 143.80 (09-14) + 120 + 100 + 5 (09-15) + 200 + 150 = 718.80;
 *   Haben: allowance 10 + card 120 + cash 23.80 + AR 115 + card 100 + releases
 *   200 + 150 = 718.80: the guest folios balance to zero.
 * Skipped: two PostPrepaymentVat lines (9.81 + 9.81 = 19.62, VAT_ACCOUNT_LINE),
 *   the 5.00 folio move (SAME_ACCOUNT). 25 − 3 = 22 bookings.
 */
describe('posting the fixture month', () => {
  const result = post(LEDGER);

  it('books 22 lines, skips 3 and raises no finding', () => {
    expect(LEDGER).toHaveLength(25);
    expect(result.bookings).toHaveLength(22);
    expect(result.skipped).toHaveLength(3);
    expect(result.findings).toEqual([]);
  });

  it('matches the hand-computed summary', () => {
    expect(result.summary).toEqual({
      accounts: [
        { account: '1000', sollCents: 2_380, habenCents: 0, balanceCents: 2_380 },
        { account: '1360', sollCents: 57_000, habenCents: 0, balanceCents: 57_000 },
        { account: '1410', sollCents: 71_880, habenCents: 71_880, balanceCents: 0 },
        { account: '1590', sollCents: 0, habenCents: 1_500, balanceCents: -1_500 },
        { account: '1711', sollCents: 35_000, habenCents: 35_000, balanceCents: 0 },
        { account: '8300', sollCents: 1_000, habenCents: 67_400, balanceCents: -66_400 },
        { account: '8400', sollCents: 0, habenCents: 2_980, balanceCents: -2_980 },
        { account: '10000', sollCents: 11_500, habenCents: 0, balanceCents: 11_500 },
      ],
      revenueByRate: [
        { ratePercent: 7, grossCents: 66_400, vatCents: 4_344 },
        { ratePercent: 19, grossCents: 2_980, vatCents: 476 },
      ],
      cityTaxCents: 1_500,
      payments: [
        { account: '1000', cents: 2_380 },
        { account: '1360', cents: 57_000 },
      ],
      deposits: { receivedCents: 35_000, releasedCents: 35_000 },
      skipped: [
        { reason: 'VAT_ACCOUNT_LINE', lines: 2, grossCents: 1_962 },
        { reason: 'SAME_ACCOUNT', lines: 1, grossCents: 500 },
      ],
      roundingCents: 0,
      findings: [],
    });
    const balance = result.summary.accounts.reduce((sum, account) => sum + account.balanceCents, 0);
    expect(balance).toBe(0);
  });

  it('keeps every apaleo line traceable: booked or skipped, each exactly once', () => {
    const booked = result.bookings.flatMap((b) => b.sourceEntryNumbers);
    const skipped = result.skipped.map((s) => s.line.sourceEntryNumber);
    expect([...booked, ...skipped].sort()).toEqual(LEDGER.map((line) => line.sourceEntryNumber).sort());
  });

  it('never writes the guest name of the folio "Müller, Hans" into a booking', () => {
    expect(JSON.stringify(result.bookings)).not.toContain('Müller');
  });

  it('renders through the s02 writer without validation errors', () => {
    const header = {
      beraternummer: 1_234_567,
      mandantennummer: 42,
      wjBeginn: '2026-01-01',
      sachkontenlaenge: 4,
      datumVom: '2026-09-01',
      datumBis: '2026-09-30',
      sachkontenrahmen: '03',
      erzeugtAm: FIXED_CLOCK,
    } as const;
    const rendered = renderBuchungsstapel({ header, bookings: result.bookings });
    expect(rendered.text.split('\r\n')).toHaveLength(2 + 22 + 1);
    expect(rendered.warnings).toEqual([]);
    expect(rendered.text).toContain('"Zahlung Gastforderung"');
  });
});
