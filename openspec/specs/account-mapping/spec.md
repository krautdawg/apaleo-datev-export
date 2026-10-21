# account-mapping Specification

## Purpose
The account mapping from apaleo accounts to DATEV accounts: the editable mapping CSV (with Excel and Grman-export input), the resolution order for ledger accounts, offline validation, the SKR03 and SKR04 hotel templates, the `init-mapping` and `mapping check` commands, and the guard that blocks unmapped booked accounts.
## Requirements
### Requirement: Mapping file format
The tool SHALL read and write a mapping CSV with the columns `apaleo_account;apaleo_type;apaleo_name;apaleo_vat_percent;datev_account;bu_key;datev_vat_percent;kost1;kost2;comment`, keyed by apaleo account number and type. Written files SHALL be UTF-8 with byte-order mark and `;` separators. Reading SHALL accept UTF-8 with or without BOM and CP1252, and `;` or `,` separators.

#### Scenario: Excel round trip
- **WHEN** the committed fixture `test/fixtures/mapping/excel-de-saved.csv` (the written original after an Excel DE save: CP1252, `;`, CRLF, leading zeros stripped, Excel's quoting) is loaded with Sachkontenlänge 4
- **THEN** it yields the same rows and values as the written original, with the stripped leading zeros of the class-0 account restored and reported as `W-PADDED` warnings

#### Scenario: Duplicate key
- **WHEN** two rows share the same apaleo account and type
- **THEN** loading fails with an error naming both line numbers

### Requirement: Grman mapping export accepted
The tool SHALL read a CSV with the header `ApaleoAccountNumber;DatevAccountNumber;CostCenter;CostCenter2` as a mapping whose rows match the account number regardless of type, and `mapping check` SHALL warn that BU keys and VAT rates are missing.

#### Scenario: Switching from a paid connector
- **WHEN** the user points `--mapping` at a CSV exported from the Grman DATEV Connector
- **THEN** the rows are used for resolution and the check prints a warning recommending `init-mapping --update`

### Requirement: Account resolution order
For a ledger account the tool SHALL resolve the mapping row in this order: exact number and type; exact number with any type; the parent account chain with the same type; for VAT-relevant types (Liabilities, CityTaxes, SecondCityTax, GuestLevies, LossOfAccountsReceivable, Vat, VatOnLiabilities) a wildcard row `*` for the type whose `apaleo_vat_percent` equals the line's normalised tax rate; for other types a wildcard row `*` for the type. Wildcard rows without a VAT rate SHALL be rejected for VAT-relevant types, and wildcard rows of type Revenues SHALL be rejected with or without a rate.

#### Scenario: Per-reservation account with a parent
- **WHEN** a ledger line debits account `BSP-12345-1` of type Receivables with parent `1200`, and the mapping has a row for `1200` Receivables
- **THEN** the line resolves to the row for `1200`

#### Scenario: Per-reservation accounts without a parent
- **WHEN** a ledger line debits `BSP-ABCDEF-1_Receivables` (type Receivables, no `parentNumber`, not in the chart) and credits `BSP-ABCDEF-1_Liabilities` (type Liabilities, no `parentNumber`) with a 7 % tax entry, and the mapping has a `*` Receivables row and a `*` Liabilities row with `apaleo_vat_percent` 7
- **THEN** the debit resolves to the Receivables wildcard and the credit to the 7 % Liabilities wildcard

#### Scenario: Liabilities wildcard without rate rejected
- **WHEN** the mapping contains a `*` row of type Liabilities with an empty `apaleo_vat_percent`
- **THEN** loading fails with an error saying that VAT-relevant wildcards must name a VAT rate

#### Scenario: Wildcard for payments
- **WHEN** a new payment-method account appears and the mapping has a `*` Payments row
- **THEN** the account resolves to the wildcard row

#### Scenario: Wildcard for revenue rejected
- **WHEN** the mapping contains a `*` row of type Revenues
- **THEN** loading fails with an error explaining that revenue accounts must be mapped one by one because of VAT

### Requirement: Unmapped accounts block the export
The tool SHALL refuse to produce a DATEV file when any account booked in the period does not resolve to a row with a DATEV account, and SHALL list each such account with number, type, name, number of lines and gross total. `mapping check --from --to` SHALL resolve each line with the rate the posting rules use, including the inferred rate of an untaxed deposit release.

#### Scenario: Untaxed deposit release
- **WHEN** the period contains a deposit release (debit Liabilities, credit Receivables, no tax entries) with a `PostPrepaymentVat` line of the same day and reference at 7 %, and the mapping has rate wildcards for Liabilities at 7 % and 0 %
- **THEN** `mapping check --from --to` resolves the release through the 7 % wildcard, never through the 0 % wildcard, reports nothing for it, and exits with code 0 if nothing else fails

#### Scenario: Untaxed deposit release without a rate source
- **WHEN** the period contains such a deposit release without a matching `PostPrepaymentVat` line, and the chart gives its Liabilities account no VAT rate
- **THEN** `mapping check --from --to` reports `E-VAT-RATE-UNKNOWN` once for all such lines, does not mention the 0 % row, and exits with code 1

#### Scenario: Untaxed deposit release without deposit rows
- **WHEN** the rate of such a deposit release is inferred as 19 % and the mapping has no Liabilities row for 19 % that applies to it
- **THEN** `mapping check --from --to` reports `E-UNMAPPED` for the Liabilities account and suggests a `*` Liabilities row at 19 %

#### Scenario: Parent row with the wrong VAT rate
- **WHEN** an SKR03 mapping has only the parent row `5000;Revenues;Revenues;;8400` and the period books accommodation (`5011`) and food (`5111`) at 7 %
- **THEN** `mapping check --from --to` reports `E-VAT-MISMATCH` for `5011` and `5111` (booked at 7 %, DATEV applies 19 % on `8400`) and exits with code 1; a Grman row `5000;8400` is checked the same way

#### Scenario: New revenue account
- **WHEN** the period contains lines on revenue account `5010` that has no mapping row
- **THEN** the check fails with exit code 1 and a finding `E-UNMAPPED` naming `5010`, its type, its name, the line count and the gross total, and no file is written

### Requirement: Mapping validation
`apaleo-datev mapping check` SHALL validate that DATEV accounts are digits only and have exactly Sachkontenlänge digits (exactly Sachkontenlänge plus one for AccountsReceivable rows), that BU keys have one to four digits, that no row combines a known Automatikkonto with a BU key other than a Generalumkehr (`2x`) or Aufhebung (`4x`) key, that `datev_vat_percent` does not contradict the rate the Automatikkonto or a known tax key implies (`E-VAT-CONFLICT`; known keys are `2` and `3` for output tax, `8` and `9` for input tax, also after a Generalumkehr `2x`), that no row of type Revenues, Liabilities, CityTaxes, SecondCityTax, GuestLevies or LossOfAccountsReceivable uses an input-tax key (`E-BU-INPUT-TAX`), that the VAT rate DATEV will apply (the implied rate first, `0` for key `40` on an Automatikkonto, else `datev_vat_percent`, else 0 when there is no BU key) equals `apaleo_vat_percent` where both are known, and with `--from --to` equals the rate each booked line of a VAT-relevant type carries (`E-VAT-MISMATCH`, also for rows reached through the parent chain). A BU key the tool does not know SHALL give the warning `W-BU-KEY-UNCHECKED` instead of being trusted silently. The command SHALL exit with code 1 on any error. Short numbers SHALL only be left-padded when the padding is unambiguous (Sachkontenlänge 4 and a 1–3 digit number), with a warning.

#### Scenario: VAT mismatch
- **WHEN** an apaleo revenue account at 7 % is mapped to a DATEV account with `datev_vat_percent` 19
- **THEN** the check reports an error naming the row and both rates

#### Scenario: Rate column contradicts the Automatikkonto
- **WHEN** an SKR03 row maps apaleo food revenue at 7 % to `8400` with `datev_vat_percent` 7
- **THEN** the check reports `E-VAT-CONFLICT` (the column says 7 %, the Automatikkonto applies 19 %) and `E-VAT-MISMATCH` against 19 %

#### Scenario: Aufhebung der Automatik
- **WHEN** an SKR03 row maps apaleo revenue at 7 % to `8300` with `bu_key` 40
- **THEN** the check reports `E-VAT-MISMATCH`, because DATEV books the revenue without VAT

#### Scenario: Template-length account at a longer Sachkontenlänge
- **WHEN** `datev.sachkontenlaenge` is 5 and a row maps to `1360`
- **THEN** the check reports `E-ACCOUNT-LENGTH` for the row, explains that the number needs 5 digits (for example `13600`), and does not pad it to `01360`

#### Scenario: Input-tax key on a revenue row
- **WHEN** a row maps apaleo revenue at 7 % to `8200` with `bu_key` 9 or 8
- **THEN** the check reports `E-BU-INPUT-TAX` naming the row and exits with code 1

#### Scenario: Unknown BU key
- **WHEN** a row has a BU key the tool does not know, for example `5`
- **THEN** the check warns `W-BU-KEY-UNCHECKED` and uses `datev_vat_percent`, or leaves the rate unchecked when that column is empty

#### Scenario: BU key on an Automatikkonto
- **WHEN** an SKR03 row maps to `8300` with `bu_key` 2
- **THEN** the check reports `E-BU-ON-AUTOMATIC` naming the row and exits with code 1

#### Scenario: Valid mapping
- **WHEN** every row passes all checks
- **THEN** the command prints a summary of rows by type and exits with code 0

### Requirement: SKR03 and SKR04 hotel templates
The tool SHALL ship rule-based templates for SKR03 and SKR04 that map, by apaleo type, VAT percent and account-name pattern: accommodation revenue at 7 %, food revenue at 7 %, drinks and other revenue at 19 %, non-taxable revenue, cash and non-cash payments to clearing accounts, guest and external receivables, accounts receivable to a collective debtor, deposits by VAT rate, and bad debt by VAT rate. City tax, second city tax and guest levies SHALL be written with an empty DATEV account and a comment describing the guest-owed and operator-owed options. Template rows SHALL have no BU key, SHALL be written with 4-digit base numbers and scaled to the configured Sachkontenlänge with trailing zeros (reported as a note), SHALL each be marked as a suggestion to be confirmed by the Steuerberater, and accounts that no rule matches SHALL stay unmapped.

#### Scenario: Template does not guess
- **WHEN** the chart contains a House account and a TransitoryItems account
- **THEN** the generated rows for them have an empty DATEV account and an explanatory comment

#### Scenario: City tax is not pre-filled
- **WHEN** the chart contains a CityTaxes account
- **THEN** its generated row has an empty DATEV account and a comment naming both options (Durchlaufende Posten at 0 %, or revenue at 7 %), and `mapping check --from --to` reports `E-UNMAPPED` for it until the user fills it in

#### Scenario: Food and drinks under 2026 rules
- **WHEN** the chart contains revenue accounts "Frühstück Speisen" at 7 % and "Getränke" at 19 %
- **THEN** the food account maps to the 7 % revenue account and the drinks account to the 19 % revenue account

#### Scenario: Templates scale to Sachkontenlänge 5
- **WHEN** `init-mapping --skr 03` runs with `datev.sachkontenlaenge` 5
- **THEN** the template's `8300` is written as `83000`, the collective debtor `10000` as `100000`, and the command prints a note naming Sachkontenlänge 5

#### Scenario: Non-cash payment never maps to the bank account
- **WHEN** the template maps a credit-card payment account
- **THEN** it maps to the Geldtransit clearing account, not to a bank account

### Requirement: init-mapping command
`apaleo-datev init-mapping --property <id> --skr 03|04 [--out <file>] [--update]` SHALL read the property's chart of accounts and write a mapping CSV with one row per leaf account pre-filled from the template, SHALL refuse to overwrite an existing file unless `--update` is given, and with `--update` SHALL keep every existing row unchanged and append rows only for accounts not yet present.

#### Scenario: First run
- **WHEN** the user runs `init-mapping --property BSP --skr 04` and no file exists
- **THEN** `mapping-BSP.csv` is written with all leaf accounts, template suggestions where a rule matched, and the command prints how many rows are mapped and unmapped

#### Scenario: Update keeps edits
- **WHEN** the user has edited row `5000` and apaleo has added account `5020`, and runs `init-mapping --property BSP --skr 04 --update`
- **THEN** row `5000` is unchanged and a row for `5020` is appended, and the command lists the added account

#### Scenario: Grman backup already exists
- **WHEN** the file is a Grman export and `<name>.grman.csv` already exists
- **THEN** `init-mapping --update` exits with code 1 and changes neither file

#### Scenario: Existing file without update
- **WHEN** `mapping-BSP.csv` exists and the user runs `init-mapping` without `--update`
- **THEN** the command exits with code 1 and nothing is written

