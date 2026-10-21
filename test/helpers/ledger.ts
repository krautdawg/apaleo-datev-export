import { formatCents } from '../../src/core/money.js';
import type { LedgerLine, LedgerTax } from '../../src/core/source.js';

/** A tax entry whose precise amount is the whole cents, as fabricated fixtures have it. */
export function tax(vatType: string, percent: number, amountCents: number, amountPrecise = formatCents(amountCents)): LedgerTax {
  return { vatType, percent, amountPrecise, amountCents };
}

/**
 * A valid ledger line (a 7 % accommodation charge) with the given fields
 * replaced. Unless given, `netPrecise` is the whole cents of `netCents`.
 */
export function ledgerLine(overrides: Partial<LedgerLine> = {}): LedgerLine {
  const netCents = overrides.netCents ?? 9346;
  return {
    businessDate: '2026-09-14',
    postedAt: '2026-09-14T15:40:00Z',
    debit: { number: 'BSP-ABCDEF-1_Receivables', name: 'Receivables for Reservation BSP-ABCDEF-1', type: 'Receivables' },
    credit: { number: '5011', name: 'Accommodation 7%', type: 'Revenues', parentNumber: 'RevenueAccommodation' },
    command: 'PostCharge',
    currency: 'EUR',
    grossCents: 10000,
    netPrecise: formatCents(netCents),
    netCents,
    taxes: [tax('Reduced', 7, 654)],
    receipt: { type: 'Reservation', number: 'BSP-ABCDEF-1-V1' },
    reference: 'BSP-ABCDEF-1',
    referenceType: 'Guest',
    sourceEntryNumber: 'BSPE0001',
    source: 'test',
    ...overrides,
  };
}
