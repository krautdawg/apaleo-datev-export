import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import { cp1252Byte, encodeCp1252, toCp1252Text } from '../../src/datev/cp1252.js';

const UNDEFINED_BYTES = [0x81, 0x8d, 0x8f, 0x90, 0x9d];

describe('CP1252 table against iconv-lite', () => {
  const bytes = Array.from({ length: 256 }, (_, byte) => byte);

  it.each(bytes.filter((b) => !UNDEFINED_BYTES.includes(b)))('maps byte %i both ways', (byte) => {
    const char = iconv.decode(Buffer.from([byte]), 'win1252');
    const { bytes: encoded, replaced } = encodeCp1252(char);
    expect([...encoded]).toEqual([byte]);
    expect(replaced).toEqual([]);
    expect([...iconv.encode(char, 'win1252')]).toEqual([byte]);
  });

  it('leaves the five undefined bytes unused', () => {
    for (const byte of UNDEFINED_BYTES) {
      expect(iconv.decode(Buffer.from([byte]), 'win1252')).toBe('�');
      // The C1 control with the same number is not CP1252 and becomes "?".
      expect(cp1252Byte(byte)).toBeUndefined();
      expect([...encodeCp1252(String.fromCharCode(byte)).bytes]).toEqual([0x3f]);
    }
  });

  it('agrees with iconv-lite on a mixed hotel text', () => {
    const text = 'Frühstück 5 € – Zimmer „Seeblick“ … Œuvre ™ Žilina';
    expect([...encodeCp1252(text).bytes]).toEqual([...iconv.encode(text, 'win1252')]);
  });
});

describe('encodeCp1252', () => {
  it('writes a decomposed (NFD) ü as 0xFC without a warning', () => {
    const nfd = 'Frühstück'.normalize('NFD');
    expect(toCp1252Text(nfd)).toEqual({ text: 'Frühstück', replaced: [] });
    const { bytes, replaced } = encodeCp1252(nfd);
    expect([...bytes]).toEqual([...iconv.encode('Frühstück', 'win1252')]);
    expect(replaced).toEqual([]);
  });

  it('writes ü as 0xFC and € as 0x80 without a warning', () => {
    const { bytes, replaced } = encodeCp1252('Frühstück 5 €');
    expect(bytes).toContain(0xfc);
    expect(bytes).toContain(0x80);
    expect(replaced).toEqual([]);
  });

  it('writes no byte-order mark', () => {
    expect([...encodeCp1252('A').bytes]).toEqual([0x41]);
  });

  it('replaces an emoji by ? and reports it', () => {
    const { bytes, replaced } = encodeCp1252('Bett 🛏');
    expect(Buffer.from(bytes).toString('latin1')).toBe('Bett ?');
    expect(replaced).toEqual([
      expect.objectContaining({ code: 'W-EXTF-CHARSET', value: '🛏', message: expect.stringContaining('U+1F6CF') }),
    ]);
  });
});

describe('transliteration', () => {
  it.each([
    ['ćevapčići', 'cevapcici'],
    ['Łódź', '?ódz'],
    ['Preis −5', 'Preis -5'],
    ['non‑breaking', 'non-breaking'],
    ['❤️', '?'],
    ['A​B', 'AB'],
  ])('%s → %s', (input, output) => {
    const result = toCp1252Text(input);
    expect(result.text).toBe(output);
    expect(result.replaced.length).toBeGreaterThan(0);
  });

  it('keeps every CP1252 character as it is', () => {
    expect(toCp1252Text('Größe – „OK“ 100 % ÄÖÜ äöü ß é')).toEqual({ text: 'Größe – „OK“ 100 % ÄÖÜ äöü ß é', replaced: [] });
  });
});
