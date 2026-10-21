import { endOfMonth, localDateTimeIn } from '../../core/date.js';
import { UsageError } from '../../core/errors.js';
import { formatFinding, isErrorFinding } from '../../core/findings.js';
import type { PeriodPart } from '../../export/index.js';
import { runSchedule, type ScheduleOutcome } from '../../schedule/index.js';
import { CONFIG_OPTION, EXIT_FAILURE, EXIT_OK, type Command } from '../command.js';
import type { CommandContext } from '../context.js';
import { displayPath } from '../files.js';
import { createSource, loadCommandConfig } from '../source.js';

export const ONCE_HINT =
  'schedule has no built-in timer: use "apaleo-datev schedule --once" from cron or the compose loop (see docs/docker.md).';

export const schedule: Command = {
  name: 'schedule',
  summary: 'Export every period that is due by the schedule settings and not yet in the output folder, then exit (run it from cron)',
  usage: '--once [--config <path>]',
  options: {
    once: { type: 'boolean', description: 'Export what is due now and exit (required: there is no long-running mode)' },
    ...CONFIG_OPTION,
  },
  async run(args, ctx) {
    if (args.values.once !== true) throw new UsageError(ONCE_HINT);
    const loaded = await loadCommandConfig(args.values, ctx);
    if (loaded.config.properties.length === 0) {
      throw new UsageError('No property to export: list the properties in the config (properties:).');
    }
    const { timezone, cadence } = loaded.config.schedule;
    const stamp = () => localDateTimeIn(ctx.now(), timezone);
    // Each line is written as soon as its property-period is done, so a run stopped halfway still shows what it wrote.
    const onOutcome = (outcome: ScheduleOutcome) => void ctx.stdout.write(`${stamp()} ${line(outcome, ctx)}\n`);
    const { today, outcomes } = await runSchedule({ loaded, ctx, source: () => createSource(loaded, ctx), onOutcome });
    if (outcomes.length === 0) ctx.stdout.write(`${stamp()} nothing due (cadence ${cadence}, today ${today} in ${timezone})\n`);
    return outcomes.some((o) => o.status === 'failed') ? EXIT_FAILURE : EXIT_OK;
  },
};

/**
 * `BSP 2026-10 written exports/BSP/2026-10/EXTF_...csv W-RECENT-DAY` or
 * `BSP 2026-10 failed E-UNMAPPED`: the result, the file and every finding code
 * (blocking ones first), with the findings indented below so cron mail and
 * `docker logs` show warnings and notes, not only errors.
 */
function line({ propertyId, part, status, findings, path }: ScheduleOutcome, ctx: CommandContext): string {
  const head = [propertyId, periodLabel(part), status, ...(path ? [displayPath(ctx.cwd, path)] : [])].join(' ');
  // N-NO-BOOKINGS only repeats the `no bookings` result.
  const shown = findings.filter((f) => f.code !== 'N-NO-BOOKINGS');
  const ordered = [...shown.filter(isErrorFinding), ...shown.filter((f) => !isErrorFinding(f))];
  const codes = [...new Set(ordered.map((f) => f.code))];
  return [[head, ...codes].join(' '), ...ordered.map((f) => `  ${formatFinding(f)}`)].join('\n');
}

/** `2026-10` for a whole month, `2026-10-18` for a day, else `2026-07-01..2026-07-14`. */
function periodLabel({ from, to, month }: PeriodPart): string {
  if (from === to) return from;
  if (from === `${month}-01` && to === endOfMonth(from)) return month;
  return `${from}..${to}`;
}
