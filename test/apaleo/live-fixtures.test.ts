import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LIVE_DAY, createFixtureSource, fixturePath } from '../helpers/apaleo.js';
import { isAllowedAccountName, scanFolder, scanJson } from '../helpers/fixture-scan.js';

describe('live recordings (test/fixtures/apaleo/live)', () => {
  it('pass the privacy scan: no credentials, e-mail addresses or guest names', () => {
    const { files, problems } = scanFolder(fileURLToPath(fixturePath('live/')));
    expect(problems).toEqual([]);
    expect(files).toBe(10);
  });

  it('the scan rejects credentials, e-mail addresses and names that are not apaleo defaults', () => {
    const recording = {
      body: { access_token: 'x' },
      headers: { authorization: 'Bearer abc' },
      contact: 'hans.mueller@example.com',
      account: { name: 'Müller, Hans', number: 'BER-1' },
      ok: { name: 'Liabilities for Reservation EPEBVUIU-1 (7%)' },
    };
    expect(scanJson(recording)).toEqual([
      '$.body.access_token: key looks like a credential',
      '$.headers.authorization: key looks like a credential',
      '$.headers.authorization: value looks like a credential',
      '$.contact: value looks like an e-mail address',
      '$.account.name: "Müller, Hans" is neither an apaleo default name nor a per-reservation or per-folio name',
    ]);
  });

  it.each([
    'Revenues Accommodation (7%)',
    'Revenues Cancellation fees (no VAT)',
    'VAT Very Reduced (10%)',
    'Receivables for Folio BER-EXT-1 (Offset)',
    'AccountsReceivable for Reservation ZAQSEFYC-1',
    'Visa Debit Card Payment',
  ])('accepts the apaleo name %s', (name) => {
    expect(isAllowedAccountName(name)).toBe(true);
  });

  it('reads the BER ledger of 2026-10-21 through the adapter, eight-decimal net and tax amounts included', async () => {
    const { source } = createFixtureSource({ live: true });
    const lines = await source.getLedger('BER', LIVE_DAY, '2026-10-22');
    expect(lines).toHaveLength(35);
    const line = lines.find((l) => l.sourceEntryNumber === '000000032');
    expect(line).toMatchObject({ grossCents: 1490, netPrecise: '12.5210084', netCents: 1252 });
    expect(line?.taxes).toEqual([{ vatType: 'Normal', percent: 19, amountPrecise: '2.3789916', amountCents: 238 }]);
  });
});
