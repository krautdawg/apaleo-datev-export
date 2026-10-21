## MODIFIED Requirements

### Requirement: Plausibility checks
The export SHALL verify that the absolute gross of all ledger lines equals the sum over booked and skipped lines, that per business day the signed movement of each DATEV account in the bookings equals the signed apaleo movement of the booked lines mapped to it, and that the VAT DATEV will compute per rate equals the sum of apaleo's per-line tax rounded to cents within the rounding total of that rate (one cent per `W-VAT-ROUNDING` at that rate, never the roundings of another rate); violations SHALL be errors. The `E-VAT-TOTAL` message SHALL also name apaleo's precise VAT total of the rate and the line-rounding difference; the difference between DATEV's per-line VAT and apaleo's precise total SHALL never be an error by itself. When `checks.aggregates` is true (default false), it SHALL call apaleo's daily aggregates once per business day and compare each listed account's balance (debit minus credit) with the signed sum of that day's ledger lines: a side on a global chart account counts for that account, any other side for its main account; Revenues and Liabilities sides count with their precise net amount, all other types with their gross amount; each tax of a line with a Revenues side counts for the chart's `Vat` account of that VAT type and rate, and of a line with a Liabilities side for the `VatOnLiabilities` account, signed like that side; both balances are rounded to cents only for the comparison. A difference SHALL be reported as a warning.

#### Scenario: Roundings at another rate
- **WHEN** the posting run reported two `W-VAT-ROUNDING` differences at 7 % and the bookings at 19 % compute two cents more VAT than apaleo charged
- **THEN** error `E-VAT-TOTAL` is reported for 19 % and no file is written

#### Scenario: Line rounding is not an error
- **WHEN** the recorded BER day 2026-10-21 is exported, where DATEV computes 37.38 VAT on the 7 % revenue lines and apaleo's precise total is 37.3695327
- **THEN** no `E-VAT-TOTAL` is raised, and the protocol shows both amounts and the difference 0.01

#### Scenario: Side bug is caught
- **WHEN** a defect writes a booking with side `S` where the apaleo line credits the Konto account
- **THEN** error `E-ACCOUNT-BALANCE` names the day, the DATEV account and both signed amounts, and no file is written

#### Scenario: Aggregate check off by default
- **WHEN** `checks.aggregates` is not set
- **THEN** no aggregate request is sent and the custom app does not need `core.subledger_aggregate.create`

#### Scenario: Aggregate difference
- **WHEN** `checks.aggregates` is true and apaleo's daily balance for an account differs from the ledger lines of that day
- **THEN** warning `W-AGGREGATE-DIFF` names the day, the account, both balances and the basis (gross, net or tax), and the file is still written

#### Scenario: Normal real day has no aggregate warning
- **WHEN** `checks.aggregates` is true and the recorded BER or VIE responses of 2026-10-21 or 2026-10-22 are checked
- **THEN** every listed account matches (18 of 18 for BER and 19 of 19 for VIE on 2026-10-21) and no `W-AGGREGATE-DIFF` is raised

#### Scenario: Conservation violated
- **WHEN** a defect causes a ledger line to be neither booked nor listed as skipped
- **THEN** error `E-CONSERVATION` is raised and no file is written

### Requirement: Dry run
With `--dry-run` the export SHALL run every step except writing, SHALL print the posting summary (totals per DATEV account; revenue per rate with gross, DATEV VAT, apaleo's precise VAT and the difference; deposit VAT per rate the same way; city tax; payments per clearing account; deposits received, released and refunded; accounts receivable; skipped lines with unsigned totals; findings), and SHALL exit with code 1 if any error finding exists. The protocol file SHALL contain the same summary.

#### Scenario: Review before the first file
- **WHEN** the user runs `export --month 2026-10 --property BSP --dry-run`
- **THEN** the summary is printed and no file or folder is created

#### Scenario: VAT comparison in the protocol
- **WHEN** the recorded BER day 2026-10-21 is exported
- **THEN** the protocol shows for revenue `7 %: gross 571.22, DATEV VAT 37.38, apaleo VAT 37.37, difference 0.01` and `19 %: gross 47.38, DATEV VAT 7.57, apaleo VAT 7.56, difference 0.01`, with one sentence explaining that DATEV rounds per booking and apaleo per day

### Requirement: Output layout and manifest
The export SHALL write each file to `<output.dir>/<propertyId>/<YYYY-MM>/` with the deterministic name `EXTF_Buchungsstapel_<Berater>_<Mandant>_<from>-<to>_<propertyId>.csv`, SHALL write a protocol text file beside it, and SHALL record in `manifest.json` the file name, SHA-256 of the file, SHA-256 of the body without the header line, booking count, the total of all booking amounts as `amountTotal`, `sollTotal` and `habenTotal` (all three equal: DATEV adds each amount once to Soll and once to Haben, so this is what the Kanzlei sees as Summe Soll and Summe Haben after import), mapping file SHA-256, tool version and creation time.

#### Scenario: Files after a run
- **WHEN** a monthly export for BSP 2026-10 succeeds
- **THEN** the folder `exports/BSP/2026-10/` contains the EXTF file, its protocol and a manifest entry with both hashes

#### Scenario: Soll equals Haben
- **WHEN** the recorded BER day 2026-10-21 is exported
- **THEN** the manifest entry has `amountTotal`, `sollTotal` and `habenTotal` with the same value, the sum of all booking amounts of the file

## ADDED Requirements

### Requirement: Regression on recorded live data
The repository SHALL contain recorded real apaleo responses in `test/fixtures/apaleo/live/` (chart of accounts, `export-gross-daily` and `aggregate-daily` of BER and VIE for 2026-10-21 and 2026-10-22, synthetic sandbox data, no folios), scanned before commit for tokens, secrets, e-mail addresses, guest names and addresses, with a README naming origin and scan; and tests that run the full pipeline (apaleo adapter on a fake fetch, mapping, posting, plausibility and aggregate checks, writer) on them and assert the hand-checked totals.

#### Scenario: BER exports cleanly
- **WHEN** `export --from 2026-10-21 --to 2026-10-21 --property BER` runs on the recorded responses with the committed live SKR03 mapping and `checks.aggregates: true`
- **THEN** it writes one file without `E-` findings or `W-AGGREGATE-DIFF`, with 35 apaleo lines, 29 bookings and 6 skipped lines, and the summary values of the posting-rules scenario "Summary of the recorded BER day"

#### Scenario: VIE fails clearly in the DATEV path
- **WHEN** the same export runs for VIE with a mapping from the SKR03 template
- **THEN** it raises no parse or sub-cent error and stops with `E-UNMAPPED` for the 13 %, 10 % and 20 % revenue and deposit accounts

#### Scenario: Fixture scan
- **WHEN** the scan runs over `test/fixtures/apaleo/live/`
- **THEN** it finds no key or value matching token, secret, bearer, password or e-mail patterns, and every account name is an apaleo default name or of the form `… for Reservation|Folio <id>`
