# src/schedule

`schedule --once`: works out which periods are due and runs the s06 export for them, then exits. There is no timer in the tool; cron, a systemd timer or the compose loop calls it (see `docs/docker.md`).

- `due.ts` computes the due periods as a pure function of `ctx.now()` and the `schedule` config: daily (`d <= today - offsetDays`) or monthly (from `dayOfMonth` of the next month), within the last `catchUpDays` days, "today" taken in `schedule.timezone`. A due period that is not final yet (`lastFinalDay` in `src/export/period.ts`: a period ending on D is final from `schedule.finalAfter` on D+2, after the night audit that closes D+1) is listed as `waiting`: apaleo can still add postings for its last day, and a file once written would make every later run skip the period.
- `run.ts` skips every property-period whose file is already in the output folder (manifest entry or file on disk) without any apaleo call, and exports the rest oldest first.
- `run.ts` reports waiting periods as `not yet final` without any apaleo call, and passes `holdUntilFinal` to the export so a period that is not final yet in the property's own time zone is held back too. It hands each outcome to `onOutcome` as soon as it is known (the CLI prints it at once), and turns a file-system error in the output folder into `E-EXPORT` for that property-period with the next step.

All I/O, clock reads and network calls go through the injected `CommandContext` (enforced by lint).
