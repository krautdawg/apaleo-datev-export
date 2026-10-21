import { describe, expect, it } from 'vitest';
import { formatFinding, isErrorFinding } from '../../src/core/findings.js';

describe('findings', () => {
  it('treats E- codes as errors', () => {
    expect(isErrorFinding({ code: 'E-EXTF-AMOUNT', message: '' })).toBe(true);
    expect(isErrorFinding({ code: 'W-EXTF-TRUNCATED', message: '' })).toBe(false);
  });

  it('formats code, booking number (from 1), field label and message on one line', () => {
    expect(formatFinding({ code: 'E-EXTF-AMOUNT', index: 3, field: 'amountCents', label: 'Umsatz', message: 'too small' })).toBe(
      'E-EXTF-AMOUNT (booking 4, Umsatz): too small',
    );
    expect(formatFinding({ code: 'E-X', index: 0, field: 'konto', message: 'bad' })).toBe('E-X (booking 1, konto): bad');
    expect(formatFinding({ code: 'E-EXTF-HEADER', message: 'bad' })).toBe('E-EXTF-HEADER: bad');
  });
});
