import type { Finding } from '../core/findings.js';
import { BUCHUNGSSTAPEL_COLUMNS, COLUMN, maxLengthOf, type FilledField } from './columns.js';
import { ExtfValidationError } from './errors.js';
import { formatAmount, formatBuKey, formatField, formatTtmm, formatYyyymmdd, LINE_END, SEPARATOR } from './format.js';
import { labelOf } from './labels.js';
import { renderHeaderLine, resolveHeader, validateHeader } from './header.js';
import { sanitiseBelegfeld, sanitiseText, type Sanitised } from './sanitise.js';
import type { ExtfBooking, ExtfHeader } from './types.js';
import { validateBookings } from './validate.js';

export interface BuchungsstapelInput {
  header: ExtfHeader;
  bookings: readonly ExtfBooking[];
}

export interface RenderedBuchungsstapel {
  /** The whole file with CRLF line ends, only characters CP1252 can represent. Encode it with `encodeCp1252`. */
  text: string;
  /** Every change the writer made to a value, with booking index, field and original value. */
  warnings: Finding[];
}

/**
 * Renders a DATEV-Format Buchungsstapel: header line, column heading line and one
 * line per booking. Throws one `ExtfValidationError` with every problem found.
 * Header problems are reported on their own, because the booking checks depend
 * on the header (account length, period).
 */
export function renderBuchungsstapel({ header, bookings }: BuchungsstapelInput): RenderedBuchungsstapel {
  const headerErrors = validateHeader(header);
  if (headerErrors.length > 0) throw new ExtfValidationError(headerErrors);
  const bookingErrors = validateBookings(header, bookings);
  if (bookingErrors.length > 0) throw new ExtfValidationError(bookingErrors);

  const head = renderHeaderLine(header);
  const { festschreibung } = resolveHeader(header);
  const rows = bookings.map((booking, index) => renderBookingLine(booking, index, festschreibung));
  const lines = [head.line, columnHeadingLine(), ...rows.map((row) => row.line)];
  return {
    text: lines.map((line) => line + LINE_END).join(''),
    warnings: [...head.warnings, ...rows.flatMap((row) => row.warnings)],
  };
}

/** Line 2: the 125 column names, separated by `;`. */
export function columnHeadingLine(): string {
  return BUCHUNGSSTAPEL_COLUMNS.map((column) => column.name).join(SEPARATOR);
}

function renderBookingLine(booking: ExtfBooking, index: number, festschreibung: 0 | 1): { line: string; warnings: Finding[] } {
  const warnings: Finding[] = [];
  const clean = (field: FilledField, value: string | undefined, sanitise: typeof sanitiseText) => {
    if (value === undefined || value === '') return undefined;
    const result: Sanitised = sanitise(value, maxLengthOf(field), { index, field });
    warnings.push(...result.warnings);
    return result.value;
  };

  const values: Record<FilledField, string | undefined> = {
    umsatz: formatAmount(booking.amountCents),
    sollHaben: booking.side,
    konto: booking.konto,
    gegenkonto: booking.gegenkonto,
    buKey: booking.buKey ? formatBuKey(booking.buKey) : undefined,
    belegdatum: formatTtmm(booking.belegdatum),
    belegfeld1: clean('belegfeld1', booking.belegfeld1, sanitiseBelegfeld),
    belegfeld2: clean('belegfeld2', booking.belegfeld2, sanitiseBelegfeld),
    buchungstext: clean('buchungstext', booking.buchungstext, sanitiseText),
    kost1: clean('kost1', booking.kost1, sanitiseText),
    kost2: clean('kost2', booking.kost2, sanitiseText),
    festschreibung: String(festschreibung),
  };
  const byPosition = new Map<number, string | undefined>(
    Object.entries(values).map(([field, value]) => [COLUMN[field as FilledField], value]),
  );
  const line = BUCHUNGSSTAPEL_COLUMNS.map((column, i) => formatField(column.type, byPosition.get(i + 1))).join(SEPARATOR);
  return { line, warnings };
}

const SUFFIX = /^[A-Za-z0-9_-]+$/;

/**
 * `EXTF_Buchungsstapel_<Berater>_<Mandant>_<YYYYMMDD>-<YYYYMMDD>[_<suffix>].csv`.
 * DATEV only imports files whose name starts with `EXTF_`, so the file must not be renamed.
 */
export function buchungsstapelFileName(header: ExtfHeader, suffix?: string): string {
  if (suffix !== undefined && !SUFFIX.test(suffix)) {
    throw new ExtfValidationError([
      {
        code: 'E-EXTF-FILE-NAME',
        field: 'suffix',
        label: labelOf('suffix'),
        value: suffix,
        message: `File name suffix may only contain A-Z a-z 0-9 _ -, got "${suffix}"`,
      },
    ]);
  }
  const period = `${formatYyyymmdd(header.datumVom)}-${formatYyyymmdd(header.datumBis)}`;
  const parts = ['EXTF', 'Buchungsstapel', header.beraternummer, header.mandantennummer, period];
  if (suffix !== undefined) parts.push(suffix);
  return `${parts.join('_')}.csv`;
}
