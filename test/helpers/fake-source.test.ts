import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareAggregates } from '../../src/core/aggregates.js';
import { ChartIndex } from '../../src/core/chart.js';
import { nextDay } from '../../src/core/date.js';
import type { SourceAdapter } from '../../src/core/source.js';
import { BSP, LEDGER_DAYS, loadBeispielData } from './apaleo.js';
import { FakeSource } from './fake-source.js';
import { ledgerLine } from './ledger.js';

describe('FakeSource', () => {
  it('imports nothing from src/sources, so code under test runs without apaleo modules', () => {
    const code = readFileSync(new URL('./fake-source.ts', import.meta.url), 'utf8');
    const imports = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((path) => path?.includes('sources'))).toEqual([]);
  });

  it('serves the ledger of a period sorted, without exposing its own data', async () => {
    const source: SourceAdapter = new FakeSource({
      properties: [],
      charts: {},
      ledger: {
        BSP: [
          ledgerLine({ businessDate: '2026-09-15', sourceEntryNumber: 'B' }),
          ledgerLine({ businessDate: '2026-09-14', sourceEntryNumber: 'C' }),
          ledgerLine({ businessDate: '2026-09-16', sourceEntryNumber: 'A' }),
        ],
      },
    });
    const lines = await source.getLedger(BSP, '2026-09-14', '2026-09-16');
    expect(lines.map((l) => l.sourceEntryNumber)).toEqual(['C', 'B']);
    Object.assign(lines[0] ?? {}, { grossCents: 1 });
    expect((await source.getLedger(BSP, '2026-09-14', '2026-09-15'))[0]?.grossCents).toBe(10000);
    expect(await source.getAccountTotals(BSP, '2026-09-14')).toMatchObject({ accounts: [] });
    expect(await source.getChartOfAccounts('XXX')).toEqual([]);
  });

  it('runs PMS-neutral core code over the Hotel Beispiel fixtures', async () => {
    const source = new FakeSource(await loadBeispielData());
    const chart = new ChartIndex(await source.getChartOfAccounts(BSP));
    for (const day of LEDGER_DAYS) {
      const lines = await source.getLedger(BSP, day, nextDay(day));
      const comparison = compareAggregates(await source.getAccountTotals(BSP, day), lines, chart);
      expect(comparison.length, day).toBeGreaterThan(0);
      expect(comparison.filter((c) => !c.match), day).toEqual([]);
    }
    expect(source.calls[0]).toBe(`getChartOfAccounts ${BSP}`);
  });
});
