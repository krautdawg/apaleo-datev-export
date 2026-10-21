import type { Skr } from './types.js';

/**
 * DATEV Automatikkonten (marked AM in the DATEV standard charts) that the hotel
 * templates use, with the VAT rate DATEV applies on them. Checked against the
 * DATEV charts "Gültig für 2026" (SKR 03 Art.-Nr. 11174, SKR 04 Art.-Nr. 11175,
 * Stand 2026-01-01). Numbers are the 4-digit base numbers.
 */
export const AUTOMATIC_ACCOUNTS: Readonly<Record<Skr, ReadonlyMap<string, number>>> = {
  '03': new Map([
    ['8300', 7], // Erlöse 7 % USt
    ['8400', 19], // Erlöse 19 % USt
    ['1711', 7], // Erhaltene, versteuerte Anzahlungen 7 % USt
    ['1718', 19], // Erhaltene, versteuerte Anzahlungen 19 % USt
    ['2401', 7], // Forderungsverluste 7 % USt
    ['2406', 19], // Forderungsverluste 19 % USt
  ]),
  '04': new Map([
    ['4300', 7],
    ['4400', 19],
    ['3260', 7],
    ['3272', 19],
    ['6931', 7],
    ['6936', 19],
  ]),
};

/** Which tax a BU key books: output tax (Umsatzsteuer) or input tax (Vorsteuer). */
export type TaxSide = 'output' | 'input';

/**
 * The tax keys the tool knows, for accounts without automatic function:
 * 2 and 3 book output tax, 8 and 9 input tax (DATEV standard Steuerschlüssel).
 */
const TAX_KEYS: ReadonlyMap<string, { rate: number; side: TaxSide }> = new Map([
  ['2', { rate: 7, side: 'output' }],
  ['3', { rate: 19, side: 'output' }],
  ['8', { rate: 7, side: 'input' }],
  ['9', { rate: 19, side: 'input' }],
]);

/**
 * The VAT rate of a known Automatikkonto, or undefined. At a Sachkontenlänge
 * above 4 the account carries trailing zeros (8300 is 83000 at length 5).
 */
export function automaticRate(skr: Skr, account: string, sachkontenlaenge: number): number | undefined {
  if (account.length !== sachkontenlaenge || !account.endsWith('0'.repeat(sachkontenlaenge - 4))) return undefined;
  return AUTOMATIC_ACCOUNTS[skr].get(account.slice(0, 4));
}

/**
 * The rate and side of a known tax key: `2`, `3`, `8`, `9`, or one of them after
 * the Berichtigungsschlüssel 2 (Generalumkehr, `22`, `23`, `28`, `29`), which
 * reverses the posting but keeps the rate. Undefined for any other key.
 */
export function taxKeyRate(buKey: string): { rate: number; side: TaxSide } | undefined {
  return TAX_KEYS.get(/^2\d$/.test(buKey) ? buKey.slice(1) : buKey);
}

/**
 * A two-digit key whose first digit is the Berichtigungsschlüssel 2 (Generalumkehr)
 * or 4 (Aufhebung der Automatik). These may be used on an Automatikkonto.
 */
export function isAllowedOnAutomatic(buKey: string): boolean {
  return /^[24]\d$/.test(buKey);
}

/**
 * A key with the Berichtigungsschlüssel 4 (Aufhebung der Automatik): DATEV does
 * not apply the Automatikkonto's rate. `40` books without VAT; in `4x` the
 * second digit is the tax key that applies instead.
 */
export function isAutomaticLifted(buKey: string): boolean {
  return /^4\d$/.test(buKey);
}
