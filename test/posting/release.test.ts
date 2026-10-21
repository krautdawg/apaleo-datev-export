import { describe, expect, it } from 'vitest';
import { ChartIndex } from '../../src/core/chart.js';
import { isErrorFinding } from '../../src/core/findings.js';
import type { LedgerLine } from '../../src/core/source.js';
import { buildBookings, inferReleaseRates } from '../../src/posting/index.js';
import { ledgerLine } from '../helpers/ledger.js';
import { mappingRow } from '../helpers/mapping.js';
import { ACCOUNTS, CHART, LEDGER, OPTIONS, SKR03_MAPPING, mappingWith, post } from '../helpers/posting.js';

/**
 * Deposit release (design decision 3a): debit the guest's _Liabilities account,
 * credit its _Receivables account, at check-in or check-out. With the SKR03
 * fixture mapping it books 1410 against 1711 (versteuerte Anzahlungen 7 %), side
 * H, so DATEV reverses the VAT on the deposit: 150.00 × 7 / 107 = 9.813 → 9.81.
 */

const liabilities = { number: 'BSP-MNOPQR-1_Liabilities', name: 'Liabilities for Reservation BSP-MNOPQR-1', type: 'Liabilities' };
const receivables = { number: 'BSP-MNOPQR-1_Receivables', name: 'Receivables for Reservation BSP-MNOPQR-1', type: 'Receivables' };
const codes = (findings: readonly { code: string }[]) => findings.map((f) => f.code);

function release(overrides: Partial<LedgerLine> = {}): LedgerLine {
  return ledgerLine({
    businessDate: '2026-09-22',
    debit: liabilities,
    credit: receivables,
    command: 'System',
    grossCents: 15_000,
    netCents: 15_000,
    taxes: [],
    receipt: { type: 'Reservation', number: 'BSP-MNOPQR-1-V1' },
    reference: 'BSP-MNOPQR-1',
    sourceEntryNumber: 'BSPE0021',
    ...overrides,
  });
}

/** The PostPrepaymentVat line that takes the deposit's VAT off apaleo's VAT-on-liabilities account. */
function pair(overrides: Partial<LedgerLine> = {}): LedgerLine {
  return release({
    debit: ACCOUNTS.vatOnLiabilities7,
    credit: liabilities,
    command: 'PostPrepaymentVat',
    grossCents: 981,
    netCents: 0,
    taxes: [{ vatType: 'Reduced', percent: 7, amountCents: 981 }],
    sourceEntryNumber: 'BSPE0022',
    ...overrides,
  });
}

describe('deposit release with taxes', () => {
  it('resolves to the 7 % Liabilities row and books 1410 against 1711, side H, without a finding', () => {
    // 2026-09-21 fixture: release 200.00 with taxes 13.08 at 7 %; 20000 × 7 / 107 = 1308.4 → 13.08.
    const line = release({ grossCents: 20_000, netCents: 18_692, taxes: [{ vatType: 'Reduced', percent: 7, amountCents: 1_308 }] });
    const { bookings, findings, summary } = post([line]);
    expect(findings).toEqual([]);
    expect(bookings).toEqual([expect.objectContaining({ amountCents: 20_000, konto: '1410', gegenkonto: '1711', side: 'H' })]);
    expect(summary.deposits).toEqual({ receivedCents: 0, releasedCents: 20_000 });
  });
});

describe('deposit release without taxes', () => {
  it('takes 7 % from the PostPrepaymentVat pair, matches its 9.81 and skips the pair as VAT_ACCOUNT_LINE', () => {
    const { bookings, skipped, findings } = post([release(), pair()]);
    expect(findings).toEqual([]);
    expect(bookings).toEqual([expect.objectContaining({ amountCents: 15_000, konto: '1410', gegenkonto: '1711', side: 'H', sourceEntryNumbers: ['BSPE0021'] })]);
    expect(skipped.map((s) => [s.reason, s.line.sourceEntryNumber])).toEqual([['VAT_ACCOUNT_LINE', 'BSPE0022']]);
  });

  it('uses the variant (b) fixture days 2026-09-15 and 2026-09-22 without any finding', () => {
    const lines = LEDGER.filter((line) => line.reference === 'BSP-MNOPQR-1');
    const releases = inferReleaseRates(lines, CHART);
    expect([...releases.values()]).toEqual([expect.objectContaining({ kind: 'pair', rate: 7, pairEntries: ['BSPE0022'], pairVatCents: 981, releaseVatCents: 981 })]);
    expect(post(lines).findings).toEqual([]);
  });

  it('ignores a PostPrepaymentVat line of another day, reference or direction', () => {
    // The VAT booked when the deposit was received (debit Liabilities, credit VAT) goes the other way.
    const received = pair({ debit: liabilities, credit: ACCOUNTS.vatOnLiabilities7, sourceEntryNumber: 'BSPE0006' });
    for (const other of [pair({ businessDate: '2026-09-21' }), pair({ reference: 'BSP-OTHER-1' }), received]) {
      expect(codes(post([release(), other]).findings)).toEqual(['E-VAT-RATE-UNKNOWN']);
    }
  });

  it('infers the rate from the pair amount when the pair carries no tax entry', () => {
    // 981 cents of VAT on 150.00 matches 7 % (9.81), not 19 % (23.95).
    const { bookings, findings } = post([release(), pair({ taxes: [] })]);
    expect(findings).toEqual([]);
    expect(bookings[0]).toMatchObject({ gegenkonto: '1711' });
  });

  it('blocks a release whose DATEV VAT differs from the pair by more than a cent with E-VAT-AMOUNT', () => {
    const { bookings, findings } = post([release(), pair({ grossCents: 900, taxes: [{ vatType: 'Reduced', percent: 7, amountCents: 900 }] })]);
    expect(bookings).toEqual([]);
    expect(codes(findings)).toEqual(['E-VAT-AMOUNT']);
    expect(findings[0]?.message).toContain('DATEV will compute 9.81 VAT on the deposit release, but apaleo reversed 9.00 on the PostPrepaymentVat line BSPE0022');
  });

  it('warns once with W-VAT-ROUNDING when the pair is one cent off', () => {
    const { bookings, findings, summary, vatRoundingByRate } = post([release(), pair({ grossCents: 982, taxes: [{ vatType: 'Reduced', percent: 7, amountCents: 982 }] })]);
    expect(bookings).toHaveLength(1);
    expect(codes(findings)).toEqual(['W-VAT-ROUNDING']);
    expect([...vatRoundingByRate]).toEqual([[7, 1]]);
    expect(summary.roundingCents).toBe(-1);
  });

  it('checks two releases of the same day and reference against their pair together', () => {
    // 100.00 + 50.00: 6.54 + 3.27 = 9.81 in DATEV, one pair of 9.81 in apaleo.
    const lines = [release({ grossCents: 10_000 }), release({ grossCents: 5_000, sourceEntryNumber: 'BSPE0023' }), pair()];
    const { bookings, findings } = post(lines);
    expect(findings).toEqual([]);
    expect(bookings.map((b) => b.amountCents)).toEqual([10_000, 5_000]);
  });

  it('falls back to the VAT rate of the Liabilities account or its parent in the chart, with W-VAT-INFERRED', () => {
    // 3007 "Guest Liabilities 7%" carries VAT 7 % in the fixture chart; a folio below it inherits it.
    const child = { number: 'BSP-12345-1_Liabilities', name: 'Müller, Hans', type: 'Liabilities', parentNumber: '3007' };
    const { bookings, findings } = post([release({ debit: child })]);
    expect(bookings).toEqual([expect.objectContaining({ konto: '1410', gegenkonto: '1711', side: 'H' })]);
    expect(codes(findings)).toEqual(['W-VAT-INFERRED']);
    expect(findings[0]?.message).toContain('7 %, the VAT rate of account 3007');
    expect(findings[0]?.message).not.toContain('Müller');
  });

  it('blocks a release with no rate source with E-VAT-RATE-UNKNOWN instead of booking it at 0 %', () => {
    const { bookings, findings } = post([release()]);
    expect(bookings).toEqual([]);
    expect(codes(findings)).toEqual(['E-VAT-RATE-UNKNOWN']);
    expect(findings.every(isErrorFinding)).toBe(true);
    expect(findings[0]?.message).toContain('apaleo entry BSPE0021');
    expect(findings[0]?.message).toContain('there is no PostPrepaymentVat line of 2026-09-22 for reference BSP-MNOPQR-1');
    expect(findings[0]?.message).not.toContain('1719');
  });

  it('blocks a release whose pair lines carry two rates with E-VAT-RATE-UNKNOWN', () => {
    const nineteen = pair({ debit: { number: '2119', name: 'VAT on Liabilities 19%', type: 'VatOnLiabilities' }, taxes: [{ vatType: 'Normal', percent: 19, amountCents: 100 }], sourceEntryNumber: 'BSPE0024' });
    const { findings } = post([release(), pair(), nineteen]);
    expect(codes(findings)).toEqual(['E-VAT-RATE-UNKNOWN']);
    expect(findings[0]?.message).toContain('carry more than one rate (7 %, 19 %)');
  });

  it('blocks a release whose inferred rate the mapping books without VAT with E-VAT-MISSING', () => {
    // 3007 carries 7 % in the chart, but its row books it on the untaxed deposit account 1719.
    const mapping = mappingWith(mappingRow({ apaleoAccount: '3007', apaleoType: 'Liabilities', apaleoVatPercent: '7', datevAccount: '1719', datevVatPercent: '0' }));
    const { bookings, findings } = post([release({ debit: { ...liabilities, number: '3007', parentNumber: '3000' } })], mapping);
    expect(bookings).toEqual([]);
    expect(codes(findings)).toEqual(['E-VAT-MISSING']);
    expect(findings[0]?.message).toContain('settles a deposit taxed at 7 % (inferred from the chart of accounts, account 3007)');
  });
});

describe('chart rate of 0 %', () => {
  it('books the release on the 0 % deposit row and still warns with W-VAT-INFERRED', () => {
    // A Liabilities account with VAT "Without" 0 % in the chart: the riskiest rate to infer, never booked silently.
    const template = CHART.accounts.find((account) => account.number === '3007');
    if (!template) throw new Error('fixture chart lacks 3007');
    const chart = new ChartIndex([...CHART.accounts, { ...template, number: '3090', name: 'Guest Liabilities 0%', vat: { type: 'Without', percent: 0 } }]);
    const debit = { number: 'BSP-MNOPQR-1_Liabilities', name: 'Liabilities for Reservation BSP-MNOPQR-1', type: 'Liabilities', parentNumber: '3090' };
    const { bookings, findings } = buildBookings([release({ debit })], SKR03_MAPPING, chart, OPTIONS);
    expect(bookings).toEqual([expect.objectContaining({ konto: '1719', gegenkonto: '1410', side: 'S' })]);
    expect(codes(findings)).toEqual(['W-VAT-INFERRED']);
    expect(findings[0]?.message).toContain('0 %, the VAT rate of account 3090');
    expect(findings[0]?.message).toContain('DATEV computes no VAT on the release');
  });
});

describe('untaxed deposit lines other than releases', () => {
  // 100.00 at 7 %: 10000 × 7 / 107 = 654.2 → 6.54.
  const refund = (overrides: Partial<LedgerLine> = {}) =>
    release({ debit: liabilities, credit: ACCOUNTS.visa, command: 'Refund', grossCents: 10_000, netCents: 10_000, sourceEntryNumber: 'BSPE0031', ...overrides });
  const received = (overrides: Partial<LedgerLine> = {}) =>
    release({ debit: ACCOUNTS.visa, credit: liabilities, command: 'PostPrepayment', grossCents: 10_000, netCents: 10_000, sourceEntryNumber: 'BSPE0032', ...overrides });
  /** VAT reversed on the deposit (debit VAT on liabilities), as for a release. */
  const reversing = (overrides: Partial<LedgerLine> = {}) =>
    pair({ grossCents: 654, taxes: [{ vatType: 'Reduced', percent: 7, amountCents: 654 }], sourceEntryNumber: 'BSPE0033', ...overrides });
  /** VAT booked on the deposit (credit VAT on liabilities), as on receipt. */
  const booking = (overrides: Partial<LedgerLine> = {}) =>
    reversing({ debit: liabilities, credit: ACCOUNTS.vatOnLiabilities7, sourceEntryNumber: 'BSPE0034', ...overrides });

  it('books an untaxed deposit refund with a reversing PostPrepaymentVat line on the 7 % deposit row', () => {
    const { bookings, skipped, findings } = post([refund(), reversing()]);
    expect(findings).toEqual([]);
    expect(bookings).toEqual([expect.objectContaining({ amountCents: 10_000, konto: '1360', gegenkonto: '1711', side: 'H', sourceEntryNumbers: ['BSPE0031'] })]);
    expect(skipped.map((s) => s.reason)).toEqual(['VAT_ACCOUNT_LINE']);
  });

  it('books an untaxed prepayment received with a VAT-booking PostPrepaymentVat line on the 7 % deposit row', () => {
    const { bookings, findings } = post([received(), booking()]);
    expect(findings).toEqual([]);
    expect(bookings).toEqual([expect.objectContaining({ amountCents: 10_000, konto: '1360', gegenkonto: '1711', side: 'S', sourceEntryNumbers: ['BSPE0032'] })]);
  });

  it('infers the rate from the pair amount when the pair of a prepayment received carries no tax entry', () => {
    const { bookings, findings } = post([received(), booking({ taxes: [] })]);
    expect(findings).toEqual([]);
    expect(bookings[0]).toMatchObject({ gegenkonto: '1711' });
  });

  it('blocks a refund whose DATEV VAT differs from the pair with E-VAT-AMOUNT', () => {
    const { bookings, findings } = post([refund(), reversing({ grossCents: 600, taxes: [{ vatType: 'Reduced', percent: 7, amountCents: 600 }] })]);
    expect(bookings).toEqual([]);
    expect(codes(findings)).toEqual(['E-VAT-AMOUNT']);
    expect(findings[0]?.message).toContain('DATEV will compute 6.54 VAT on the deposit line, but apaleo reversed 6.00 on the PostPrepaymentVat line BSPE0033');
  });

  it('blocks a prepayment received whose DATEV VAT differs from the pair with E-VAT-AMOUNT', () => {
    const { findings } = post([received(), booking({ grossCents: 600, taxes: [{ vatType: 'Reduced', percent: 7, amountCents: 600 }] })]);
    expect(codes(findings)).toEqual(['E-VAT-AMOUNT']);
    expect(findings[0]?.message).toContain('but apaleo booked 6.00 on the PostPrepaymentVat line BSPE0034');
  });

  // Without VAT, Konto is the debited account: 1719 for the refund, 1360 for the receipt.
  const refundAt0 = expect.objectContaining({ konto: '1719', gegenkonto: '1360', side: 'S' });
  const receivedAt0 = expect.objectContaining({ konto: '1360', gegenkonto: '1719', side: 'S' });

  it('ignores a PostPrepaymentVat line of the other direction and keeps the line on the 0 % deposit row', () => {
    expect(post([refund(), booking()]).bookings).toEqual([refundAt0]);
    expect(post([received(), reversing()]).bookings).toEqual([receivedAt0]);
  });

  it('keeps an untaxed refund or receipt without a PostPrepaymentVat line on the 0 % deposit row without a finding', () => {
    for (const [line, expected] of [[refund(), refundAt0], [received(), receivedAt0]] as const) {
      const { bookings, findings } = post([line]);
      expect(findings).toEqual([]);
      expect(bookings).toEqual([expected]);
    }
  });

  it('checks a release and a refund of the same day and reference against their pair together', () => {
    // 150.00 released (9.81) + 100.00 refunded (6.54) = 16.35 reversed on one pair line.
    const { bookings, findings } = post([release(), refund(), reversing({ grossCents: 1_635, taxes: [{ vatType: 'Reduced', percent: 7, amountCents: 1_635 }] })]);
    expect(findings).toEqual([]);
    expect(bookings.map((b) => b.gegenkonto)).toEqual(['1711', '1711']);
  });

  it('blocks a refund whose pair lines carry two rates with E-VAT-RATE-UNKNOWN', () => {
    const nineteen = reversing({ debit: { number: '2119', name: 'VAT on Liabilities 19%', type: 'VatOnLiabilities' }, taxes: [{ vatType: 'Normal', percent: 19, amountCents: 100 }], sourceEntryNumber: 'BSPE0035' });
    const { bookings, findings } = post([refund(), reversing(), nineteen]);
    expect(bookings).toEqual([]);
    expect(codes(findings)).toEqual(['E-VAT-RATE-UNKNOWN']);
    expect(findings[0]?.message).toContain("it books a guest's deposit without a VAT amount");
  });
});
