# source-adapter-contract Specification

## Purpose
The PMS-neutral `SourceAdapter` interface and canonical ledger types (amounts in integer cents, stable line order) that every source implements and that mapping, posting and export code depend on, so other PMSs can be added without touching the core.
## Requirements
### Requirement: PMS-neutral source interface
The core SHALL define a `SourceAdapter` interface with `listProperties`, `getChartOfAccounts`, `getLedger(propertyId, from, toExclusive)` and `getAccountTotals(propertyId, businessDate)`, and the mapping, posting and DATEV modules SHALL depend only on this interface and its canonical types.

#### Scenario: Fake source in tests
- **WHEN** a test supplies an in-memory object implementing `SourceAdapter`
- **THEN** mapping, posting and export code run against it without any apaleo module loaded

### Requirement: Canonical ledger line
Each `LedgerLine` SHALL carry business date, posting timestamp, debit and credit account references (number, name, type, optional parent number), command, currency, gross and net amounts and tax amounts as integer cents, tax type and percent, receipt type and number, reference, reference type, and source entry number.

#### Scenario: Amount conversion
- **WHEN** a source returns a gross amount of `107.1`
- **THEN** the ledger line holds `grossCents = 10710`

#### Scenario: Sub-cent amount
- **WHEN** a source returns a ledger gross amount of `10.005`
- **THEN** conversion fails with an error naming the source entry number

### Requirement: Stable line order
`getLedger` SHALL return lines sorted by business date, then source entry number, then posting timestamp, then the order of the source response (stable sort), so that repeated runs over the same data produce identical output even though source entry numbers are not unique.

#### Scenario: Two lines share a source entry number
- **WHEN** two lines of one day have the same `sourceEntryNumber` and the same timestamp
- **THEN** they keep the order in which the source returned them

#### Scenario: Repeated read
- **WHEN** the same period is read twice from unchanged data
- **THEN** both results are equal element by element

