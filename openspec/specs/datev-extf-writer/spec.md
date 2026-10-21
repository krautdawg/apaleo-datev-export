# datev-extf-writer Specification

## Purpose
Render, validate and encode DATEV-Format (EXTF) Buchungsstapel files that DATEV Rechnungswesen imports without manual fixes, independent of any PMS source.
## Requirements
### Requirement: EXTF header line
The writer SHALL emit as line 1 a DATEV-Format header with exactly 31 fields in this order: 1 `"EXTF"`, 2 `700`, 3 `21`, 4 `"Buchungsstapel"`, 5 `13`, 6 Erzeugt am `YYYYMMDDHHMMSSFFF`, 7 Importiert (empty), 8 Herkunft (Text, at most 2 characters, default `"RE"`), 9 Exportiert von (Text, at most 25 characters, `"apaleo-datev-export"`), 10 Importiert von (quoted empty `""`), 11 Beraternummer, 12 Mandantennummer, 13 WJ-Beginn `YYYYMMDD`, 14 Sachkontenlänge, 15 Datum vom `YYYYMMDD`, 16 Datum bis `YYYYMMDD`, 17 Bezeichnung (Text), 18 Diktatkürzel (Text), 19 Buchungstyp `1`, 20 Rechnungslegungszweck `0`, 21 Festschreibung, 22 WKZ `"EUR"`, 23 reserviert (empty), 24 Derivatskennzeichen (quoted empty `""`), 25 and 26 reserviert (empty), 27 Sachkontenrahmen (Text with leading zero, `"03"` or `"04"`), 28 Branchenlösungs-ID (empty), 29 reserviert (empty), 30 reserviert (quoted empty `""`), 31 Anwendungsinformation (Text, empty). Text header fields SHALL be quoted; number and date header fields SHALL NOT be quoted. Fields 10, 24 and 30 SHALL be written as `""` because DATEV's expressions for them are quoted (`^["]\w{0,25}["]$`, `^["]["]$`) and DATEV's sample header writes `""` there; fields 7, 23, 25, 26, 28 and 29 SHALL be written as nothing.

#### Scenario: Header for a monthly batch
- **WHEN** the writer renders a batch for Beraternummer 1234567, Mandant 42, WJ-Beginn 2026-01-01, Sachkontenlänge 4, period 2026-10-01 to 2026-10-31, SKR "03", Festschreibung 0, at a fixed clock of 2026-11-03 10:15:00.000
- **THEN** line 1 begins `"EXTF";700;21;"Buchungsstapel";13;20261103101500000;;"RE";"apaleo-datev-export";"";1234567;42;20260101;4;20261001;20261031;`, has exactly 31 fields, field 22 is `"EUR"`, fields 24 and 30 are `""` and field 27 is `"03"`

### Requirement: Column heading line
The writer SHALL emit as line 2 the 125 Buchungsstapel column headings of format version 13 in specification order, and every data line SHALL have exactly 125 fields.

#### Scenario: Column count
- **WHEN** any batch is rendered
- **THEN** line 2 has 125 `;`-separated fields, the first is `Umsatz (ohne Soll/Haben-Kz)`, the 125th is `Abw. Skontokonto`, and every following line has 125 fields

### Requirement: Booking line format
Each booking SHALL be rendered with Umsatz as a positive amount with decimal comma and two decimals and no thousands separator, Soll/Haben-Kennzeichen `S` or `H`, Konto, Gegenkonto, BU-Schlüssel, Belegdatum as `TTMM`, Belegfeld 1, Belegfeld 2, Buchungstext, KOST1 and KOST2 in their specification columns, and Festschreibung (column 114) repeating the header's Festschreibung, because DATEV treats an empty field 114 as "locked"; all other columns SHALL be empty. Quoting SHALL be driven by each column's declared type (`Text`, `Number`, `Amount`, `Date`, `Account`): `Text` fields, which include Soll/Haben, WKZ, BU-Schlüssel, Belegfeld 1, Belegfeld 2, Buchungstext, KOST1 and KOST2, SHALL be wrapped in double quotes with inner quotes doubled; `Number`, `Amount`, `Date` and `Account` fields SHALL NOT be quoted; empty fields of any type SHALL be written as nothing between the separators.

#### Scenario: Revenue booking
- **WHEN** a booking of 10,700 cents, side `S`, Konto 1360, Gegenkonto 8300, no BU key, Belegdatum 2026-10-05, Belegfeld 1 `INV-2026-001`, Buchungstext `Logis 7%` is rendered
- **THEN** the line starts `107,00;"S";;;;;1360;8300;;0510;"INV-2026-001";;;"Logis 7%"`

#### Scenario: Booking with a BU key
- **WHEN** a booking of 11,900 cents, side `S`, Konto 1200, Gegenkonto 8200 (an account without automatic VAT), BU key `3`, Belegdatum 2026-10-07 is rendered
- **THEN** field 9 of the line is the quoted text `"3"` (or the padded form recorded in `docs/datev-format.md`), never the unquoted `3`

#### Scenario: Festschreibung on every line
- **WHEN** a batch with header Festschreibung 0 is rendered
- **THEN** field 114 of every booking line is `0`, unquoted

#### Scenario: Quote inside text
- **WHEN** a Buchungstext contains `Zimmer "Seeblick"`
- **THEN** the field is written as `"Zimmer ""Seeblick"""`

### Requirement: File encoding and line format
The writer SHALL encode the file in Windows-1252 (CP1252) without byte-order mark, separate fields with `;`, and end every line with CRLF. Characters that CP1252 cannot represent SHALL be transliterated or replaced and each replacement SHALL be reported as a warning.

#### Scenario: Euro sign and umlauts
- **WHEN** a Buchungstext contains `Frühstück 5 €`
- **THEN** the bytes contain `0xFC` for `ü` and `0x80` for `€`, and no warning is raised

#### Scenario: Unsupported character
- **WHEN** a Buchungstext contains the emoji `🛏`
- **THEN** the character is replaced, a warning names the booking index and the original text, and the file is still produced

### Requirement: Header validation
The writer SHALL reject a header whose Beraternummer is outside 1001–9999999, whose Mandantennummer is outside 1–99999, whose Sachkontenlänge is outside 4–8, whose Datum vom is after Datum bis, whose period is not inside one fiscal year starting at WJ-Beginn, whose Bezeichnung exceeds 30 characters, whose Herkunft exceeds 2 characters, whose Exportiert von exceeds 25 characters, whose Bezeichnung, Herkunft, Exportiert von, Diktatkürzel or Sachkontenrahmen contains a control character (line break, tab or other), or whose Festschreibung is not 0 or 1. Text lengths SHALL be counted after composing the text (NFC).

#### Scenario: Account length 9
- **WHEN** the header sets Sachkontenlänge 9
- **THEN** rendering fails with a validation error naming `sachkontenlaenge` and the allowed range 4–8

#### Scenario: Period crosses fiscal year
- **WHEN** WJ-Beginn is 2026-01-01 and the period is 2026-12-15 to 2027-01-15
- **THEN** rendering fails with an error saying the period must stay inside one fiscal year

#### Scenario: Line break in the batch name
- **WHEN** the header sets Bezeichnung `Okt\r\n2026`
- **THEN** rendering fails with an `E-EXTF-HEADER` error naming `bezeichnung`, and no file with a split header line is produced

### Requirement: Booking validation
The writer SHALL reject bookings with an amount of zero, a negative amount, or more than 9,999,999,999.99; a Konto or Gegenkonto that is not all digits or whose length is neither exactly Sachkontenlänge (G/L account) nor exactly Sachkontenlänge plus one (personal account); identical Konto and Gegenkonto; a BU-Schlüssel that is not one to four digits; or a Belegdatum outside Datum vom to Datum bis. The writer SHALL NOT pad account numbers. KOST1 and KOST2 longer than 36 characters SHALL be cut to 36 with a warning. All findings for a batch SHALL be reported together, each with booking index, field and value. Messages shown to the user SHALL name fields as DATEV does (Umsatz, Konto, Gegenkonto, Belegdatum, ...), never by internal property names, and SHALL number bookings from 1; the `index` of a finding stays 0-based.

#### Scenario: Several invalid bookings
- **WHEN** booking 3 has amount 0 and booking 7 has Belegdatum outside the period
- **THEN** rendering fails once and the error lists both findings with their indexes 3 and 7, shown to the user as `booking 4, Umsatz` and `booking 8, Belegdatum`

#### Scenario: Personal account length
- **WHEN** Sachkontenlänge is 4 and a booking uses Konto 10001
- **THEN** the booking is accepted, and Konto 100001 is rejected

#### Scenario: Short account is not padded
- **WHEN** Sachkontenlänge is 5 and a booking uses Konto 1360
- **THEN** rendering fails with a finding that names the booking index, `konto` and the required length 5 (G/L) or 6 (personal), and the file is not written with `01360`

### Requirement: Text sanitising
The writer SHALL sanitise Belegfeld 1 to at most 36 characters from `A-Z a-z 0-9 $ & % * + - /`, transliterating umlauts and ß and replacing spaces with `-`; Belegfeld 2 to at most 12 characters of the same set; and Buchungstext to at most 60 characters without control characters. Text SHALL be composed (NFC) before it is sanitised or encoded, so decomposed umlauts are treated like composed ones. Every change SHALL be reported as a warning with the original value.

#### Scenario: Reservation id with dots
- **WHEN** Belegfeld 1 is `MUC.ABCDEF-1 Zahlung`
- **THEN** it is written as `MUCABCDEF-1-Zahlung` and a warning records the original

#### Scenario: Umlaut in Belegfeld 1
- **WHEN** Belegfeld 1 is `Rückbuchung-17`
- **THEN** it is written as `Rueckbuchung-17` and a warning records the original

#### Scenario: Decomposed umlauts
- **WHEN** Belegfeld 1 is `Rückbuchung-17` and Buchungstext is `Frühstück`, both in decomposed form (NFD, `u` + U+0308)
- **THEN** Belegfeld 1 is written as `Rueckbuchung-17` and Buchungstext as `Frühstück` with `0xFC`, never `Ruckbuchung` or `Fru?hstu?ck`

### Requirement: Deterministic file name
The writer SHALL name files `EXTF_Buchungsstapel_<Beraternummer>_<Mandantennummer>_<YYYYMMDD>-<YYYYMMDD>.csv`, with an optional suffix before `.csv`, so the same period always yields the same name.

#### Scenario: Monthly file name
- **WHEN** a file is named for Berater 1234567, Mandant 42, 2026-10-01 to 2026-10-31, suffix `MUC`
- **THEN** the name is `EXTF_Buchungsstapel_1234567_42_20261001-20261031_MUC.csv`

### Requirement: Golden-file regression tests
The test suite SHALL compare rendered output byte for byte with committed CP1252 golden files covering at least: a minimal one-booking file, 7 % and 19 % revenue, a booking with a BU key, a payment, umlauts and the euro sign, a sanitised Belegfeld 1, and cost centres.

#### Scenario: Writer change alters output
- **WHEN** a code change alters any byte of a golden case
- **THEN** `pnpm test` fails and shows a readable line diff

