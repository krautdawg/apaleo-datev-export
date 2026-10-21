import { describe, expect, it } from 'vitest';
import { sanitiseBelegfeld, sanitiseText } from '../../src/datev/sanitise.js';

const at = { index: 2, field: 'belegfeld1' };

describe('Belegfeld sanitising', () => {
  it('drops dots and turns spaces into dashes, keeping the original in a warning', () => {
    expect(sanitiseBelegfeld('MUC.ABCDEF-1 Zahlung', 36, at)).toEqual({
      value: 'MUCABCDEF-1-Zahlung',
      warnings: [expect.objectContaining({ code: 'W-EXTF-BELEGFELD', index: 2, field: 'belegfeld1', value: 'MUC.ABCDEF-1 Zahlung' })],
    });
  });

  it('transliterates umlauts and ß', () => {
    expect(sanitiseBelegfeld('Rückbuchung-17', 36, at)).toEqual({
      value: 'Rueckbuchung-17',
      warnings: [expect.objectContaining({ code: 'W-EXTF-BELEGFELD', value: 'Rückbuchung-17' })],
    });
    expect(sanitiseBelegfeld('ÄÖÜäöüß', 36, at).value).toBe('AeOeUeaeoeuess');
    expect(sanitiseBelegfeld('Café', 36, at).value).toBe('Cafe');
  });

  it('transliterates decomposed (NFD) umlauts like composed ones', () => {
    const nfd = 'Rückbuchung-17'.normalize('NFD');
    expect(nfd).not.toBe('Rückbuchung-17');
    expect(sanitiseBelegfeld(nfd, 36, at)).toEqual({
      value: 'Rueckbuchung-17',
      warnings: [expect.objectContaining({ code: 'W-EXTF-BELEGFELD', value: nfd })],
    });
    expect(sanitiseBelegfeld('ÄÖÜäöüß'.normalize('NFD'), 36, at).value).toBe('AeOeUeaeoeuess');
  });

  it('keeps the allowed special characters without a warning', () => {
    expect(sanitiseBelegfeld('Rg32029/2024$&%*+-', 36, at)).toEqual({ value: 'Rg32029/2024$&%*+-', warnings: [] });
  });

  it('removes commas, colons, semicolons, quotes, underscores and emoji', () => {
    expect(sanitiseBelegfeld('A,B:C;D"E_F🛏G', 36, at).value).toBe('ABCDEFG');
  });

  it('cuts Belegfeld 1 to 36 and Belegfeld 2 to 12 characters with a warning', () => {
    const long = 'A'.repeat(40);
    expect(sanitiseBelegfeld(long, 36, at)).toEqual({
      value: 'A'.repeat(36),
      warnings: [expect.objectContaining({ code: 'W-EXTF-TRUNCATED', value: long })],
    });
    expect(sanitiseBelegfeld('INV-2026-0000123', 12, { index: 0, field: 'belegfeld2' }).value).toBe('INV-2026-000');
  });

  it('reports both a character change and a cut', () => {
    const result = sanitiseBelegfeld(`${'Ü'.repeat(20)}`, 36, at);
    expect(result.value).toBe('Ue'.repeat(18));
    expect(result.warnings.map((w) => w.code)).toEqual(['W-EXTF-BELEGFELD', 'W-EXTF-TRUNCATED']);
  });
});

describe('free text sanitising', () => {
  const text = { index: 0, field: 'buchungstext' };

  it('keeps umlauts, € and quotes', () => {
    expect(sanitiseText('Frühstück 5 € "Seeblick"', 60, text)).toEqual({ value: 'Frühstück 5 € "Seeblick"', warnings: [] });
  });

  it('composes decomposed (NFD) umlauts instead of replacing the accent with "?"', () => {
    expect(sanitiseText('Frühstück'.normalize('NFD'), 60, text)).toEqual({ value: 'Frühstück', warnings: [] });
  });

  it('names the field as DATEV does in warnings', () => {
    expect(sanitiseText('x'.repeat(61), 60, text).warnings).toEqual([
      expect.objectContaining({ label: 'Buchungstext', message: expect.stringMatching(/^Buchungstext longer than 60/) }),
    ]);
  });

  it('turns line breaks and tabs into spaces and removes other control characters', () => {
    expect(sanitiseText('Logis\r\n7%\tBar\u0007\u0085', 60, text)).toEqual({
      value: 'Logis  7% Bar',
      warnings: [expect.objectContaining({ code: 'W-EXTF-CONTROL-CHARS', value: 'Logis\r\n7%\tBar\u0007\u0085' })],
    });
  });

  it('replaces characters outside CP1252 and names the booking and the original text', () => {
    expect(sanitiseText('Zimmer 🛏 Seeblick', 60, text)).toEqual({
      value: 'Zimmer ? Seeblick',
      warnings: [expect.objectContaining({ code: 'W-EXTF-CHARSET', index: 0, field: 'buchungstext', value: 'Zimmer 🛏 Seeblick' })],
    });
  });

  it('cuts to the maximum length counting characters, not UTF-16 units', () => {
    expect(sanitiseText('x'.repeat(61), 60, text).value).toBe('x'.repeat(60));
    expect(sanitiseText('x'.repeat(60), 60, text).warnings).toEqual([]);
    expect(sanitiseText(`${'€'.repeat(60)}`, 60, text).warnings).toEqual([]);
  });

  it('cuts a 40-character cost centre to 36 with a warning', () => {
    const kost = 'K'.repeat(40);
    expect(sanitiseText(kost, 36, { index: 1, field: 'kost1' })).toEqual({
      value: 'K'.repeat(36),
      warnings: [expect.objectContaining({ code: 'W-EXTF-TRUNCATED', index: 1, field: 'kost1', value: kost })],
    });
  });
});
