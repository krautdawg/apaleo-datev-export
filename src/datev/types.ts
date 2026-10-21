import type { LocalDate } from '../core/date.js';

/** What the caller decides about one Buchungsstapel file. Defaults are in `header.ts`. */
export interface ExtfHeader {
  /** Beraternummer, 1001–9999999. */
  beraternummer: number;
  /** Mandantennummer, 1–99999. */
  mandantennummer: number;
  /** Start of the fiscal year (Wirtschaftsjahresbeginn). */
  wjBeginn: LocalDate;
  /** Length of G/L account numbers, 4–8. Must match the Mandant in DATEV. */
  sachkontenlaenge: number;
  /** First day of the batch period. */
  datumVom: LocalDate;
  /** Last day of the batch period. */
  datumBis: LocalDate;
  /** Chart of accounts with leading zero, for example `"03"` (SKR 03) or `"04"` (SKR 04). */
  sachkontenrahmen: string;
  /** Written into "Erzeugt am". Pass `ctx.now()`; tests pass a fixed date. */
  erzeugtAm: Date;
  /** Batch name shown in DATEV, at most 30 characters. */
  bezeichnung?: string;
  /** Initials of the clerk: two capital letters, or empty. */
  diktatkuerzel?: string;
  /** 0 leaves the batch editable in DATEV (default), 1 locks it after import. */
  festschreibung?: 0 | 1;
  /** At most 2 characters, default `"RE"`. DATEV replaces it with `SV` on import. */
  herkunft?: string;
  /** At most 25 characters, default `"apaleo-datev-export"`. */
  exportiertVon?: string;
}

/** One Buchungsstapel line. Every other DATEV column stays empty. */
export interface ExtfBooking {
  /**
   * Positive amount in whole cents, 1 to 999,999,999,999. A negative amount is
   * rejected (`E-EXTF-AMOUNT`): flip `side` instead of passing one.
   */
  amountCents: number;
  /** Soll (debit) or Haben (credit), relative to `konto`. */
  side: 'S' | 'H';
  /** Digits only, exactly Sachkontenlänge (G/L) or Sachkontenlänge + 1 (personal account). */
  konto: string;
  /** Same rules as `konto`. */
  gegenkonto: string;
  /** BU-Schlüssel, one to four digits, for example `"3"`. Leave empty on Automatikkonten. */
  buKey?: string;
  /** Must lie inside the header period. Written as TTMM. */
  belegdatum: LocalDate;
  /** Document number, the OPOS matching key. Sanitised to 36 characters of `A-Z a-z 0-9 $ & % * + - /`. */
  belegfeld1?: string;
  /** Sanitised like Belegfeld 1, at most 12 characters. */
  belegfeld2?: string;
  /** At most 60 characters, control characters removed. */
  buchungstext?: string;
  /** Cost centre 1, at most 36 characters. */
  kost1?: string;
  /** Cost centre 2, at most 36 characters. */
  kost2?: string;
}
