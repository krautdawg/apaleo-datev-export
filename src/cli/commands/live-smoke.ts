import { compareAggregates, type AggregateComparison } from '../../core/aggregates.js';
import { ChartIndex } from '../../core/chart.js';
import { isLocalDate, localDateIn, nextDay, previousDay, type LocalDate } from '../../core/date.js';
import { UsageError } from '../../core/errors.js';
import { formatCents } from '../../core/money.js';
import type { AccountTotals, LedgerLine, SourceAccount, SourceProperty } from '../../core/source.js';
import { ApaleoPermissionError, createApaleoSource, type ApaleoSource } from '../../sources/apaleo/index.js';
import { answerLiveQuestions } from '../../sources/apaleo/live-questions.js';
import { CONFIG_OPTION, EXIT_FAILURE, EXIT_OK, stringOption, type Command } from '../command.js';
import type { OutputStream } from '../context.js';
import { loadCommandConfig } from '../source.js';
import { formatTable } from '../table.js';

/** Thrown after a failed step has been printed. */
class StepFailed extends Error {}

export const liveSmoke: Command = {
  name: 'live-smoke',
  summary: 'Read one business day from apaleo with real credentials and report what came back (writes nothing)',
  usage: '--property <id> [--date YYYY-MM-DD] [--config <path>]',
  options: {
    property: { type: 'string', valueName: '<id>', description: 'apaleo property id, for example BER' },
    date: { type: 'string', valueName: '<YYYY-MM-DD>', description: 'Business day (default: two days ago in the property time zone)' },
    ...CONFIG_OPTION,
  },
  async run(args, ctx) {
    const propertyId = stringOption(args.values, 'property');
    if (!propertyId) throw new UsageError('live-smoke needs --property <id>. Run "apaleo-datev properties" to list them.');
    const dateFlag = parseDateFlag(stringOption(args.values, 'date'));

    const source = createApaleoSource(await loadCommandConfig(args.values, ctx), ctx);
    const out = ctx.stdout;
    out.write(`apaleo live smoke test for property ${propertyId}. It reads only and writes no files.\n\n`);
    try {
      const { day, lines } = await runSteps(source, propertyId, dateFlag, ctx.now(), out);
      out.write(
        lines === 0
          ? `\nResult: passed, but ${day} has no bookings, so nothing about the postings was checked; ` +
              'run again with --date <a day with bookings>.\n'
          : `\nResult: every required step passed for business day ${day}.\n`,
      );
      return EXIT_OK;
    } catch (error) {
      if (!(error instanceof StepFailed)) throw error;
      out.write('\nResult: failed. Fix the step marked FAIL and run again.\n');
      return EXIT_FAILURE;
    }
  },
};

function parseDateFlag(value: string | undefined): LocalDate | undefined {
  if (value === undefined || isLocalDate(value)) return value;
  throw new UsageError(`--date must be a date written YYYY-MM-DD, got "${value}".`);
}

async function runSteps(
  source: ApaleoSource,
  propertyId: string,
  dateFlag: LocalDate | undefined,
  now: Date,
  out: OutputStream,
): Promise<{ day: LocalDate; lines: number }> {
  await step(out, 'login', () => source.authenticate(), () => 'access token received');
  const property = await step(out, 'property', () => findProperty(source, propertyId), describeProperty);
  const day = dateFlag ?? previousDay(previousDay(localDateIn(now, property.timeZone)));
  const accounts = await step(out, 'chart of accounts', () => source.getChartOfAccounts(propertyId), (a) => `${a.length} accounts`);
  out.write(countsByType(accounts));
  const lines = await step(
    out,
    'ledger',
    () => source.getLedger(propertyId, day, nextDay(day)),
    (l) => `${l.length} lines on ${day}`,
    (l) => (l.length === 0 ? `no lines on ${day}` : undefined),
  );
  out.write(totalsByType(lines));

  const chart = new ChartIndex(accounts);
  const comparison = await aggregateStep(source, propertyId, day, lines, chart, out);
  out.write(renderLiveAnswers(lines, chart, comparison));
  return { day, lines: lines.length };
}

/** Runs one step and prints `OK`, or `WARN` when `warn` gives a message for the value, or `FAIL`. */
async function step<T>(
  out: OutputStream,
  label: string,
  run: () => Promise<T>,
  describe: (value: T) => string,
  warn: (value: T) => string | undefined = () => undefined,
): Promise<T> {
  try {
    const value = await run();
    const warning = warn(value);
    out.write(warning === undefined ? `OK    ${label}: ${describe(value)}\n` : `WARN  ${label}: ${warning}\n`);
    return value;
  } catch (error) {
    out.write(`FAIL  ${label}: ${(error as Error).message}\n`);
    throw new StepFailed(label);
  }
}

async function findProperty(source: ApaleoSource, propertyId: string): Promise<SourceProperty> {
  const list = await source.listProperties();
  const property = list.find((p) => p.id === propertyId);
  if (property) return property;
  const available = list.map((p) => p.id).join(', ') || 'none';
  throw new Error(`property ${propertyId} is not visible to this custom app (visible: ${available}).`);
}

function describeProperty(p: SourceProperty): string {
  return `${p.id} ${p.name} (${p.timeZone}, ${p.currency})`;
}

/** The aggregate check is optional: a missing permission is reported, not fatal. */
async function aggregateStep(
  source: ApaleoSource,
  propertyId: string,
  day: LocalDate,
  lines: LedgerLine[],
  chart: ChartIndex,
  out: OutputStream,
): Promise<AggregateComparison[] | undefined> {
  let totals: AccountTotals;
  try {
    totals = await source.getAccountTotals(propertyId, day);
  } catch (error) {
    if (!(error instanceof ApaleoPermissionError)) {
      out.write(`FAIL  aggregates: ${(error as Error).message}\n`);
      throw new StepFailed('aggregates');
    }
    out.write('SKIP  aggregates: optional permission core.subledger_aggregate.create missing (not a failure)\n');
    return undefined;
  }
  const comparison = compareAggregates(totals, lines, chart);
  out.write(`OK    aggregates: ${totals.accounts.length} accounts\n`);
  const rows = comparison.map((c) => [
    c.account.number,
    c.account.type,
    c.basis,
    ...pair(c.source),
    formatCents(c.sourceBalanceCents),
    formatCents(c.ledgerBalanceCents),
    c.match ? 'yes' : 'NO',
  ]);
  const head = ['account', 'type', 'basis', 'apaleo debit', 'credit', 'balance', 'ledger balance', 'matches'];
  if (rows.length > 0) out.write(formatTable([head, ...rows], [3, 4, 5, 6], '        '));
  return comparison;
}

function pair(amounts: { debitCents: number; creditCents: number }): string[] {
  return [formatCents(amounts.debitCents), formatCents(amounts.creditCents)];
}

function countsByType(accounts: readonly SourceAccount[]): string {
  const counts = new Map<string, number>();
  for (const account of accounts) counts.set(account.type, (counts.get(account.type) ?? 0) + 1);
  const rows = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([type, count]) => [type, String(count)]);
  return formatTable(rows, [1], '        ');
}

function totalsByType(lines: readonly LedgerLine[]): string {
  if (lines.length === 0) return '';
  const totals = new Map<string, { debitCents: number; creditCents: number }>();
  const add = (type: string, side: 'debitCents' | 'creditCents', cents: number) => {
    const entry = totals.get(type) ?? { debitCents: 0, creditCents: 0 };
    entry[side] += cents;
    totals.set(type, entry);
  };
  for (const line of lines) {
    add(line.debit.type, 'debitCents', line.grossCents);
    add(line.credit.type, 'creditCents', line.grossCents);
  }
  const rows = [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([type, t]) => [type, ...pair(t)]);
  return formatTable([['type', 'debit (gross)', 'credit (gross)'], ...rows], [1, 2], '        ');
}

function renderLiveAnswers(lines: LedgerLine[], chart: ChartIndex, comparison: AggregateComparison[] | undefined): string {
  const a = answerLiveQuestions(lines, chart);
  const examples = a.outsideChart.examples.length > 0 ? ` (for example ${a.outsideChart.examples.join(', ')})` : '';
  const aggregates = comparison
    ? `${comparison.filter((c) => c.match).length} of ${comparison.length} accounts match`
    : 'not checked (permission missing)';
  const deposits = (kind: keyof typeof a.deposits) => {
    const { lines: count, withTaxes, withoutTaxes } = a.deposits[kind];
    return `${count} ${kind} (${withTaxes} with taxes[], ${withoutTaxes} without)`;
  };
  return [
    '',
    'Open questions about real apaleo data:',
    `  Accounts outside the chart: ${a.outsideChart.lines} lines use them; ${a.outsideChart.withParent} accounts with parentNumber, ${a.outsideChart.withoutParent} without${examples}`,
    `  Deposit lines by side and sign: ${deposits('received')}; ${deposits('released')}, of them ${deposits('refunded')}`,
    `  PostPrepaymentVat lines: ${a.prepaymentVatLines}; lines on VatOnLiabilities accounts: ${a.vatOnLiabilitiesLines}`,
    `  Tax entries with percent 0 and amount 0: ${a.zeroTaxEntries.zero} of ${a.zeroTaxEntries.total}`,
    `  Aggregates against the ledger by balance: ${aggregates}`,
    '',
  ].join('\n');
}
