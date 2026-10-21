/**
 * One problem or note found while checking or writing data.
 *
 * The code prefix carries the severity: `E-` blocks the export, `W-` is a
 * warning the user should read, `N-` is a note.
 */
export interface Finding {
  readonly code: string;
  /** Plain-language text for the user. Uses `label`, never internal field names. */
  readonly message: string;
  /** Position of the record in its input array (0-based), if the finding is about one record. Shown 1-based. */
  readonly index?: number;
  /** Machine name of the field the finding is about, for code and tests. */
  readonly field?: string;
  /** The field's name as the user knows it (for example `Umsatz`), shown instead of `field`. */
  readonly label?: string;
  /** The offending or original value, as text. */
  readonly value?: string;
}

export function isErrorFinding(finding: Finding): boolean {
  return finding.code.startsWith('E-');
}

/** One line per finding, for error messages and CLI output. Bookings are numbered from 1. */
export function formatFinding(finding: Finding): string {
  const where = [
    finding.index === undefined ? undefined : `booking ${finding.index + 1}`,
    finding.label ?? finding.field,
  ].filter((part) => part !== undefined);
  return `${finding.code}${where.length > 0 ? ` (${where.join(', ')})` : ''}: ${finding.message}`;
}
