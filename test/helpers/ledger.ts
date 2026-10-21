import type { LedgerLine } from '../../src/core/source.js';

/** A valid ledger line (a 7 % accommodation charge) with the given fields replaced. */
export function ledgerLine(overrides: Partial<LedgerLine> = {}): LedgerLine {
  return {
    businessDate: '2026-09-14',
    postedAt: '2026-09-14T15:40:00Z',
    debit: { number: 'BSP-ABCDEF-1_Receivables', name: 'Receivables for Reservation BSP-ABCDEF-1', type: 'Receivables' },
    credit: { number: '5011', name: 'Accommodation 7%', type: 'Revenues', parentNumber: '5010' },
    command: 'PostCharge',
    currency: 'EUR',
    grossCents: 10000,
    netCents: 9346,
    taxes: [{ vatType: 'Reduced', percent: 7, amountCents: 654 }],
    receipt: { type: 'Reservation', number: 'BSP-ABCDEF-1-V1' },
    reference: 'BSP-ABCDEF-1',
    referenceType: 'Guest',
    sourceEntryNumber: 'BSPE0001',
    source: 'test',
    ...overrides,
  };
}
