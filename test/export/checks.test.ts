import { describe, expect, it } from 'vitest';
import type { AccountTotals } from '../../src/core/source.js';
import { checkAccountMovements, checkAggregates, checkConservation, checkVatByRate, plausibilityFindings, type CheckOptions } from '../../src/export/index.js';
import type { PostingResult } from '../../src/posting/index.js';
import { ChartIndex } from '../../src/core/chart.js';
import { BSP, LIVE_PROPERTIES, loadLiveData } from '../helpers/apaleo.js';
import { FakeSource } from '../helpers/fake-source.js';
import { BEISPIEL, CHART, LEDGER, SKR03_MAPPING, post } from '../helpers/posting.js';

const OPTIONS: CheckOptions = { mapping: SKR03_MAPPING, chart: CHART, sachkontenlaenge: 4, skr: '03' };
const SEPTEMBER = { from: '2026-09-01', to: '2026-09-30' } as const;

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('fixture value missing');
  return value;
}

/** The fixture month's posting result with a defect applied to copies of its bookings and findings. */
function withDefect(defect: (result: PostingResult) => void): PostingResult {
  const correct = post(LEDGER);
  // The skipped lines stay the ledger's own objects: the checks match them by identity.
  const result = { ...correct, bookings: structuredClone(correct.bookings), findings: [...correct.findings] };
  defect(result);
  return result;
}

describe('plausibility checks on the fixture month', () => {
  it('find nothing in a correct posting run', () => {
    expect(plausibilityFindings(LEDGER, post(LEDGER), OPTIONS)).toEqual([]);
  });
});

describe('conservation (E-CONSERVATION)', () => {
  it('is raised when a ledger line is neither booked nor skipped', () => {
    const result = withDefect((r) => void r.bookings.splice(0, 1));
    const [finding, ...rest] = checkConservation(LEDGER, result);
    expect(rest).toEqual([]);
    expect(finding?.code).toBe('E-CONSERVATION');
    expect(finding?.message).toContain('the 25 apaleo lines move 1812.22 (absolute gross), but the 21 bookings move 1587.60 and the 3 skipped lines 24.62');
    expect(finding?.message).toContain('so 200.00 would be lost or doubled');
  });

  it('is raised when a line is booked twice', () => {
    const result = withDefect((r) => void r.bookings.push(structuredClone(must(r.bookings[0]))));
    expect(checkConservation(LEDGER, result).map((f) => f.code)).toEqual(['E-CONSERVATION']);
  });
});

describe('account movement per day (E-ACCOUNT-BALANCE)', () => {
  it('catches a booking with side S where the apaleo line credits the Konto account', () => {
    // Booking 2: the 100.00 logis charge of 2026-09-14, Konto 1410 (debited in apaleo) Soll, Gegenkonto 8300.
    const result = withDefect((r) => {
      const booking = must(r.bookings.find((b) => b.belegdatum === '2026-09-14' && b.gegenkonto === '8300' && b.amountCents === 10_000));
      [booking.konto, booking.gegenkonto] = [booking.gegenkonto, booking.konto];
    });
    const findings = checkAccountMovements(LEDGER, result, OPTIONS);
    expect(findings.map((f) => [f.code, f.value])).toEqual([
      ['E-ACCOUNT-BALANCE', '1410'],
      ['E-ACCOUNT-BALANCE', '8300'],
    ]);
    expect(findings[0]?.message).toContain('on 2026-09-14 DATEV account 1410 moves -56.20 in the bookings, but the apaleo lines mapped to it move 143.80');
    expect(findings[1]?.message).toContain('on 2026-09-14 DATEV account 8300 moves 88.00 in the bookings, but the apaleo lines mapped to it move -112.00');
  });

  it('catches a flipped side and a booking on the wrong day', () => {
    const flipped = withDefect((r) => {
      const booking = must(r.bookings[0]);
      booking.side = booking.side === 'S' ? 'H' : 'S';
    });
    expect(checkAccountMovements(LEDGER, flipped, OPTIONS).length).toBeGreaterThan(0);
    const moved = withDefect((r) => void (must(r.bookings[0]).belegdatum = '2026-09-15'));
    expect(checkAccountMovements(LEDGER, moved, OPTIONS).map((f) => f.message.slice(0, 13))).toContain('on 2026-09-14');
  });
});

describe('VAT per rate (E-VAT-TOTAL)', () => {
  it('compares the VAT DATEV computes from the bookings with apaleo taxes, deposit releases included', () => {
    expect(checkVatByRate(LEDGER, post(LEDGER), OPTIONS)).toEqual([]);
  });

  it('is raised per rate when a booking lands on an account for another rate', () => {
    const result = withDefect((r) => {
      const logis = must(r.bookings.find((b) => b.gegenkonto === '8300' && b.amountCents === 10_000));
      logis.gegenkonto = '8400';
    });
    const findings = checkVatByRate(LEDGER, result, OPTIONS);
    expect(findings.map((f) => [f.code, f.value])).toEqual([
      ['E-VAT-TOTAL', '7'],
      ['E-VAT-TOTAL', '19'],
    ]);
    expect(findings[0]?.message).toContain(
      'at 7 % DATEV will compute 36.90 VAT from the bookings, but apaleo charged 43.44 as the sum of its per-line tax rounded to cents (difference -6.54',
    );
    // The fixture's taxes are whole cents, so the per-line rounding is 0.
    expect(findings[0]?.message).toContain("apaleo's precise total is 43.44; its per-line rounding (0) is already allowed for, so the remaining difference of -6.54 is the problem");
    expect(findings[1]?.message).toContain('the rounding total allows 0.00');
  });

  it('allows one cent per rounding difference reported at the same rate', () => {
    const offByOne = (roundings: ReadonlyMap<number, number>) =>
      withDefect((r) => {
        r.vatRoundingByRate = roundings;
        const logis = must(r.bookings.find((b) => b.gegenkonto === '8300' && b.amountCents === 10_000));
        logis.amountCents = 10_015; // 6.55 VAT instead of 6.54
      });
    expect(checkVatByRate(LEDGER, offByOne(new Map([[7, 1]])), OPTIONS)).toEqual([]);
    expect(checkVatByRate(LEDGER, offByOne(new Map()), OPTIONS).map((f) => f.code)).toEqual(['E-VAT-TOTAL']);
    // Roundings at 19 % do not excuse a difference at 7 %.
    const otherRate = checkVatByRate(LEDGER, offByOne(new Map([[19, 2]])), OPTIONS);
    expect(otherRate.map((f) => [f.code, f.value])).toEqual([['E-VAT-TOTAL', '7']]);
    expect(otherRate[0]?.message).toContain('the rounding total allows 0.00');
  });
});

describe('aggregate check (W-AGGREGATE-DIFF)', () => {
  it('asks for apaleo totals once per business day and finds the fixture days matching', async () => {
    const source = new FakeSource(structuredClone(BEISPIEL));
    expect(await checkAggregates(source, BSP, { from: '2026-09-14', to: '2026-09-17' }, LEDGER, CHART)).toEqual([]);
    expect(source.calls).toEqual(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'].map((day) => `getAccountTotals BSP ${day}`));
  });

  it('warns about an account whose balance differs, naming both balances and the basis', async () => {
    const data = structuredClone(BEISPIEL);
    const day = data.totals?.[BSP]?.find((t) => t.businessDate === '2026-09-14') as AccountTotals;
    must(day.accounts.find((a) => a.account.number === '5011')).balance.value = '-150.00';
    must(day.accounts.find((a) => a.account.number === '1611')).balance.value = '199.00';
    const findings = await checkAggregates(new FakeSource(data), BSP, SEPTEMBER, LEDGER, CHART);
    expect(findings.map((f) => [f.code, f.value])).toEqual([
      ['W-AGGREGATE-DIFF', '1611'],
      ['W-AGGREGATE-DIFF', '5011'],
    ]);
    expect(findings[0]?.message).toBe(
      "on 2026-09-14 apaleo's daily aggregate for account 1611 (Payments) has the balance 199.00, but the ledger lines of that day " +
        'add up to 200.00 (balance debit minus credit, from the gross amounts). Compare the day in apaleo; the file is written anyway',
    );
    expect(findings[1]?.message).toContain('has the balance -150.00, but the ledger lines of that day add up to -93.46 (balance debit minus credit, from the precise net amounts)');
  });

  it('finds every account of the recorded BER and VIE days matching', async () => {
    const live = await loadLiveData();
    for (const property of LIVE_PROPERTIES) {
      const chart = new ChartIndex(live.charts[property] ?? []);
      const period = { from: '2026-10-21', to: '2026-10-22' } as const;
      expect(await checkAggregates(new FakeSource(live), property, period, live.ledger[property] ?? [], chart), property).toEqual([]);
    }
  });
});
