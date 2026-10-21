import type { Finding } from '../core/findings.js';

/**
 * Windows-1252 bytes 0x80–0x9F that hold printable characters. The other five
 * bytes in that range (0x81, 0x8D, 0x8F, 0x90, 0x9D) are undefined. Every other
 * byte equals its Unicode code point (ASCII and Latin-1 0xA0–0xFF).
 */
const HIGH_BYTES: ReadonlyMap<number, number> = new Map([
  [0x20ac, 0x80], // €
  [0x201a, 0x82], // ‚
  [0x0192, 0x83], // ƒ
  [0x201e, 0x84], // „
  [0x2026, 0x85], // …
  [0x2020, 0x86], // †
  [0x2021, 0x87], // ‡
  [0x02c6, 0x88], // ˆ
  [0x2030, 0x89], // ‰
  [0x0160, 0x8a], // Š
  [0x2039, 0x8b], // ‹
  [0x0152, 0x8c], // Œ
  [0x017d, 0x8e], // Ž
  [0x2018, 0x91], // ‘
  [0x2019, 0x92], // ’
  [0x201c, 0x93], // “
  [0x201d, 0x94], // ”
  [0x2022, 0x95], // •
  [0x2013, 0x96], // –
  [0x2014, 0x97], // —
  [0x02dc, 0x98], // ˜
  [0x2122, 0x99], // ™
  [0x0161, 0x9a], // š
  [0x203a, 0x9b], // ›
  [0x0153, 0x9c], // œ
  [0x017e, 0x9e], // ž
  [0x0178, 0x9f], // Ÿ
]);

/** Common characters outside CP1252 and their closest CP1252 spelling. */
const TRANSLITERATIONS: ReadonlyMap<string, string> = new Map([
  ['‐', '-'], // hyphen
  ['‑', '-'], // non-breaking hyphen
  ['‒', '-'], // figure dash
  ['―', '-'], // horizontal bar
  ['−', '-'], // minus sign
  ['′', "'"], // prime
  ['″', '"'], // double prime
  [' ', ' '], // thin space
  [' ', ' '], // narrow no-break space
  ['​', ''], // zero-width space
  ['‍', ''], // zero-width joiner
  ['﻿', ''], // byte-order mark
]);

const REPLACEMENT = '?';
const COMBINING_MARKS = /\p{M}/gu;
const VARIATION_SELECTOR = /^[︀-️]$/u;

/** The CP1252 byte for a code point, or undefined if CP1252 cannot represent it. */
export function cp1252Byte(codePoint: number): number | undefined {
  if (codePoint < 0x80 || (codePoint >= 0xa0 && codePoint <= 0xff)) return codePoint;
  return HIGH_BYTES.get(codePoint);
}

function isCp1252(char: string): boolean {
  return cp1252Byte(char.codePointAt(0) ?? -1) !== undefined;
}

/** CP1252 spelling of one character: itself, a transliteration, the base letter, or `?`. */
function toCp1252Char(char: string): string {
  if (isCp1252(char)) return char;
  const known = TRANSLITERATIONS.get(char);
  if (known !== undefined) return known;
  if (VARIATION_SELECTOR.test(char)) return '';
  const base = char.normalize('NFD').replace(COMBINING_MARKS, '');
  if (base !== '' && base !== char && [...base].every(isCp1252)) return base;
  return REPLACEMENT;
}

export interface Cp1252Text {
  /** The text with every character CP1252 can represent. */
  text: string;
  /** The characters that had to be changed, in order of appearance. */
  replaced: string[];
}

/**
 * Transliterates or replaces every character that CP1252 cannot represent. The
 * text is composed (NFC) first, so a decomposed `u` + U+0308 becomes `ü` instead
 * of `u?`; composing changes no visible character and is not reported.
 */
export function toCp1252Text(text: string): Cp1252Text {
  const replaced: string[] = [];
  let out = '';
  for (const char of text.normalize('NFC')) {
    const mapped = toCp1252Char(char);
    if (mapped !== char) replaced.push(char);
    out += mapped;
  }
  return { text: out, replaced };
}

/**
 * Encodes text as Windows-1252 (CP1252) without byte-order mark. Characters CP1252
 * cannot represent are transliterated (for example `‑` to `-` or `ć` to `c`) or
 * replaced by `?` (for example `ł` or an emoji); each one becomes a
 * `W-EXTF-CHARSET` finding.
 */
export function encodeCp1252(text: string): { bytes: Uint8Array; replaced: Finding[] } {
  const { text: safe, replaced } = toCp1252Text(text);
  const bytes = new Uint8Array(safe.length);
  for (let i = 0; i < safe.length; i++) {
    // toCp1252Text only returns BMP characters that cp1252Byte maps.
    bytes[i] = cp1252Byte(safe.charCodeAt(i)) ?? REPLACEMENT.charCodeAt(0);
  }
  return {
    bytes,
    replaced: replaced.map((char) => ({
      code: 'W-EXTF-CHARSET',
      message: `character ${describe(char)} is not in Windows-1252 and was replaced`,
      value: char,
    })),
  };
}

/** `"🛏" (U+1F6CF)`, for warnings. */
export function describe(char: string): string {
  const codePoint = (char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
  return `"${char}" (U+${codePoint})`;
}
