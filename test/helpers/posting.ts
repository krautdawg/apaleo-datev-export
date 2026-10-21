import { ChartIndex } from '../../src/core/chart.js';
import type { AccountRef, LedgerLine } from '../../src/core/source.js';
import { parseMapping, type Mapping, type MappingRowValues } from '../../src/mapping/index.js';
import { rowKey } from '../../src/mapping/types.js';
import { buildBookings, type PostingOptions, type PostingResult } from '../../src/posting/index.js';
import { BSP, loadBeispielData } from './apaleo.js';
import { mappingOf, readMappingFixture } from './mapping.js';

/** The Hotel Beispiel data and its SKR03 mapping (`test/fixtures/mapping/skr03-beispiel.csv`). */
export const BEISPIEL = await loadBeispielData();
export const CHART = new ChartIndex(BEISPIEL.charts[BSP] ?? []);
export const LEDGER: readonly LedgerLine[] = BEISPIEL.ledger[BSP] ?? [];
export const SKR03_MAPPING = parseMapping(readMappingFixture('skr03-beispiel.csv'), { path: 'skr03-beispiel.csv', sachkontenlaenge: 4 });
export const OPTIONS: PostingOptions = { belegfeld1: 'receipt', sachkontenlaenge: 4, skr: '03' };

/** The fixture mapping with the given rows first, replacing fixture rows with the same key. The first given row is on line 2. */
export function mappingWith(...rows: MappingRowValues[]): Mapping {
  const replaced = new Set(rows.map(rowKey));
  return mappingOf([...rows, ...SKR03_MAPPING.rows.filter((row) => !replaced.has(rowKey(row)))]);
}

export function post(lines: readonly LedgerLine[], mapping: Mapping = SKR03_MAPPING, options: Partial<PostingOptions> = {}): PostingResult {
  return buildBookings(lines, mapping, CHART, { ...OPTIONS, ...options });
}

export const ACCOUNTS = {
  visa: { number: '1611', name: 'Visa', type: 'Payments', parentNumber: '1610' },
  cash: { number: '1600', name: 'Cash', type: 'Payments', parentNumber: '1000' },
  receivables: { number: 'BSP-ABCDEF-1_Receivables', name: 'Receivables for Reservation BSP-ABCDEF-1', type: 'Receivables' },
  folio: { number: 'BSP-12345-1', name: 'Müller, Hans', type: 'Receivables', parentNumber: '1200' },
  liabilities: { number: 'BSP-GHIJKL-1_Liabilities', name: 'Liabilities for Reservation BSP-GHIJKL-1', type: 'Liabilities' },
  accommodation7: { number: '5011', name: 'Accommodation 7%', type: 'Revenues', parentNumber: 'RevenueAccommodation' },
  accommodation19: { number: '5019', name: 'Accommodation 19%', type: 'Revenues', parentNumber: 'RevenueAccommodation' },
  food7: { number: '5111', name: 'Food 7%', type: 'Revenues', parentNumber: '5110' },
  beverages19: { number: '5121', name: 'Beverages 19%', type: 'Revenues', parentNumber: '5120' },
  cityTax: { number: '3501', name: 'City Tax 0%', type: 'CityTaxes', parentNumber: '3500' },
  accountsReceivable: { number: '1400', name: 'Accounts Receivable', type: 'AccountsReceivable' },
  vat7: { number: '2007', name: 'VAT 7%', type: 'Vat', parentNumber: '2000' },
  vatOnLiabilities7: { number: '2107', name: 'VAT on Liabilities 7%', type: 'VatOnLiabilities', parentNumber: '2100' },
} satisfies Record<string, AccountRef>;
