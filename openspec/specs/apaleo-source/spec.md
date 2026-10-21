# apaleo-source Specification

## Purpose
Read the apaleo subledger of a property, read-only, with the hotel's own custom app (client credentials): authentication, the properties, chart-of-accounts, export-gross-daily and aggregate-daily endpoints, retries, response validation against the Swagger shape, and the `properties` and `live-smoke` commands.
## Requirements
### Requirement: Client-credentials authentication
The apaleo adapter SHALL obtain an access token from `https://identity.apaleo.com/connect/token` with the `client_credentials` grant using `apaleo.clientId` from config and `APALEO_CLIENT_SECRET` from the environment, SHALL reuse the token until 60 seconds before it expires, and SHALL never write the secret or the token to logs or error messages.

#### Scenario: Token reuse
- **WHEN** two API calls are made within the token lifetime
- **THEN** only one token request is sent

#### Scenario: Wrong credentials
- **WHEN** the token endpoint answers 400 or 401
- **THEN** the command exits with code 1 and a message to check the client id, the secret and that the custom app is active, and the secret does not appear in the output

### Requirement: Ledger export per business day
The adapter SHALL read the ledger with `POST /finance/v1/accounts/export-gross-daily` using `propertyId`, `from` (inclusive) and `to` (exclusive), one business day per request, with an `Idempotency-Key` that is stable within one run and differs between runs. An HTTP 204 response SHALL be treated as a day without transactions.

#### Scenario: Three-day period
- **WHEN** the ledger for 2026-10-01 to 2026-10-04 (exclusive) is requested
- **THEN** three requests are sent with `from`/`to` pairs 10-01/10-02, 10-02/10-03, 10-03/10-04, and the lines of all three days are returned

#### Scenario: Empty day
- **WHEN** apaleo answers 204 for one day
- **THEN** that day contributes no lines and no error is raised

### Requirement: Chart of accounts
The adapter SHALL read `GET /finance/v1/accounts/schema` with `depth=4` and `includeArchived=true` and return a flat list of accounts with number, name, type, parent number, ledger list (global, guest, external, booking), VAT type and percent, archived flag and whether the account has children.

#### Scenario: Nested revenue accounts
- **WHEN** the schema contains `Revenues` with a sub-account `Accommodation` and VAT sub-accounts at 7 % and 19 %
- **THEN** the flat list contains each of them with its parent number and the VAT percent on the leaf accounts

### Requirement: Account totals for completeness checks
The adapter SHALL read `POST /finance/v1/accounts/aggregate-daily` for a property and one business day per call and return debited and credited amounts per main account, keeping apaleo's precise amounts without applying the ledger sub-cent guard.

#### Scenario: Totals returned
- **WHEN** aggregates are requested for each of three business days
- **THEN** three requests are sent, one per day, and each result lists each main account with debit and credit amounts and a grand total

#### Scenario: Precise aggregate amount
- **WHEN** an aggregate amount is `123.4567`
- **THEN** no sub-cent error is raised

### Requirement: Paged property listing
The adapter SHALL page `GET /inventory/v1/properties` with `pageSize=500` and SHALL stop when a page has fewer items than the page size or apaleo answers 204.

#### Scenario: Empty page
- **WHEN** apaleo answers 204 for page 2
- **THEN** paging stops and the properties of page 1 are returned without error

### Requirement: Retry and error handling
The adapter SHALL retry HTTP 429 after the `Retry-After` delay (capped at 60 seconds) and SHALL retry 5xx and network errors up to 4 times with exponential backoff. A 403 response SHALL fail with the list of permissions the custom app needs. Requests SHALL time out after 60 seconds.

#### Scenario: Rate limited
- **WHEN** apaleo answers 429 with `Retry-After: 2` and then 200
- **THEN** the adapter waits about 2 seconds, retries once and returns the data

#### Scenario: Connection breaks while the body arrives
- **WHEN** the connection resets or times out after part of an export-gross-daily body has arrived, and the next attempt succeeds
- **THEN** the adapter treats it as a network error, retries with the same `Idempotency-Key` and returns the data

#### Scenario: Missing permission
- **WHEN** apaleo answers 403 on the export endpoint
- **THEN** the error lists `core.subledger_export.create` and `core.subledger_schema.read` as required, `core.subledger_aggregate.create` as optional, and `accounting.read` as the scope alternative

### Requirement: Response validation against the Swagger shape
The adapter SHALL validate responses against schemas that mirror the apaleo Finance Swagger models, SHALL fail with property, day and JSON path when a required field is missing, and SHALL accept unknown enum values as strings so they surface as unmapped accounts later.

#### Scenario: Missing required field
- **WHEN** a transaction lacks `sourceEntryNumber`
- **THEN** reading fails with an error naming the property, the business day and `transactions[n].sourceEntryNumber`

#### Scenario: Timestamp with fractional seconds
- **WHEN** a transaction `timestamp` is `2026-10-01T22:14:05.1234567+02:00`
- **THEN** it is accepted and kept as the same ISO string in `postedAt`

#### Scenario: Fixtures conform to the Swagger
- **WHEN** the test suite runs
- **THEN** every apaleo fixture is checked against the committed Swagger excerpt and the suite fails if a required field or enum value does not match

### Requirement: Properties command
The CLI SHALL provide `apaleo-datev properties`, which lists every property the custom app can read with id, code, name, time zone and currency.

#### Scenario: List properties
- **WHEN** the user runs `apaleo-datev properties` with valid credentials
- **THEN** one line per property is printed and the exit code is 0

### Requirement: Live smoke command
The CLI SHALL provide `apaleo-datev live-smoke --property <id> [--date YYYY-MM-DD]` that, against real credentials, fetches a token, the property, the chart of accounts and one business day of ledger and aggregates, prints counts and totals, reports whether per-reservation accounts carry `parentNumber` and whether deposit-release lines carry `taxes[]`, writes no files, and exits 0 only if every required step succeeded (a missing optional aggregate permission is reported, not fatal). The test suite SHALL NOT call it against the network.

#### Scenario: Smoke run succeeds
- **WHEN** a developer runs `apaleo-datev live-smoke --property BSP` with a valid custom app
- **THEN** the output shows account counts by type, the number of ledger lines and debit and credit totals for the day, and the exit code is 0

#### Scenario: Smoke run without secret
- **WHEN** `APALEO_CLIENT_SECRET` is not set
- **THEN** the command exits with code 1 before any network call and names the missing variable

