## ADDED Requirements

### Requirement: Precise ledger amounts from export-gross-daily
The adapter SHALL accept `netAmount` and `taxes[].amount` of `export-gross-daily` with any number of decimals and keep them as precise decimal text on the ledger line, SHALL require `grossAmount` to be whole cents, and SHALL fail with an error naming the business day and source entry number when gross differs from net plus the sum of the taxes by more than half a cent.

#### Scenario: Real sandbox line
- **WHEN** apaleo returns line `000000032` with gross `14.9`, net `12.5210084` and tax `2.3789916` at 19 % (recorded BER, 2026-10-21)
- **THEN** the line is parsed without error, and `live-smoke --date 2026-10-21`, `mapping check --from 2026-10-21 --to 2026-10-21` and `export` no longer fail with a sub-cent error

#### Scenario: Inconsistent amounts
- **WHEN** a line has gross `10.00`, net `9.00` and a tax of `0.65`
- **THEN** reading fails with an error naming the source entry number and the three amounts

## MODIFIED Requirements

### Requirement: Account totals for completeness checks
The adapter SHALL read `POST /finance/v1/accounts/aggregate-daily` for a property and one business day per call and return debited amount, credited amount and balance per account as apaleo lists it (leaf global accounts such as payment methods, revenue and VAT sub-accounts; for guest, external and booking accounts only their top-level parent), keeping apaleo's precise amounts without applying the ledger sub-cent guard.

#### Scenario: Totals returned
- **WHEN** aggregates are requested for each of three business days
- **THEN** three requests are sent, one per day, and each result lists each account with debit, credit and balance and a grand total

#### Scenario: Precise aggregate amount
- **WHEN** an aggregate amount is `123.4567`
- **THEN** no sub-cent error is raised

#### Scenario: Recorded real aggregates
- **WHEN** the recorded BER aggregates of 2026-10-21 are read
- **THEN** the result has 18 accounts, among them `1107` with balance 114.9, `RevenueAccommodation_Reduced:7.00` with balance −398.14953271, `Vat_Reduced:7.00` with balance −37.36953271 and `3000` with balance −220.54692532

### Requirement: Live smoke command
The CLI SHALL provide `apaleo-datev live-smoke --property <id> [--date YYYY-MM-DD]` that, against real credentials, fetches a token, the property, the chart of accounts and one business day of ledger and aggregates, prints counts and totals, compares the aggregates with the ledger by balance as the export's aggregate check does, reports whether per-reservation accounts carry `parentNumber` and how many deposit lines were received, released and refunded (each with and without `taxes[]`), writes no files, and exits 0 only if every required step succeeded (a missing optional aggregate permission is reported, not fatal). When the business day has no ledger lines, it SHALL print a warning and a result line saying that nothing about the postings was checked and suggesting `--date` with a day that has bookings, instead of a plain pass. The test suite SHALL NOT call it against the network.

#### Scenario: Smoke run succeeds
- **WHEN** a developer runs `apaleo-datev live-smoke --property BSP` with a valid custom app
- **THEN** the output shows account counts by type, the number of ledger lines and debit and credit totals for the day, and the exit code is 0

#### Scenario: Smoke run without secret
- **WHEN** `APALEO_CLIENT_SECRET` is not set
- **THEN** the command exits with code 1 before any network call and names the missing variable

#### Scenario: Empty business day
- **WHEN** the default business day (two days ago) has no ledger lines
- **THEN** the output contains `WARN` for the ledger step and a result line that the day has no bookings and nothing about the postings was checked, it does not say that every required step passed without that note, and the exit code is 0

#### Scenario: Recorded day answers the questions
- **WHEN** live-smoke runs on the recorded BER responses of 2026-10-21 through a fake fetch
- **THEN** it reports 6 deposit lines received, 5 released of which 1 refunded, all with `taxes[]` except the two 0 % lines, and "18 of 18 accounts match" for the aggregates
