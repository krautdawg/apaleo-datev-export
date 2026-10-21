import { UsageError } from '../../core/errors.js';
import { formatFinding } from '../../core/findings.js';
import { demoRun } from '../../demo/index.js';
import { DEMO_NOTICE, parseExportPeriod, runExport, type PartOutcome, type PartStatus } from '../../export/index.js';
import { CONFIG_OPTION, EXIT_FAILURE, EXIT_OK, stringOption, type Command, type OptionValues } from '../command.js';
import type { CommandContext } from '../context.js';
import { displayPath } from '../files.js';
import { createSource, loadCommandConfig } from '../source.js';

export const exportCommand: Command = {
  name: 'export',
  summary: 'Write the DATEV Buchungsstapel files of a month or period, one per property and month, after every check',
  usage: '--month YYYY-MM | --from YYYY-MM-DD --to YYYY-MM-DD [--property <id>] [--dry-run] [--overwrite] [--demo] [--config <path>]',
  options: {
    month: { type: 'string', valueName: '<YYYY-MM>', description: 'Export one calendar month' },
    from: { type: 'string', valueName: '<YYYY-MM-DD>', description: 'First business day of the period' },
    to: { type: 'string', valueName: '<YYYY-MM-DD>', description: 'Last business day of the period (inclusive)' },
    property: {
      type: 'string',
      multiple: true,
      valueName: '<id>',
      description: 'apaleo property id, can be repeated (default: every property in the config)',
    },
    'dry-run': { type: 'boolean', description: 'Run every check and print the summary, but write nothing' },
    overwrite: {
      type: 'boolean',
      description: 'Replace a file whose bookings changed; the old file is kept as .replaced-<timestamp>.csv',
    },
    demo: {
      type: 'boolean',
      description: 'Run on the bundled demo data (fabricated Hotel Beispiel, September 2026): no config, no apaleo, files only in ./demo-output/',
    },
    ...CONFIG_OPTION,
  },
  async run(args, cliCtx) {
    const { values } = args;
    const period = parseExportPeriod({
      month: stringOption(values, 'month'),
      from: stringOption(values, 'from'),
      to: stringOption(values, 'to'),
    });
    const demo = values.demo === true;
    if (demo && values.config !== undefined) throw new UsageError('--demo brings its own config; leave out --config.');
    // The demo swaps in its own config, clock and recorded source.
    const { loaded, ctx } = demo ? await demoRun(cliCtx) : { loaded: await loadCommandConfig(values, cliCtx), ctx: cliCtx };
    if (demo) ctx.stdout.write(`${DEMO_NOTICE}\n\n`);
    const propertyIds = propertyFlags(values);
    const ids = [...new Set(propertyIds.length > 0 ? propertyIds : loaded.config.properties.map((p) => p.id))];
    if (ids.length === 0) {
      throw new UsageError('No property to export: list the properties in the config (properties:) or pass --property <id>.');
    }
    const dryRun = values['dry-run'] === true;
    const outcomes = await runExport(
      { period, propertyIds: ids, dryRun, overwrite: values.overwrite === true, demo },
      { loaded, source: createSource(loaded, ctx), ctx },
    );
    for (const outcome of outcomes) report(ctx, outcome, dryRun);
    ctx.stdout.write(`${demo ? 'DEMO ' : ''}${resultLine(outcomes, dryRun)}\n`);
    return outcomes.some((o) => o.status === 'failed') ? EXIT_FAILURE : EXIT_OK;
  },
};

function propertyFlags(values: OptionValues): string[] {
  const value = values.property;
  return (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string');
}

const PLAN_TEXT: Readonly<Record<string, string>> = {
  write: 'a real run writes',
  unchanged: 'a real run leaves unchanged',
  replace: 'a real run replaces (--overwrite)',
};

function report(ctx: CommandContext, outcome: PartOutcome, dryRun: boolean): void {
  const { propertyId, part, status } = outcome;
  const file = outcome.path ? displayPath(ctx.cwd, outcome.path) : undefined;
  const head = `${propertyId} ${part.month} (${part.from} to ${part.to})`;
  if (dryRun) {
    ctx.stdout.write(`${head}: dry run, ${status === 'failed' ? 'blocked' : 'no blocking finding'}\n\n${outcome.summary}`);
    if (file && outcome.plan) ctx.stdout.write(`File: ${PLAN_TEXT[outcome.plan]} ${file}\n`);
    ctx.stdout.write('\n');
    return;
  }
  const what: Record<PartStatus, string> = {
    written: `written ${file} (${outcome.bookings} bookings)`,
    replaced: `written ${file} (${outcome.bookings} bookings); the previous file was kept as .replaced-*.csv`,
    unchanged: `unchanged ${file} (same bookings as the existing file, nothing written)`,
    checked: 'checked',
    empty: 'no bookings, no file',
    // Not reached: only the scheduler holds back a period that ends yesterday.
    waiting: 'not yet final, no file written',
    failed: 'failed, no file written',
  };
  ctx.stdout.write(`${head}: ${what[status]}\n`);
  for (const finding of outcome.findings) ctx.stdout.write(`  ${formatFinding(finding)}\n`);
}

function resultLine(outcomes: readonly PartOutcome[], dryRun: boolean): string {
  const count = (status: PartStatus) => outcomes.filter((o) => o.status === status).length;
  const failed = count('failed');
  if (dryRun) {
    const empty = count('empty');
    const withoutBookings = empty > 0 ? ` ${empty} without bookings.` : '';
    return failed === 0
      ? `Result: dry run, nothing written; ${outcomes.length - empty} file(s) passed every check.${withoutBookings}`
      : `Result: dry run, nothing written; ${failed} of ${outcomes.length} blocked. Fix the E- findings above and run again.`;
  }
  const parts = [`${count('written') + count('replaced')} written`, `${count('unchanged')} unchanged`];
  if (count('empty') > 0) parts.push(`${count('empty')} without bookings`);
  parts.push(`${failed} failed`);
  return `Result: ${parts.join(', ')}.${failed > 0 ? ' Fix the E- findings above and run again.' : ''}`;
}
