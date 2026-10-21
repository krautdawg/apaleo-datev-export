import { describe, expect, it } from 'vitest';
import { ACCOUNT_TYPES, sortLedgerLines } from '../../src/core/source.js';
import { ledgerLine } from '../helpers/ledger.js';

describe('sortLedgerLines', () => {
  it('orders by business date, then source entry number, then timestamp', () => {
    const lines = [
      ledgerLine({ businessDate: '2026-09-15', sourceEntryNumber: 'A', postedAt: '2026-09-15T08:00:00Z' }),
      ledgerLine({ businessDate: '2026-09-14', sourceEntryNumber: 'B', postedAt: '2026-09-14T08:00:00Z' }),
      ledgerLine({ businessDate: '2026-09-14', sourceEntryNumber: 'A', postedAt: '2026-09-14T09:00:00Z' }),
      ledgerLine({ businessDate: '2026-09-14', sourceEntryNumber: 'A', postedAt: '2026-09-14T08:00:00Z' }),
    ];
    const sorted = sortLedgerLines(lines).map((l) => `${l.businessDate} ${l.sourceEntryNumber} ${l.postedAt}`);
    expect(sorted).toEqual([
      '2026-09-14 A 2026-09-14T08:00:00Z',
      '2026-09-14 A 2026-09-14T09:00:00Z',
      '2026-09-14 B 2026-09-14T08:00:00Z',
      '2026-09-15 A 2026-09-15T08:00:00Z',
    ]);
  });

  it('keeps the source order of two lines with the same source entry number and timestamp', () => {
    const food = ledgerLine({ sourceEntryNumber: 'BSPE0003', postedAt: '2026-09-14T15:40:00.5000000Z', grossCents: 1200 });
    const coffee = ledgerLine({ sourceEntryNumber: 'BSPE0003', postedAt: '2026-09-14T15:40:00.5000000Z', grossCents: 300 });
    expect(sortLedgerLines([food, coffee])).toEqual([food, coffee]);
    expect(sortLedgerLines([coffee, food])).toEqual([coffee, food]);
  });

  it('compares instants, not text: offsets and seven fractional digits', () => {
    const later = ledgerLine({ postedAt: '2026-09-14T10:00:00.0000002Z' });
    const earlier = ledgerLine({ postedAt: '2026-09-14T10:00:00.0000001Z' });
    const berlin = ledgerLine({ postedAt: '2026-09-14T11:30:00+02:00' }); // 09:30 UTC
    expect(sortLedgerLines([later, earlier, berlin])).toEqual([berlin, earlier, later]);
  });

  it('gives equal results for repeated reads and does not change its input', () => {
    const input = [ledgerLine({ sourceEntryNumber: 'B' }), ledgerLine({ sourceEntryNumber: 'A' })];
    const copy = structuredClone(input);
    expect(sortLedgerLines(input)).toEqual(sortLedgerLines(copy));
    expect(input.map((l) => l.sourceEntryNumber)).toEqual(['B', 'A']);
  });
});

describe('account types', () => {
  it('lists the thirteen apaleo account types', () => {
    expect(ACCOUNT_TYPES).toHaveLength(13);
    expect(ACCOUNT_TYPES).toContain('VatOnLiabilities');
  });
});
