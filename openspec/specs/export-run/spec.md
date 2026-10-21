# export-run Specification

## Purpose
The `export` command that turns one period of a property's apaleo ledger into DATEV Buchungsstapel files: period parsing and the split per month and fiscal year, the date rules that stand in for the night-audit status, the blocking coverage, posting and plausibility checks, the dry run, the output folder with protocol and manifest, and idempotent re-runs.
## Requirements
### Requirement: Export command
The CLI SHALL provide `apaleo-datev export` taking either `--from <date> --to <date>` (inclusive business dates) or `--month <YYYY-MM>`, an optional `--property <id>` (default: every configured property), and the flags `--dry-run` and `--overwrite`. It SHALL exit with code 0 when every property and month succeeded and 1 when any failed.

#### Scenario: Monthly export
- **WHEN** the user runs `apaleo-datev export --month 2026-10 --property BSP` with a complete mapping
- **THEN** one EXTF file for 2026-10-01 to 2026-10-31 is written for BSP and the exit code is 0

#### Scenario: Missing period
- **WHEN** the user runs `apaleo-datev export` without a period
- **THEN** the CLI exits with code 2 and explains `--month` and `--from/--to`

### Requirement: Period rules
The export SHALL split a period at calendar-month boundaries into one file per property and month, SHALL refuse a period that contains today or a later date in the property's time zone with `E-DAY-NOT-CLOSED`, and SHALL warn with `W-RECENT-DAY` when the period ends yesterday.

#### Scenario: Range across two months
- **WHEN** the user exports 2026-09-25 to 2026-10-05
- **THEN** two files are produced, 2026-09-25 to 2026-09-30 and 2026-10-01 to 2026-10-05

#### Scenario: Fiscal year not starting in January
- **WHEN** `datev.wjBeginn` is `07-01` and the user exports `--month 2027-03`
- **THEN** the header's WJ-Beginn is `20260701` and the file is written

#### Scenario: Today included
- **WHEN** the period ends on today's date in the property time zone, with today taken from the injected clock `ctx.now()`
- **THEN** no file is written and the error says the day is not closed by the night audit yet

### Requirement: Blocking checks before writing
For each property and month the export SHALL run the mapping coverage check, the posting rules and the plausibility checks before writing, and SHALL NOT write a file when any error finding exists. Errors SHALL be printed with code, explanation and the fix, and other property-months SHALL still be processed.

#### Scenario: Unmapped account blocks only its property
- **WHEN** property BSP has an unmapped booked account and property BSP2 is fully mapped
- **THEN** no file is written for BSP, the file for BSP2 is written, `E-UNMAPPED` is printed for BSP, and the exit code is 1

### Requirement: EUR only
The export SHALL refuse with `E-CURRENCY`, per property-month and before writing, a property whose currency is not EUR and a month with any ledger line whose currency is not EUR, because the EXTF writer labels every amount as EUR and does not convert.

#### Scenario: Swiss property
- **WHEN** the property's currency is CHF
- **THEN** `E-CURRENCY` names the currency, the ledger is not read and no file is written for that property

### Requirement: Plausibility checks
The export SHALL verify that the absolute gross of all ledger lines equals the sum over booked and skipped lines, that per business day the signed movement of each DATEV account in the bookings equals the signed apaleo movement of the booked lines mapped to it, and that the VAT DATEV will compute per rate matches apaleo's tax totals within the rounding total of that rate (one cent per `W-VAT-ROUNDING` at that rate, never the roundings of another rate); violations SHALL be errors. When `checks.aggregates` is true (default false), it SHALL call apaleo's daily aggregates once per business day, compare them with the ledger lines rolled up to their main accounts, and report differences as warnings.

#### Scenario: Roundings at another rate
- **WHEN** the posting run reported two `W-VAT-ROUNDING` differences at 7 % and the bookings at 19 % compute two cents more VAT than apaleo charged
- **THEN** error `E-VAT-TOTAL` is reported for 19 % and no file is written

#### Scenario: Side bug is caught
- **WHEN** a defect writes a booking with side `S` where the apaleo line credits the Konto account
- **THEN** error `E-ACCOUNT-BALANCE` names the day, the DATEV account and both signed amounts, and no file is written

#### Scenario: Aggregate check off by default
- **WHEN** `checks.aggregates` is not set
- **THEN** no aggregate request is sent and the custom app does not need `core.subledger_aggregate.create`

#### Scenario: Aggregate difference
- **WHEN** `checks.aggregates` is true and apaleo's daily aggregate for a main account differs from the rolled-up ledger lines of that day
- **THEN** warning `W-AGGREGATE-DIFF` names the day, the account and both amounts, and the file is still written

#### Scenario: Conservation violated
- **WHEN** a defect causes a ledger line to be neither booked nor listed as skipped
- **THEN** error `E-CONSERVATION` is raised and no file is written

### Requirement: Dry run
With `--dry-run` the export SHALL run every step except writing, SHALL print the posting summary (totals per DATEV account, revenue and VAT per rate, city tax, payments per clearing account, deposits, skipped lines, findings), and SHALL exit with code 1 if any error finding exists.

#### Scenario: Review before the first file
- **WHEN** the user runs `export --month 2026-10 --property BSP --dry-run`
- **THEN** the summary is printed and no file or folder is created

### Requirement: Output layout and manifest
The export SHALL write each file to `<output.dir>/<propertyId>/<YYYY-MM>/` with the deterministic name `EXTF_Buchungsstapel_<Berater>_<Mandant>_<from>-<to>_<propertyId>.csv`, SHALL write a protocol text file beside it, and SHALL record in `manifest.json` the file name, SHA-256 of the file, SHA-256 of the body without the header line, booking count, Soll and Haben totals, mapping file SHA-256, tool version and creation time.

#### Scenario: Files after a run
- **WHEN** a monthly export for BSP 2026-10 succeeds
- **THEN** the folder `exports/BSP/2026-10/` contains the EXTF file, its protocol and a manifest entry with both hashes

### Requirement: Idempotent re-runs
Re-running an export for a period whose file exists SHALL do nothing when the file is unchanged apart from header field 6 (Erzeugt am), SHALL refuse with `E-FILE-EXISTS` when the bookings or any other header field (for example WJ-Beginn, Festschreibung or Sachkontenrahmen) changed, and with `--overwrite` SHALL keep the old file under a `.replaced-<timestamp>.csv` name, write the new one and record both in the manifest. The comparison SHALL read the existing file, so it works without the manifest. When the file is unchanged but its protocol or current manifest entry is missing or describes another file (a run interrupted between writing the file and its companions), the run SHALL rewrite them and report `N-COMPANIONS-REPAIRED`. Writing SHALL hold an exclusive lock file in the property-month folder and SHALL re-check the file on disk under that lock, so two concurrent runs never both write or replace the same file; the run that finds the lock or a changed file SHALL fail that property-month with `E-EXPORT` and write nothing. An export whose period overlaps another EXTF file in the same folder SHALL be refused with `E-PERIOD-OVERLAP`, because importing both would book the shared days twice.

#### Scenario: Unchanged re-run
- **WHEN** the same month is exported twice with unchanged apaleo data and mapping
- **THEN** the second run reports `unchanged`, rewrites nothing and exits 0

#### Scenario: Late posting changed the month
- **WHEN** a late posting changed the month after it was exported
- **THEN** the second run refuses with `E-FILE-EXISTS`, explains that the Kanzlei must remove the imported batch first, and suggests `--overwrite`

#### Scenario: Manifest deleted
- **WHEN** `manifest.json` was deleted and the same month is exported again with unchanged data
- **THEN** the run reports `unchanged` by comparing the existing file without its creation time, leaves the EXTF file untouched and writes the missing manifest entry again (`N-COMPANIONS-REPAIRED`)

#### Scenario: Config changed the header
- **WHEN** the month was exported and `datev.wjBeginn` was changed before the same month is exported again with unchanged data
- **THEN** the run refuses with `E-FILE-EXISTS` and keeps the old file, and with `--overwrite` it replaces the file and the new header carries the new WJ-Beginn

#### Scenario: Overlapping period
- **WHEN** the folder holds the file for 2026-09-01 to 2026-09-30 and the user exports 2026-09-20 to 2026-09-30
- **THEN** the export refuses with `E-PERIOD-OVERLAP`, names the existing file and writes nothing

