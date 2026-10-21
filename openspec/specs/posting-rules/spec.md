# posting-rules Specification

## Purpose
The PMS-neutral posting rules that turn canonical ledger lines into DATEV bookings: the direction rule (VAT side in Gegenkonto), the per-line VAT consistency guard, the rate inference for untaxed deposit releases, skip rules, field filling without personal data, and the posting summary.
## Requirements
### Requirement: One booking per ledger line
The posting module SHALL turn every ledger line that is not skipped into exactly one DATEV booking whose amount is the absolute gross amount in cents, whose Belegdatum is the line's business date, and which carries the line's source entry number for traceability.

#### Scenario: Card payment
- **WHEN** a line debits the Visa payment account (mapped to 1360) and credits a guest receivables account (mapped to 1410) with gross 120.00 and no taxes
- **THEN** one booking is produced with amount 12,000 cents, Konto 1360, Gegenkonto 1410, side `S`, no BU key

### Requirement: VAT side in Gegenkonto
The posting module SHALL place the account on which DATEV applies VAT (a mapping row with a VAT rate above 0 % or a BU key) in Gegenkonto and the other account in Konto, SHALL set side `S` when Konto is the apaleo debited account and `H` otherwise, SHALL flip the side for negative gross amounts, and SHALL take the BU key from the VAT-side row.

#### Scenario: Accommodation charge at 7 %
- **WHEN** a line debits a guest receivables account (1410) and credits the accommodation 7 % revenue account (8300, rate 7) with gross 100.00 and taxes 6.54 at 7 %
- **THEN** the booking is 10,000 cents, Konto 1410, Gegenkonto 8300, side `S`

#### Scenario: Allowance on accommodation
- **WHEN** a line debits the accommodation 7 % revenue account and credits the guest receivables account with gross 10.00 and taxes 0.65 at 7 %
- **THEN** the booking is 1,000 cents, Konto 1410, Gegenkonto 8300, side `H`

#### Scenario: Negative gross amount
- **WHEN** a line debits receivables and credits revenue with gross −10.00
- **THEN** the booking is 1,000 cents with side `H`

#### Scenario: Two VAT sides
- **WHEN** both mapped accounts of a line carry a VAT rate
- **THEN** a finding `E-TWO-VAT-SIDES` names the source entry number and both accounts, and no booking is produced for the line

### Requirement: VAT consistency guard
For every booked line the posting module SHALL first normalise `taxes[]` by dropping entries with percent 0 and amount 0, and SHALL then ensure that the VAT rate DATEV will apply equals apaleo's tax percent, that DATEV's VAT computed from the absolute gross amount differs from the absolute apaleo tax amount by at most one cent, and that the signs of tax and gross agree. A one-cent difference SHALL be a warning `W-VAT-ROUNDING`; larger differences, rate mismatches, taxed lines without a VAT side, untaxed lines with a VAT side, and lines with several tax rates SHALL be errors that name the source entry number and the mapping row to fix.

#### Scenario: Drinks at 19 %
- **WHEN** a line credits the 19 % revenue account (8400, rate 19) with gross 23.80 and taxes 3.80 at 19 %
- **THEN** DATEV's VAT is 3.80, no finding is raised, and the summary shows 23.80 gross revenue at 19 %

#### Scenario: Breakfast food at 7 % (2026 rules)
- **WHEN** a line credits the food revenue account (8300, rate 7) with gross 12.00 and taxes 0.79 at 7 %
- **THEN** DATEV's VAT is 0.79 and no finding is raised

#### Scenario: Zero-rate tax entry
- **WHEN** a city-tax line has `taxes[]` with one entry of type `Without`, percent 0, amount 0.00, and credits an account mapped with rate 0
- **THEN** the entry is dropped by normalisation and no `E-VAT-MISSING` is raised

#### Scenario: Negative allowance with negative tax
- **WHEN** an allowance line has gross −10.00 and taxes −0.65 at 7 % and credits the receivables side of a 7 % revenue account
- **THEN** DATEV's VAT on 10.00 (0.65) is compared with |−0.65|, the signs agree, and no `E-VAT-AMOUNT` is raised

#### Scenario: Wrong rate in mapping
- **WHEN** an apaleo line taxed at 7 % credits an account mapped to a 19 % DATEV rate
- **THEN** a finding `E-VAT-RATE` is raised and the export is blocked

#### Scenario: Taxed line on an untaxed DATEV account
- **WHEN** an apaleo line with 6.54 tax credits an account mapped with rate 0 and no BU key
- **THEN** a finding `E-VAT-MISSING` is raised

#### Scenario: One-cent rounding
- **WHEN** DATEV's VAT computed from the gross amount differs by one cent from apaleo's tax amount
- **THEN** a warning `W-VAT-ROUNDING` is raised and the difference is added to the rounding total in the summary

#### Scenario: DATEV rate of a row unknown
- **WHEN** a line resolves to a row with a BU key the tool does not know and an empty `datev_vat_percent`
- **THEN** a finding `E-DATEV-RATE-UNKNOWN` names the mapping line and asks for `datev_vat_percent`, and no booking is produced

### Requirement: City tax and guest levies
Lines on CityTaxes, SecondCityTax and GuestLevies accounts SHALL be booked through their mapping rows like any other line, so that a guest-owed levy mapped to a pass-through account at 0 % is booked without VAT and an operator-owed tax that apaleo taxes is booked on a revenue account with the matching rate; the VAT guard SHALL apply to both.

#### Scenario: Guest-owed Kurtaxe
- **WHEN** a line debits guest receivables (1410) and credits the city-tax account mapped to Durchlaufende Posten (1590, rate 0) with gross 5.00 and no taxes
- **THEN** the booking is 500 cents, Konto 1410, Gegenkonto 1590, side `S`, no BU key, and the summary shows 5.00 city tax

### Requirement: Deposits and accounts receivable
Prepayment lines (`PostPrepayment`) SHALL be booked to the mapped liability account, and accounts-receivable lines (`PostToAccountsReceivables`) to the mapped collective debtor, both under the VAT guard.

#### Scenario: Prepayment at 7 %
- **WHEN** a line debits the card payment account (1360) and credits the guest liabilities 7 % account mapped to a taxed deposit account (rate 7) with gross 200.00 and taxes 13.08 at 7 %
- **THEN** the booking is 20,000 cents, Konto 1360, Gegenkonto the deposit account, side `S`, and the summary shows 200.00 deposits received

#### Scenario: Check-out on accounts receivable
- **WHEN** a line debits the AccountsReceivable account (mapped to 10000) and credits guest receivables (1410) with gross 300.00 and receipt type Invoice number `BSP-2026-0042`
- **THEN** the booking is 30,000 cents, Konto 10000, Gegenkonto 1410, side `S`, Belegfeld 1 `BSP-2026-0042`

### Requirement: Deposit release without taxes
When a line debits a Liabilities account and credits a Receivables account and carries no tax entries after normalisation, the posting module SHALL infer the VAT rate from the skipped `PostPrepaymentVat` line(s) of the same business date and reference, else from the chart VAT of the Liabilities account or its parent, SHALL use that rate for mapping resolution and the VAT guard, and SHALL raise `E-VAT-RATE-UNKNOWN` when no rate can be inferred. Any other untaxed line with exactly one Liabilities side (a deposit refunded or received without tax entries) SHALL take its rate from a `PostPrepaymentVat` line of the same business date and reference that moves VAT in its direction, with the same amount check, and SHALL keep rate 0 only when there is no such line. A release booked with a chart rate SHALL always raise `W-VAT-INFERRED`, also at 0 %.

#### Scenario: Release with taxes
- **WHEN** a release line of 200.00 debits a per-reservation `_Liabilities` account and credits guest receivables with taxes 13.08 at 7 %
- **THEN** the credit resolves to the 7 % Liabilities row, the booking is 20,000 cents with Gegenkonto the 7 % deposit account and side `H`, and no finding is raised

#### Scenario: Release without taxes plus a PostPrepaymentVat pair
- **WHEN** the release line of 200.00 has no `taxes[]`, and a `PostPrepaymentVat` line of the same day and reference carries 13.08 at 7 %
- **THEN** the release resolves to the 7 % Liabilities row, DATEV's VAT of 13.08 matches the pair, the pair is skipped as `VAT_ACCOUNT_LINE`, and no `E-VAT-UNEXPECTED` is raised

#### Scenario: Release with a chart rate only
- **WHEN** a release line has no `taxes[]` and no matching `PostPrepaymentVat` line, and its Liabilities account (or its parent) carries 7 % in the chart
- **THEN** the release is booked on the 7 % deposit row and a warning `W-VAT-INFERRED` names the line and the chart account

#### Scenario: Release with no rate source
- **WHEN** a release line has no `taxes[]`, no matching `PostPrepaymentVat` line, and its account has no VAT in the chart
- **THEN** a finding `E-VAT-RATE-UNKNOWN` names the source entry number and the export is blocked

#### Scenario: Release with a chart rate of 0 %
- **WHEN** a release line has no `taxes[]` and no matching `PostPrepaymentVat` line, and its Liabilities account (or its parent) carries 0 % in the chart
- **THEN** the release is booked on the 0 % deposit row and a warning `W-VAT-INFERRED` names the line, the chart account and the 0 % rate

#### Scenario: Untaxed deposit refund with a PostPrepaymentVat line
- **WHEN** a refund of 100.00 debits a per-reservation `_Liabilities` account and credits a payment account without `taxes[]`, and a `PostPrepaymentVat` line of the same day and reference reverses 6.54 at 7 % (debit VAT on liabilities)
- **THEN** the refund resolves to the 7 % Liabilities row, so DATEV reverses 6.54 on the deposit account, and no finding is raised; a mismatch of more than one cent raises `E-VAT-AMOUNT`

#### Scenario: Untaxed prepayment received with a PostPrepaymentVat line
- **WHEN** a prepayment of 100.00 credits a per-reservation `_Liabilities` account without `taxes[]`, and a `PostPrepaymentVat` line of the same day and reference books 6.54 at 7 % (credit VAT on liabilities)
- **THEN** the prepayment resolves to the 7 % Liabilities row and no finding is raised; without such a line it stays on the 0 % deposit row

### Requirement: Skipped lines are reported
The posting module SHALL skip, and list with reason, count and gross total: lines touching apaleo Vat or VatOnLiabilities accounts (always, in v1), lines with zero gross amount, and lines whose two sides map to the same DATEV account.

#### Scenario: Move between guest folios
- **WHEN** a `MoveLineItem` line moves 50.00 between two guest receivables accounts that both map to 1410
- **THEN** no booking is produced and the summary lists one `SAME_ACCOUNT` line of 50.00

#### Scenario: VAT account lines are skipped
- **WHEN** a line touches a Vat or VatOnLiabilities account
- **THEN** no booking is produced, the summary lists it as `VAT_ACCOUNT_LINE` with its amount, and the Vat account does not need a mapping row

### Requirement: Field filling without personal data
Belegfeld 1 SHALL be the receipt number when `posting.belegfeld1` is `receipt` (the default) and a receipt number exists, otherwise the reference; Buchungstext SHALL be built from a German command label (Erlös, Zahlung, Anzahlung, Umbuchung, Forderung, …) and an account label, SHALL use the parent account name or a fixed label (`Gastforderung`, `Debitor`, `Anzahlung Gast`) instead of the leaf name for guest, booking and per-reservation accounts, and SHALL NOT contain guest names; KOST1 and KOST2 SHALL come from the mapping, preferring the VAT-side row.

#### Scenario: Payment without invoice
- **WHEN** a payment line has receipt type PspReference number `PSP123` and reference `BSP-ABCDEF-1`
- **THEN** Belegfeld 1 is `PSP123`

#### Scenario: Payment crediting a named guest folio
- **WHEN** a payment line debits the Visa account and credits a guest folio account named `Müller, Hans` (type Receivables, not in the global ledger)
- **THEN** the Buchungstext is `Zahlung Gastforderung` (or the global parent's name) and does not contain `Müller`

### Requirement: Posting summary
The posting module SHALL return a summary with Soll, Haben and balance per DATEV account, revenue per VAT rate with the VAT DATEV will compute, city-tax total, payments per clearing account, deposits received and released, skipped lines per reason, the rounding total, and findings grouped by code.

#### Scenario: Summary of the fixture month
- **WHEN** the fixture period is posted with the SKR03 fixture mapping
- **THEN** the summary values equal the hand-computed totals recorded in the test

