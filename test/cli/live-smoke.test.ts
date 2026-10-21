import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/run.js';
import { createApaleoContext, type FixtureServerOptions } from '../helpers/apaleo.js';

const failWith = (path: string, status: number): FixtureServerOptions => ({
  override: (_request, url) => (url.pathname.endsWith(path) ? new Response('{"messages":["no"]}', { status }) : undefined),
});

async function smoke(argv: string[], server: FixtureServerOptions = {}, now?: Date) {
  const ctx = createApaleoContext(server, now ? { now } : {});
  const code = await runCli(['live-smoke', ...argv], ctx);
  return { code, out: ctx.out(), err: ctx.err(), ctx };
}

describe('apaleo-datev live-smoke', () => {
  it('reports account counts, ledger lines and totals for the day and exits 0', async () => {
    const { code, out, ctx } = await smoke(['--property', 'BSP', '--date', '2026-09-14']);
    expect(code).toBe(0);
    expect(out).toContain('OK    login: access token received');
    expect(out).toContain('OK    property: BSP Hotel Beispiel (Europe/Berlin, EUR)');
    expect(out).toContain('OK    chart of accounts: 33 accounts');
    expect(out).toMatch(/^ {8}Revenues\s+12$/m);
    expect(out).toContain('OK    ledger: 6 lines on 2026-09-14');
    expect(out).toMatch(/^ {8}Payments\s+200\.00\s+0\.00$/m);
    expect(out).toMatch(/^ {8}Receivables\s+143\.80\s+0\.00$/m);
    expect(out).toMatch(/^ {8}Revenues\s+0\.00\s+138\.80$/m);
    expect(out).toContain('OK    aggregates: 10 accounts');
    expect(out).toMatch(/^ {8}account\s+type\s+basis\s+apaleo debit\s+credit\s+balance\s+ledger balance\s+matches$/m);
    expect(out).toMatch(/^ {8}5011\s+Revenues\s+net\s+0\.00\s+93\.46\s+-93\.46\s+-93\.46\s+yes$/m);
    expect(out).toMatch(/^ {8}1611\s+Payments\s+gross\s+200\.00\s+0\.00\s+200\.00\s+200\.00\s+yes$/m);
    expect(out).toContain('Result: every required step passed for business day 2026-09-14.');
    expect(readdirSync(ctx.cwd)).toEqual(['apaleo-datev.config.yaml']);
  });

  it('answers the open live questions', async () => {
    const day14 = (await smoke(['--property', 'BSP', '--date', '2026-09-14'])).out;
    expect(day14).toContain(
      'Accounts outside the chart: 6 lines use them; 0 accounts with parentNumber, 2 without (for example BSP-GHIJKL-1_Liabilities, BSP-ABCDEF-1_Receivables)',
    );
    expect(day14).toContain('Tax entries with percent 0 and amount 0: 1 of 6');
    expect(day14).toContain('Aggregates against the ledger by balance: 10 of 10 accounts match');
    expect(day14).toContain(
      'Deposit lines by side and sign: 1 received (1 with taxes[], 0 without); 0 released (0 with taxes[], 0 without), of them 0 refunded (0 with taxes[], 0 without)',
    );

    const day15 = (await smoke(['--property', 'BSP', '--date', '2026-09-15'])).out;
    expect(day15).toMatch(/1 accounts with parentNumber, 2 without/);
    expect(day15).toContain('PostPrepaymentVat lines: 1; lines on VatOnLiabilities accounts: 1');
    expect(day15).toMatch(/Aggregates against the ledger by balance: (\d+) of \1 accounts match/);

    const day21 = (await smoke(['--property', 'BSP', '--date', '2026-09-21'])).out;
    expect(day21).toContain('0 received (0 with taxes[], 0 without); 1 released (1 with taxes[], 0 without), of them 0 refunded');

    const day22 = (await smoke(['--property', 'BSP', '--date', '2026-09-22'])).out;
    expect(day22).toContain('0 received (0 with taxes[], 0 without); 1 released (0 with taxes[], 1 without), of them 0 refunded');
    expect(day22).toContain('PostPrepaymentVat lines: 1; lines on VatOnLiabilities accounts: 1');
    expect(day22).toContain('Aggregates against the ledger by balance: 5 of 5 accounts match');
  });

  it('warns about a business day without bookings instead of a plain pass, and still exits 0', async () => {
    // apaleo answers 204 for 2026-09-17.
    const { code, out } = await smoke(['--property', 'BSP', '--date', '2026-09-17']);
    expect(code).toBe(0);
    expect(out).toContain('WARN  ledger: no lines on 2026-09-17');
    expect(out).not.toContain('OK    ledger');
    expect(out).toContain(
      'Result: passed, but 2026-09-17 has no bookings, so nothing about the postings was checked; run again with --date <a day with bookings>.',
    );
    expect(out).not.toContain('every required step passed');
  });

  it('answers the questions on the recorded BER day 2026-10-21', async () => {
    const { code, out } = await smoke(['--property', 'BER', '--date', '2026-10-21'], { live: true });
    expect(code).toBe(0);
    expect(out).toContain('OK    ledger: 35 lines on 2026-10-21');
    expect(out).toContain('19 accounts with parentNumber, 0 without');
    // Received: five prepayments with taxes and the overpayment parked at 0 %; released: four with taxes and the 0 % refund.
    expect(out).toContain(
      'Deposit lines by side and sign: 6 received (5 with taxes[], 1 without); 5 released (4 with taxes[], 1 without), of them 1 refunded (0 with taxes[], 1 without)',
    );
    expect(out).toContain('PostPrepaymentVat lines: 0; lines on VatOnLiabilities accounts: 0');
    expect(out).toContain('Aggregates against the ledger by balance: 18 of 18 accounts match');
    expect(out).toMatch(/^ {8}Vat_Reduced:7\.00\s+Vat\s+tax\s+0\.00\s+37\.37\s+-37\.37\s+-37\.37\s+yes$/m);
    expect(out).toContain('Result: every required step passed for business day 2026-10-21.');
  });

  it('defaults to two days ago in the property time zone', async () => {
    // 23:30 UTC on 2026-09-22 is already 2026-09-23 in Berlin.
    const { code, out } = await smoke(['--property', 'BSP'], {}, new Date('2026-09-22T23:30:00Z'));
    expect(code).toBe(0);
    expect(out).toContain('OK    ledger: 2 lines on 2026-09-21');
  });

  it('reports a missing optional aggregate permission without failing', async () => {
    const { code, out } = await smoke(['--property', 'BSP', '--date', '2026-09-14'], failWith('/aggregate-daily', 403));
    expect(code).toBe(0);
    expect(out).toContain('SKIP  aggregates: optional permission core.subledger_aggregate.create missing (not a failure)');
    expect(out).toContain('Aggregates against the ledger by balance: not checked (permission missing)');
  });

  it('fails on other aggregate errors', async () => {
    const { code, out } = await smoke(['--property', 'BSP', '--date', '2026-09-14'], failWith('/aggregate-daily', 422));
    expect(code).toBe(1);
    expect(out).toContain('FAIL  aggregates: aggregate-daily for property BSP, business day 2026-09-14: apaleo answered HTTP 422');
    expect(out).toContain('Result: failed.');
  });

  it('fails a required step with the permission list on 403', async () => {
    const { code, out } = await smoke(['--property', 'BSP', '--date', '2026-09-14'], failWith('/export-gross-daily', 403));
    expect(code).toBe(1);
    expect(out).toContain('FAIL  ledger: apaleo refused export-gross-daily');
    expect(out).toContain('required: core.subledger_schema.read, core.subledger_export.create');
    expect(out).not.toContain('aggregates:');
  });

  it('fails when the property is not visible', async () => {
    const { code, out } = await smoke(['--property', 'MUC']);
    expect(code).toBe(1);
    expect(out).toContain('FAIL  property: property MUC is not visible to this custom app (visible: BSP, HBW).');
  });

  it('exits 1 before any network call when APALEO_CLIENT_SECRET is not set', async () => {
    const ctx = createApaleoContext({}, { env: {} });
    expect(await runCli(['live-smoke', '--property', 'BSP'], ctx)).toBe(1);
    expect(ctx.err()).toContain('APALEO_CLIENT_SECRET');
    expect(ctx.fetchCalls).toEqual([]);
  });

  it('exits 2 without --property or with an invalid --date', async () => {
    const missing = await smoke([]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain('live-smoke needs --property <id>');
    const badDate = await smoke(['--property', 'BSP', '--date', '2026-09-31']);
    expect(badDate.code).toBe(2);
    expect(badDate.err).toContain('--date must be a date written YYYY-MM-DD, got "2026-09-31"');
    expect(badDate.ctx.fetchCalls).toEqual([]);
  });
});
