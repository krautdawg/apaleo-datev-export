import { describe, expect, it } from 'vitest';
import { formatAmount, formatBuKey, formatField, formatTtmm, formatYyyymmdd, quoteText } from '../../src/datev/format.js';
import { formatTimestamp } from '../../src/datev/header.js';

describe('field formatters', () => {
  it.each([
    [1, '0,01'],
    [100, '1,00'],
    [10_700, '107,00'],
    [123_456_789, '1234567,89'],
    [999_999_999_999, '9999999999,99'],
  ])('formats %i cents as %s', (cents, text) => {
    expect(formatAmount(cents)).toBe(text);
  });

  it('formats Belegdatum as TTMM with leading zeros', () => {
    expect(formatTtmm('2026-10-05')).toBe('0510');
    expect(formatTtmm('2026-01-31')).toBe('3101');
  });

  it('formats header dates as YYYYMMDD', () => {
    expect(formatYyyymmdd('2026-01-01')).toBe('20260101');
  });

  it('quotes text and doubles inner quotes', () => {
    expect(quoteText('Zimmer "Seeblick"')).toBe('"Zimmer ""Seeblick"""');
    expect(quoteText('')).toBe('""');
  });

  it('quotes only Text fields and writes empty values as nothing', () => {
    expect(formatField('Text', '3')).toBe('"3"');
    expect(formatField('Account', '1360')).toBe('1360');
    expect(formatField('Amount', '107,00')).toBe('107,00');
    expect(formatField('Date', '0510')).toBe('0510');
    expect(formatField('Number', '1')).toBe('1');
    for (const type of ['Text', 'Account', 'Amount', 'Date', 'Number'] as const) {
      expect(formatField(type, undefined)).toBe('');
      expect(formatField(type, '')).toBe('');
    }
  });

  it('writes BU-Schlüssel unpadded', () => {
    expect(formatBuKey('3')).toBe('3');
    expect(formatBuKey('40')).toBe('40');
  });

  it('writes Erzeugt am in German local time, summer and winter', () => {
    expect(formatTimestamp(new Date('2026-11-03T09:15:00.000Z'))).toBe('20261103101500000');
    expect(formatTimestamp(new Date('2026-07-01T22:05:09.042Z'))).toBe('20260702000509042');
  });
});
