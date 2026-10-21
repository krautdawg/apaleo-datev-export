import { describe, expect, it } from 'vitest';
import type { ExtfBooking, ExtfHeader } from '../../src/datev/types.js';
import { MAX_AMOUNT_CENTS, validateBookings } from '../../src/datev/validate.js';
import { booking, octoberHeader } from '../helpers/extf.js';

function errors(overrides: Partial<ExtfBooking>, header: ExtfHeader = octoberHeader()) {
  return validateBookings(header, [booking(overrides)]);
}

describe('booking validation', () => {
  it('accepts a valid booking', () => {
    expect(errors({})).toEqual([]);
  });

  it.each([0, -100, 1.5, MAX_AMOUNT_CENTS + 1])('rejects amount %d', (amountCents) => {
    expect(errors({ amountCents })).toEqual([
      expect.objectContaining({ code: 'E-EXTF-AMOUNT', index: 0, field: 'amountCents', value: String(amountCents) }),
    ]);
  });

  it('accepts 1 cent and 9,999,999,999.99', () => {
    expect(errors({ amountCents: 1 })).toEqual([]);
    expect(errors({ amountCents: MAX_AMOUNT_CENTS })).toEqual([]);
  });

  it('words amount and account problems for the back office, with DATEV field names', () => {
    expect(errors({ amountCents: -500 })).toEqual([
      expect.objectContaining({ label: 'Umsatz', message: 'Umsatz must be between 0,01 and 9.999.999.999,99 EUR, got -5,00 EUR' }),
    ]);
    expect(errors({ gegenkonto: '83' })).toEqual([
      expect.objectContaining({ field: 'gegenkonto', label: 'Gegenkonto', message: expect.stringMatching(/^Gegenkonto "83" /) }),
    ]);
    const messages = [
      ...errors({ amountCents: 0, konto: 'x', belegdatum: '2026-12-01' }),
      ...errors({ konto: '8300', gegenkonto: '8300' }),
    ].map((f) => f.message);
    expect(messages.join('\n')).not.toMatch(/\b(amountCents|konto|gegenkonto|belegdatum)\b|flip side/);
  });

  it('rejects a side other than S or H', () => {
    expect(errors({ side: 'X' as 'S' })).toEqual([expect.objectContaining({ code: 'E-EXTF-SIDE' })]);
  });

  it('accepts a personal account one digit longer and rejects two digits longer', () => {
    expect(errors({ konto: '10001' })).toEqual([]);
    expect(errors({ konto: '100001' })).toEqual([
      expect.objectContaining({ code: 'E-EXTF-ACCOUNT', field: 'konto', value: '100001' }),
    ]);
  });

  it('rejects a short account instead of padding it', () => {
    const findings = errors({ konto: '1360', gegenkonto: '83000' }, octoberHeader({ sachkontenlaenge: 5 }));
    expect(findings).toEqual([
      expect.objectContaining({
        code: 'E-EXTF-ACCOUNT',
        index: 0,
        field: 'konto',
        message: expect.stringMatching(/exactly 5 digits \(G\/L account\) or 6 digits \(personal account\).*never padded/),
      }),
    ]);
  });

  it.each(['13a0', '', ' 1360', '-136', '0000'])('rejects gegenkonto "%s"', (gegenkonto) => {
    expect(errors({ gegenkonto })).toEqual([expect.objectContaining({ code: 'E-EXTF-ACCOUNT', field: 'gegenkonto' })]);
  });

  it('rejects identical Konto and Gegenkonto', () => {
    expect(errors({ konto: '8300', gegenkonto: '8300' })).toEqual([expect.objectContaining({ code: 'E-EXTF-SAME-ACCOUNT' })]);
  });

  it('accepts BU keys of one to four digits and rejects others', () => {
    for (const buKey of ['3', '9', '40', '501', '6501']) expect(errors({ buKey }), buKey).toEqual([]);
    for (const buKey of ['12345', 'A', '3 ', '-3']) {
      expect(errors({ buKey }), buKey).toEqual([expect.objectContaining({ code: 'E-EXTF-BU-KEY', value: buKey })]);
    }
  });

  it('accepts Belegdatum on the first and last day and rejects dates outside the period', () => {
    expect(errors({ belegdatum: '2026-10-01' })).toEqual([]);
    expect(errors({ belegdatum: '2026-10-31' })).toEqual([]);
    expect(errors({ belegdatum: '2026-11-01' })).toEqual([expect.objectContaining({ code: 'E-EXTF-BELEGDATUM' })]);
    expect(errors({ belegdatum: '2026-09-30' })).toEqual([expect.objectContaining({ code: 'E-EXTF-BELEGDATUM' })]);
    expect(errors({ belegdatum: '2026-10-32' as ExtfBooking['belegdatum'] })).toEqual([
      expect.objectContaining({ code: 'E-EXTF-BELEGDATUM', message: expect.stringContaining('valid date') }),
    ]);
  });

  it('lists the findings of several bookings with their indexes', () => {
    const bookings = Array.from({ length: 9 }, () => booking());
    bookings[3] = booking({ amountCents: 0 });
    bookings[7] = booking({ belegdatum: '2026-11-15' });
    const findings = validateBookings(octoberHeader(), bookings);
    expect(findings.map((f) => [f.index, f.code])).toEqual([
      [3, 'E-EXTF-AMOUNT'],
      [7, 'E-EXTF-BELEGDATUM'],
    ]);
  });
});
