## Why

The first live test against a real apaleo sandbox (business day 2026-10-21, properties BER and VIE) showed that v0.1.0 cannot export real data: apaleo sends `netAmount` and `taxes[].amount` with eight decimals, and the parser rejects them. Behind that blocker sit wrong mapping defaults, false aggregate alarms, a wrong deposit summary and English booking texts. The fixtures were hand-made; this slice fixes the defects and pins the tool to recorded real responses.

## What Changes

- Accept precise `netAmount` and `taxes[].amount`; `grossAmount` stays whole cents; precise tax reaches the VAT checks.
- Resolver skips empty parent rows and goes on to wildcards. Templates write no blocking `3000` Liabilities row, map AccountsReceivable by wildcard to the collective debtor, suggest no-show and cancellation fees at 7 % and explain the 2020 rates 16 %/5 %. Hints name the parent row; `init-mapping --update` reports rows to revisit.
- Aggregate check compares balances per leaf global account or guest parent, net for revenue and deposits, gross otherwise, VAT accounts against precise tax.
- Deposits classified by side and sign.
- Protocol and dry run show apaleo's precise VAT per rate beside DATEV's per-line VAT; `E-VAT-TOTAL` allows exactly the line rounding.
- German booking texts (`Auflösung Anzahlung`, `Erstattung`, `Erlös Logis 7 %`); manifest totals equal DATEV's Summe Soll/Haben (**BREAKING** for readers of `sollTotal`/`habenTotal`); skipped lines unsigned.
- `live-smoke` warns on an empty day and asks the right deposit question.
- Docs: real apaleo screens, `/Offset` accounts, invoice payments without a ledger line, Austrian properties.
- Regression tests on recorded BER/VIE responses; CHANGELOG 0.1.1.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `source-adapter-contract`: precise net and tax amounts on ledger lines.
- `apaleo-source`: amount parsing, live-smoke.
- `account-mapping`: resolution, templates, hints, `init-mapping --update`.
- `posting-rules`: VAT guard, deposits, booking texts, skipped lines, summary.
- `export-run`: aggregate and VAT checks, dry run, manifest, live-data regression.
- `documentation`: setup screens, mapping guide, posting rules.

## Non-goals

- BMD or other Austrian targets; AT properties keep failing clearly in the DATEV path.
- Daily aggregation of bookings, personal debtors, Adyen settlement.
- Changing apaleo's `performAccountingForOpenInvoiceActions` (documented only).
- Version bump, tag or release.

## Impact

`src/sources/apaleo/parse.ts`, `src/core/{source,money,aggregates}.ts`, `src/mapping/*`, `templates/*.rules.csv`, `src/posting/*`, `src/export/*`, `src/cli/commands/{live-smoke,init-mapping}.ts`, docs, `test/fixtures/apaleo/live/`, golden files.
