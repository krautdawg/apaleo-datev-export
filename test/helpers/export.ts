import { readFileSync } from 'node:fs';
import type { LedgerLine } from '../../src/core/source.js';
import { BSP, FIXTURE_FILES } from './apaleo.js';
import { createTestContext, type TestContext } from './context.js';
import { FakeSource, type FakeSourceData } from './fake-source.js';
import { BEISPIEL } from './posting.js';

/** The SKR03 mapping of Hotel Beispiel (`test/fixtures/mapping/skr03-beispiel.csv`) as text. */
export const BEISPIEL_MAPPING = readFileSync(new URL('../fixtures/mapping/skr03-beispiel.csv', import.meta.url), 'utf8');

/** The fixture config with property BSP and the given lines appended. */
export function exportConfig(...extra: string[]): string {
  return `${FIXTURE_FILES['apaleo-datev.config.yaml']}properties:\n  - id: BSP\n${extra.map((line) => `${line}\n`).join('')}`;
}

export interface ExportSetup {
  ctx: TestContext;
  fake: FakeSource;
  data: FakeSourceData;
}

export interface ExportSetupOptions {
  config?: string;
  files?: Record<string, string>;
  /** Changes the Hotel Beispiel data before the fake source serves it. */
  data?: (data: FakeSourceData) => void;
  now?: Date;
}

/**
 * A test context for the export: the fixture config, the Hotel Beispiel mapping
 * as `mapping-BSP.csv`, a `FakeSource` over the fixtures (shared by every call,
 * so a test can change `data` between runs) and the fixed clock 2026-10-20.
 */
export function exportSetup(options: ExportSetupOptions = {}): ExportSetup {
  const data = structuredClone(BEISPIEL);
  options.data?.(data);
  const fake = new FakeSource(data);
  const ctx = createTestContext({
    files: { 'apaleo-datev.config.yaml': options.config ?? exportConfig(), 'mapping-BSP.csv': BEISPIEL_MAPPING, ...options.files },
    sourceFactory: () => fake,
    ...(options.now ? { now: options.now } : {}),
  });
  return { ctx, fake, data };
}

/** Hotel Beispiel served a second time as property BSP2, with the same chart and ledger. */
export function addSecondProperty(data: FakeSourceData, id = 'BSP2'): void {
  const property = data.properties.find((p) => p.id === BSP);
  if (!property) throw new Error('fixture property BSP missing');
  data.properties.push({ ...property, id, code: id, name: `${property.name} 2` });
  data.charts[id] = structuredClone(data.charts[BSP] ?? []);
  data.ledger[id] = structuredClone(data.ledger[BSP] ?? []);
}

/** A late posting: one more 7 % logis charge on 2026-09-22. */
export function latePosting(data: FakeSourceData): void {
  const [template] = (data.ledger[BSP] ?? []).filter((line: LedgerLine) => line.command === 'PostCharge' && line.credit.number === '5011');
  if (!template) throw new Error('fixture logis charge missing');
  data.ledger[BSP]?.push({ ...structuredClone(template), businessDate: '2026-09-22', postedAt: '2026-09-23T01:10:00Z', sourceEntryNumber: 'BSPE9999' });
}
