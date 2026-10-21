import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { encodeCp1252, renderBuchungsstapel, type ExtfBooking } from '../../src/datev/index.js';
import { booking, octoberHeader } from '../helpers/extf.js';
import { describeDifference } from '../helpers/golden.js';

/**
 * Byte-for-byte regression tests. After an intended change to the writer, run
 * `UPDATE_GOLDEN=1 pnpm test`, read the diff of test/golden/datev/ and commit it.
 */
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const header = octoberHeader({ bezeichnung: 'apaleo 10/2026' });

interface GoldenCase {
  bookings: ExtfBooking[];
  warnings: string[];
}

const CASES: Record<string, GoldenCase> = {
  minimal: {
    bookings: [booking({ belegfeld1: 'INV-2026-001', buchungstext: 'Logis 7%' })],
    warnings: [],
  },
  'revenue-7-19': {
    bookings: [
      booking({ amountCents: 10_700, gegenkonto: '8300', belegfeld1: 'INV-2026-002', buchungstext: 'Logis 7%' }),
      booking({ amountCents: 2_380, gegenkonto: '8400', belegfeld1: 'INV-2026-002', buchungstext: 'Bar 19%' }),
    ],
    warnings: [],
  },
  'bu-key': {
    bookings: [
      booking({
        amountCents: 11_900,
        konto: '1200',
        gegenkonto: '8200',
        buKey: '3',
        belegdatum: '2026-10-07',
        belegfeld1: 'INV-2026-003',
        buchungstext: 'Seminarraum 19%',
      }),
    ],
    warnings: [],
  },
  payment: {
    bookings: [
      booking({
        amountCents: 12_000,
        konto: '1360',
        gegenkonto: '10001',
        side: 'S',
        belegdatum: '2026-10-08',
        belegfeld1: 'INV-2026-003',
        belegfeld2: 'PSP-778899',
        buchungstext: 'Kartenzahlung Visa',
      }),
    ],
    warnings: [],
  },
  'umlauts-euro': {
    bookings: [
      booking({ amountCents: 1_500, gegenkonto: '8300', buchungstext: 'Frühstück 5 € Zimmer "Seeblick"' }),
      booking({ amountCents: 990, side: 'H', konto: '8400', gegenkonto: '1360', buchungstext: 'Rückbuchung Getränke – Öl & Süßes' }),
    ],
    warnings: [],
  },
  'sanitised-belegfeld1': {
    bookings: [booking({ belegfeld1: 'MUC.ABCDEF-1 Zahlung über Kreditkarte, Nummer 1234-5678', buchungstext: 'Zahlung' })],
    warnings: ['W-EXTF-BELEGFELD', 'W-EXTF-TRUNCATED'],
  },
  'cost-centres': {
    bookings: [
      booking({ kost1: 'LOGIS', kost2: 'MUC01', buchungstext: 'Logis 7%' }),
      booking({ amountCents: 2_380, gegenkonto: '8400', kost1: 'FB', kost2: 'Restaurant und Bar im Erdgeschoss Hotel', buchungstext: 'Bar 19%' }),
    ],
    warnings: ['W-EXTF-TRUNCATED'],
  },
};

describe('golden files', () => {
  it.each(Object.entries(CASES))('%s matches its golden file byte for byte', (name, { bookings, warnings }) => {
    const rendered = renderBuchungsstapel({ header, bookings });
    expect(rendered.warnings.map((w) => w.code)).toEqual(warnings);
    const { bytes, replaced } = encodeCp1252(rendered.text);
    expect(replaced).toEqual([]);

    const file = new URL(`../golden/datev/${name}.csv`, import.meta.url);
    if (UPDATE) writeFileSync(file, bytes);
    expect(existsSync(file), `missing ${file.pathname}; run UPDATE_GOLDEN=1 pnpm test`).toBe(true);
    const difference = describeDifference(new Uint8Array(readFileSync(file)), bytes);
    expect(difference, `${name}.csv differs from the writer output:\n${difference ?? ''}`).toBeUndefined();
  });

  it('covers at least the cases the spec lists', () => {
    expect(Object.keys(CASES)).toEqual(
      expect.arrayContaining(['minimal', 'revenue-7-19', 'bu-key', 'payment', 'umlauts-euro', 'sanitised-belegfeld1', 'cost-centres']),
    );
  });
});

describe('golden diff helper', () => {
  const golden = encodeCp1252(renderBuchungsstapel({ header, bookings: CASES.minimal?.bookings ?? [] }).text).bytes;

  it('reports nothing for identical bytes', () => {
    expect(describeDifference(golden, golden.slice())).toBeUndefined();
  });

  it('names the line, field and column of a changed byte', () => {
    const changed = encodeCp1252(
      renderBuchungsstapel({ header, bookings: [booking({ belegfeld1: 'INV-2026-001', buchungstext: 'Logis 19%' })] }).text,
    ).bytes;
    expect(describeDifference(golden, changed)).toBe(
      'line 3:\n  field 14 (Buchungstext): expected "Logis 7%", got "Logis 19%"',
    );
  });

  it('shows a lost CR in a line end', () => {
    const text = new TextDecoder('windows-1252').decode(golden).replaceAll('\r\n', '\n');
    expect(describeDifference(golden, encodeCp1252(text).bytes)).toContain('\\r\\n');
  });

  it('reports a missing line', () => {
    const shorter = encodeCp1252(renderBuchungsstapel({ header, bookings: [] }).text).bytes;
    expect(describeDifference(golden, shorter)).toContain('line 3:\n  - expected:');
  });
});
