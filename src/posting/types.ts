import type { PostingConfig } from '../core/config.js';
import type { Finding } from '../core/findings.js';
import type { LedgerLine } from '../core/source.js';
import type { ExtfBooking } from '../datev/types.js';
import type { Skr } from '../mapping/index.js';

/** One DATEV booking, with the source entries it came from for traceability. */
export interface PostedBooking extends ExtfBooking {
  sourceEntryNumbers: string[];
}

/**
 * Why a ledger line produced no booking although nothing is wrong with it:
 * - `VAT_ACCOUNT_LINE`: a side is an apaleo Vat or VatOnLiabilities account;
 *   DATEV computes that VAT itself from the Automatikkonten or BU keys.
 * - `ZERO_AMOUNT`: the gross amount is 0.
 * - `SAME_ACCOUNT`: both sides map to the same DATEV account (for example a
 *   move between two guest folios).
 */
export const SKIP_REASONS = ['VAT_ACCOUNT_LINE', 'ZERO_AMOUNT', 'SAME_ACCOUNT'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export interface SkippedLine {
  reason: SkipReason;
  line: LedgerLine;
}

export interface PostingOptions extends PostingConfig {
  /** Length of DATEV G/L account numbers; needed to recognise Automatikkonten. */
  sachkontenlaenge: number;
  /** The Mandant's chart of accounts; decides which accounts are Automatikkonten. */
  skr: Skr;
}

/** Soll and Haben of one DATEV account over all bookings. Balance is Soll minus Haben. */
export interface DatevAccountTotal {
  account: string;
  sollCents: number;
  habenCents: number;
  balanceCents: number;
}

/** Revenue booked at one DATEV VAT rate, signed (allowances reduce it), with the VAT DATEV will compute. */
export interface RevenueTotal {
  ratePercent: number;
  grossCents: number;
  vatCents: number;
}

/** Payments received on one DATEV clearing account, signed (refunds reduce it). */
export interface PaymentTotal {
  account: string;
  cents: number;
}

export interface SkippedTotal {
  reason: SkipReason;
  lines: number;
  grossCents: number;
}

export interface FindingCount {
  code: string;
  count: number;
}

/** Totals of one posting run, all in cents. */
export interface PostingSummary {
  accounts: DatevAccountTotal[];
  revenueByRate: RevenueTotal[];
  /** City tax, second city tax and guest levies, signed. */
  cityTaxCents: number;
  payments: PaymentTotal[];
  deposits: { receivedCents: number; releasedCents: number };
  skipped: SkippedTotal[];
  /** Sum of the one-cent differences (DATEV's VAT minus apaleo's) reported as `W-VAT-ROUNDING`. */
  roundingCents: number;
  findings: FindingCount[];
}

export interface PostingResult {
  bookings: PostedBooking[];
  skipped: SkippedLine[];
  /** `E-` findings block the export. */
  findings: Finding[];
  summary: PostingSummary;
  /**
   * Per VAT rate, how many one-cent differences the run reported as
   * `W-VAT-ROUNDING`. The plausibility check allows that many cents at that
   * rate only.
   */
  vatRoundingByRate: ReadonlyMap<number, number>;
}
