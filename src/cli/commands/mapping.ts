import { ChartIndex } from '../../core/chart.js';
import { nextDay } from '../../core/date.js';
import { UsageError } from '../../core/errors.js';
import { formatFinding, isErrorFinding, type Finding } from '../../core/findings.js';
import { VAT_ACCOUNT_TYPES, checkCoverage, checkMapping, loadMapping, type Mapping } from '../../mapping/index.js';
import { parseRangeFlags } from '../../export/period.js';
import { releaseRateOf } from '../../posting/index.js';
import { CONFIG_OPTION, EXIT_FAILURE, EXIT_OK, stringOption, type Command } from '../command.js';
import type { CommandContext } from '../context.js';
import { SKR_OPTION, defaultProperty, mappingPath, parseSkr } from '../mapping-file.js';
import { createSource, loadCommandConfig } from '../source.js';
import { formatTable } from '../table.js';

export const mapping: Command = {
  name: 'mapping',
  summary: 'Check a mapping CSV ("mapping check"), and with --from/--to that every account booked in the period is mapped',
  usage: 'check [--property <id>] [--mapping <file>] [--from YYYY-MM-DD --to YYYY-MM-DD] [--skr 03|04] [--config <path>]',
  allowPositionals: true,
  options: {
    property: { type: 'string', valueName: '<id>', description: 'apaleo property id (default: the only one in the config)' },
    mapping: { type: 'string', valueName: '<file>', description: 'Mapping file (default: properties[].mapping or ./mapping-<id>.csv)' },
    from: { type: 'string', valueName: '<YYYY-MM-DD>', description: 'First business day of the period to check against apaleo' },
    to: { type: 'string', valueName: '<YYYY-MM-DD>', description: 'Last business day of the period (inclusive)' },
    ...SKR_OPTION,
    ...CONFIG_OPTION,
  },
  async run(args, ctx) {
    const [subcommand, ...extra] = args.positionals;
    if (subcommand !== 'check' || extra.length > 0) {
      throw new UsageError(`Usage: apaleo-datev mapping ${mapping.usage}`);
    }
    const period = parseRangeFlags(stringOption(args.values, 'from'), stringOption(args.values, 'to'));
    const skr = parseSkr(stringOption(args.values, 'skr'));
    const loaded = await loadCommandConfig(args.values, ctx);
    const sachkontenlaenge = loaded.config.datev.sachkontenlaenge;
    const propertyId = defaultProperty(loaded, stringOption(args.values, 'property'));
    if (period && !propertyId) throw new UsageError('Checking a period needs --property <id>.');
    const path = mappingPath(loaded, propertyId, stringOption(args.values, 'mapping'), ctx.cwd);

    const loadedMapping = await loadMapping(path, { sachkontenlaenge, readFile: (p) => ctx.fs.readFile(p) });
    const findings: Finding[] = [...loadedMapping.findings, ...checkMapping(loadedMapping, { sachkontenlaenge, skr })];
    ctx.stdout.write(`Mapping file: ${path} (${describeMapping(loadedMapping, skr)})\n`);
    ctx.stdout.write(summaryByType(loadedMapping));

    if (period && propertyId) {
      const source = createSource(loaded, ctx);
      const [accounts, lines] = await Promise.all([
        source.getChartOfAccounts(propertyId),
        source.getLedger(propertyId, period.from, nextDay(period.to)),
      ]);
      const chart = new ChartIndex(accounts);
      const coverage = checkCoverage(loadedMapping, lines, chart, { rateOf: releaseRateOf(lines, chart), sachkontenlaenge, skr });
      findings.push(...coverage);
      ctx.stdout.write(`Checked ${lines.length} ledger lines of ${propertyId} from ${period.from} to ${period.to}: ${coverageSummary(coverage)}.\n`);
    }
    return report(ctx, findings);
  },
};

function coverageSummary(coverage: readonly Finding[]): string {
  const count = (code: string) => coverage.filter((finding) => finding.code === code).length;
  const unmapped = count('E-UNMAPPED');
  const mismatched = count('E-VAT-MISMATCH');
  const parts = [unmapped === 0 ? 'every booked account is mapped' : `${unmapped} unmapped account(s)`];
  if (mismatched > 0) parts.push(`${mismatched} account(s) with the wrong VAT rate`);
  if (count('E-VAT-RATE-UNKNOWN') > 0) parts.push('deposit releases without a known VAT rate');
  return parts.join(', ');
}

function describeMapping(mapping: Mapping, skr: string | undefined): string {
  const layout = mapping.layout === 'grman' ? 'Grman export layout' : 'apaleo-datev layout';
  const chart = skr ?? mapping.skr;
  return `${layout}, ${mapping.rows.length} rows${chart ? `, SKR ${chart}` : ''}`;
}

function summaryByType(mapping: Mapping): string {
  const byType = new Map<string, { rows: number; mapped: number }>();
  for (const row of mapping.rows) {
    const entry = byType.get(row.apaleoType) ?? { rows: 0, mapped: 0 };
    entry.rows += 1;
    if (row.datevAccount !== '') entry.mapped += 1;
    byType.set(row.apaleoType, entry);
  }
  const rows = [...byType].map(([type, { rows: count, mapped }]) => [
    type,
    String(count),
    String(mapped),
    VAT_ACCOUNT_TYPES.has(type) ? 'not needed' : String(count - mapped),
  ]);
  return formatTable([['type', 'rows', 'mapped', 'unmapped'], ...rows], [1, 2], '  ');
}

function report(ctx: CommandContext, findings: readonly Finding[]): number {
  for (const finding of findings) ctx.stdout.write(`${formatFinding(finding)}\n`);
  const errors = findings.filter(isErrorFinding).length;
  const warnings = findings.filter((f) => f.code.startsWith('W-')).length;
  ctx.stdout.write(
    errors === 0
      ? `Result: mapping OK${warnings > 0 ? ` (${warnings} warning${warnings === 1 ? '' : 's'})` : ''}.\n`
      : `Result: ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}. Fix the rows above and run again.\n`,
  );
  return errors === 0 ? EXIT_OK : EXIT_FAILURE;
}
