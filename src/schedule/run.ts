import { join, resolve } from 'node:path';
import type { CommandContext } from '../cli/context.js';
import type { LoadedConfig } from '../core/config.js';
import type { LocalDate } from '../core/date.js';
import { UserError } from '../core/errors.js';
import type { Finding } from '../core/findings.js';
import type { SourceAdapter } from '../core/source.js';
import {
  exportedFile,
  fileSystemFinding,
  isSystemError,
  monthFolder,
  notFinalFinding,
  runExport,
  splitPeriod,
  type PartOutcome,
  type PeriodPart,
} from '../export/index.js';
import { duePeriods } from './due.js';

/** What `schedule --once` did with one property and period. */
export type ScheduleStatus = 'written' | 'already exported' | 'no bookings' | 'not yet final' | 'failed';

export interface ScheduleOutcome {
  propertyId: string;
  part: PeriodPart;
  status: ScheduleStatus;
  findings: Finding[];
  /** The EXTF file that was written or already exists. */
  path?: string;
}

export interface ScheduleResult {
  today: LocalDate;
  outcomes: ScheduleOutcome[];
}

export interface ScheduleDeps {
  loaded: LoadedConfig;
  ctx: CommandContext;
  /** Builds the source on first use, so a run with nothing to fetch never touches apaleo. */
  source: () => SourceAdapter;
  /**
   * Called with each outcome as soon as it is known, in the order of the result,
   * so the lines for the files already written are printed even when a later
   * step stops the run with an unexpected error.
   */
  onOutcome?: (outcome: ScheduleOutcome) => void;
}

/**
 * Exports every due period (design decisions 2 to 4), oldest first, for every
 * configured property. A property-period whose file is already in the output
 * folder is reported as `already exported` without any apaleo call; the rest
 * goes through the s06 export, which never writes over a changed file.
 *
 * A period that is not final yet is never written: apaleo can still add
 * postings for its last day until the night audit that closes the following
 * day, and once a file exists every later run would skip the period. Such a
 * period is reported as `not yet final` and exported by the first run after
 * `schedule.finalAfter` two days after its last day. The export applies the same
 * rule in each property's own time zone (`holdUntilFinal`).
 *
 * A file-system error in the output folder fails only its property-period
 * (`E-EXPORT` with the next step); the run goes on with the others.
 */
export async function runSchedule({ loaded, ctx, source, onOutcome }: ScheduleDeps): Promise<ScheduleResult> {
  const { schedule, datev, output, properties } = loaded.config;
  const { today, periods, waiting } = duePeriods(ctx.now(), schedule);
  const parts = periods.flatMap((period) => splitPeriod(period, datev.wjBeginn));
  const ids = properties.map((p) => p.id);
  const outputDir = resolve(ctx.cwd, output.dir);
  let adapter: SourceAdapter | undefined;
  const outcomes: ScheduleOutcome[] = [];
  const failed = (propertyId: string, part: PeriodPart, finding: Finding): ScheduleOutcome => ({ propertyId, part, status: 'failed', findings: [finding] });
  /** `already exported` when the manifest or a file on disk says so, without any apaleo call. */
  const exported = async (propertyId: string, part: PeriodPart): Promise<ScheduleOutcome | undefined> => {
    const folder = monthFolder(ctx.cwd, output.dir, propertyId, part.month);
    try {
      const file = await exportedFile(ctx, folder, part);
      return file ? { propertyId, part, status: 'already exported', findings: [], path: join(folder, file) } : undefined;
    } catch (error) {
      if (!isSystemError(error)) throw error;
      return failed(propertyId, part, fileSystemFinding(error, outputDir));
    }
  };

  for (const part of parts) {
    // Outcomes arrive out of order (the files on disk first), but are reported in the order of the properties.
    const byProperty = new Map<string, ScheduleOutcome>();
    let next = 0;
    const settle = (outcome: ScheduleOutcome) => {
      byProperty.set(outcome.propertyId, outcome);
      for (let ready = byProperty.get(ids[next] ?? ''); ready; ready = byProperty.get(ids[next] ?? '')) {
        next++;
        outcomes.push(ready);
        onOutcome?.(ready);
      }
    };
    const pending: string[] = [];
    for (const propertyId of ids) {
      const done = await exported(propertyId, part);
      if (done) settle(done);
      else pending.push(propertyId);
    }
    if (pending.length === 0) continue;
    try {
      adapter ??= source();
      const request = { period: part, propertyIds: pending, dryRun: false, overwrite: false, holdUntilFinal: { finalAfter: schedule.finalAfter } };
      await runExport(request, { loaded, source: adapter, ctx, onOutcome: (outcome) => settle(fromExport(outcome)) });
    } catch (error) {
      // apaleo unreachable, missing secret, ...: every pending property of the period that has no result yet failed.
      const finding: Finding | undefined =
        error instanceof UserError
          ? { code: 'E-EXPORT', message: error.message }
          : isSystemError(error)
            ? fileSystemFinding(error, outputDir)
            : undefined;
      if (!finding) throw error;
      for (const propertyId of pending) if (!byProperty.has(propertyId)) settle(failed(propertyId, part, finding));
    }
  }
  // Newest last, after the final periods; nothing is fetched for them.
  for (const part of waiting.flatMap((period) => splitPeriod(period, datev.wjBeginn))) {
    const findings = [notFinalFinding(part, schedule.timezone, schedule.finalAfter)];
    for (const propertyId of ids) {
      // A file written by hand with `export` still counts as exported.
      const outcome = (await exported(propertyId, part)) ?? { propertyId, part, status: 'not yet final', findings };
      outcomes.push(outcome);
      onOutcome?.(outcome);
    }
  }
  return { today, outcomes };
}

const STATUS: Readonly<Record<PartOutcome['status'], ScheduleStatus>> = {
  written: 'written',
  replaced: 'written',
  unchanged: 'already exported',
  // Not reached: the schedule never runs a dry run.
  checked: 'written',
  empty: 'no bookings',
  waiting: 'not yet final',
  failed: 'failed',
};

function fromExport({ propertyId, part, status, findings, path }: PartOutcome): ScheduleOutcome {
  return { propertyId, part, status: STATUS[status], findings, ...(path && status !== 'failed' ? { path } : {}) };
}
