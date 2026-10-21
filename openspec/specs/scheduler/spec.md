# scheduler Specification

## Purpose
The `schedule --once` command: which periods are due on the one configured cadence (monthly by default, or daily) in the configured time zone, catch-up of missed periods within `catchUpDays`, skipping periods whose file already exists without any apaleo call, and exiting with a status cron can act on. There is no in-process timer; cron or the compose loop calls it.
## Requirements
### Requirement: Daily and monthly cadences
`apaleo-datev schedule --once` SHALL compute due periods for all configured properties on exactly one cadence: `monthly` (default), where a calendar month is due from `dayOfMonth` (1–5, default 3) of the following month, or `daily`, where a single day `d` is due once `d <= today − offsetDays` (offset 1–3, default 2). "Today" SHALL be the date of `ctx.now()` in `schedule.timezone`. `catchUpDays` SHALL be at least 3 with `cadence: monthly` and at least 5 with `cadence: daily`, because a run can hold a period back as not yet final until four days after its last day and the period must then still be inside the window.

#### Scenario: Monthly run
- **WHEN** cadence is monthly, dayOfMonth 3, time zone Europe/Berlin, and `ctx.now()` is 2026-11-03T05:30:00Z (06:30 in Berlin)
- **THEN** the export for 2026-10-01 to 2026-10-31 runs for every configured property

#### Scenario: Monthly not yet due
- **WHEN** cadence is monthly, dayOfMonth 3, and `ctx.now()` is 2026-11-02 in Berlin
- **THEN** October is not due, nothing is exported, and the command exits 0

#### Scenario: Daily run
- **WHEN** cadence is daily with offsetDays 2 and `ctx.now()` is 2026-10-20 10:00 in the configured time zone
- **THEN** the export for 2026-10-18 runs

#### Scenario: Invalid offset
- **WHEN** the config sets `daily.offsetDays: 0`
- **THEN** config validation fails naming `schedule.daily.offsetDays` and the range 1–3

#### Scenario: Catch-up window too small
- **WHEN** the config sets `cadence: daily` and `catchUpDays: 4`, or `cadence: monthly` and `catchUpDays: 2`
- **THEN** config validation fails naming `schedule.catchUpDays` and the minimum

### Requirement: Periods wait until they are final
`schedule --once` SHALL NOT write a period that is not final yet, neither in `schedule.timezone` nor in the property's own time zone. apaleo can still post to a day D until the night audit that closes D+1, which runs after midnight on D+2, and a written file makes every later run skip the period. A period that ends on D SHALL count as final from `schedule.finalAfter` (local time `HH:MM`, "00:00" to "12:00", default "06:00") on D+2. A due period that is not final SHALL be reported as `not yet final` with the note `N-NOT-FINAL`, naming the time zone and the time from which it is final, without any apaleo ledger request, and SHALL be exported by the first run after that time. A period that is already exported SHALL be reported as `already exported` instead.

#### Scenario: Monthly day 1 just after midnight
- **WHEN** cadence is monthly, dayOfMonth 1, and `ctx.now()` is 2026-10-01 00:05 in Berlin
- **THEN** the line reads `BSP 2026-09 not yet final N-NOT-FINAL`, no file is written, no request is sent to apaleo, and the command exits 0

#### Scenario: Two days later, before the second night audit is done
- **WHEN** the same schedule runs at 2026-10-02 00:05 in Berlin
- **THEN** September is still reported as `not yet final` and no request is sent to apaleo

#### Scenario: Late posting by the second night audit
- **WHEN** after that run a posting dated 2026-09-30 is added and `schedule --once` runs at 2026-10-02 06:05 in Berlin
- **THEN** September is written and the file contains that posting

#### Scenario: Daily D-1
- **WHEN** cadence is daily with offsetDays 1 and `ctx.now()` is 2026-10-20 00:05 in Berlin
- **THEN** 2026-10-18 and 2026-10-19 are reported as `not yet final`, and 2026-10-19 is written by the run at 2026-10-21 06:05

#### Scenario: Property time zone behind the schedule time zone
- **WHEN** a period is final in `schedule.timezone` but not yet in the property's time zone
- **THEN** it is reported as `not yet final` with that time zone named and no ledger request is sent
- **AND** the next daily run, still inside the smallest allowed catch-up window, writes it

### Requirement: Catch-up and skipping existing periods
`schedule --once` SHALL run every due period within the last `catchUpDays` days, oldest first, and SHALL skip without any apaleo call each period whose file already exists in the output folder.

#### Scenario: Server was off for three days
- **WHEN** a daily schedule runs after three days offline with `catchUpDays: 40`
- **THEN** the three missed days are exported oldest first and the days already exported are reported as `already exported` without being fetched

#### Scenario: Called every hour
- **WHEN** `schedule --once` runs again an hour after it wrote the October file
- **THEN** no request is sent to apaleo and the command exits 0

### Requirement: Run once and exit
`apaleo-datev schedule --once` SHALL exit with code 0 if every due period succeeded, was already exported, had no bookings or is not yet final, and 1 if any failed, printing one line per property and period with the result and every finding code (`E-`, `W-` and `N-`, except `N-NO-BOOKINGS`, which the result already states), each finding printed indented below the line. Each line SHALL be printed as soon as its property and period are done. A file-system error in the output folder (for example `EACCES`) SHALL fail only that property and period with `E-EXPORT` and the next step (for a permission error the `chown` command for the container user), and the run SHALL go on with the others. Running `apaleo-datev schedule` without `--once` SHALL exit with code 2 and a hint to use `--once` from cron or the compose loop.

#### Scenario: External cron
- **WHEN** a system cron job calls `apaleo-datev schedule --once` daily
- **THEN** the due period is exported and the process exits

#### Scenario: Failed period
- **WHEN** a due period fails with `E-UNMAPPED`
- **THEN** the output line names the property, the period and `E-UNMAPPED`, and the exit code is 1

#### Scenario: Warning on a written period
- **WHEN** a due period is written with the warning `W-UNKNOWN-COLUMN`
- **THEN** the output line ends with `W-UNKNOWN-COLUMN`, the finding follows indented, and the exit code is 0

#### Scenario: Output folder not writable
- **WHEN** the output folder of one property cannot be written or read (`EACCES`)
- **THEN** that property's line reads `failed E-EXPORT` with the `chown` hint, the other properties are still exported and printed, and the exit code is 1

#### Scenario: Unexpected error halfway
- **WHEN** an unexpected error stops the run after a file was written
- **THEN** the line for that file has already been printed
