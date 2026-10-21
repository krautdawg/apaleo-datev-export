## MODIFIED Requirements

### Requirement: Canonical ledger line
Each `LedgerLine` SHALL carry business date, posting timestamp, debit and credit account references (number, name, type, optional parent number), command, currency, the gross amount as integer cents, the net amount and each tax amount both as the source's precise decimal text (`netPrecise`, `amountPrecise`) and rounded half away from zero to integer cents (`netCents`, `amountCents`), tax type and percent, receipt type and number, reference, reference type, and source entry number. The gross amount SHALL be whole cents; net and tax amounts MAY have any number of decimals. Precise amounts SHALL be added up exactly (scaled integers), never as floating-point numbers, and rounded to cents only for display or a final comparison.

#### Scenario: Amount conversion
- **WHEN** a source returns a gross amount of `107.1`
- **THEN** the ledger line holds `grossCents = 10710`

#### Scenario: Sub-cent gross amount
- **WHEN** a source returns a ledger gross amount of `10.005`
- **THEN** conversion fails with an error naming the source entry number

#### Scenario: Precise net and tax amounts
- **WHEN** a source returns gross `14.9`, net `12.5210084` and one tax of `2.3789916` at 19 %
- **THEN** the line holds `grossCents = 1490`, `netPrecise = "12.5210084"`, `netCents = 1252`, and the tax holds `amountPrecise = "2.3789916"` and `amountCents = 238`, and no error is raised

#### Scenario: Exact precise sums
- **WHEN** the precise taxes of the eight 7 % revenue lines of the recorded BER business day 2026-10-21 are added up
- **THEN** the sum is exactly `37.3695327` and rounds to 37.37, while the same taxes rounded per line add up to 37.38
