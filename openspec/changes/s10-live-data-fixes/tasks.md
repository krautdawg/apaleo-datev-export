## 1. Live fixtures first

- [x] 1.1 Write a scan script outside the fixture folder (`test/helpers/` or `scripts/`) that rejects keys or values matching token, secret, bearer, authorization, password or e-mail patterns and any account name that is not an apaleo default name or `… for Reservation|Folio <id>`; run it over `~/.config/apaleo-datev-dev/recordings/` (never read or copy any `.env` file there; skip `*_folios_*`) and keep its output for the README
- [x] 1.2 Copy, unwrapped to the bare response `body`, BER and VIE `accounts-schema.json`, `export-gross-daily/2026-10-21.json`, `export-gross-daily/2026-10-22.json`, `aggregate-daily/2026-10-21.json`, `aggregate-daily/2026-10-22.json` into `test/fixtures/apaleo/live/<BER|VIE>/`; strip names, e-mails and addresses if any appear (none expected)
- [x] 1.3 Write `test/fixtures/apaleo/live/README.md` (origin: apaleo DEV sandbox, synthetic guests, recorded 2026-10-21 before night audit; files; scan result; hand-checked BER totals from design.md)
- [x] 1.4 Extend `test/helpers/apaleo.ts` so the fake API can serve the live folder, and add the live files to the Swagger validation in `test/apaleo/fixtures.test.ts`
- [x] 1.5 Add a failing test: reading the BER ledger of 2026-10-21 through the adapter succeeds (today it throws the sub-cent error on entry `000000032`)

## 2. Precise amounts (defect 1)

- [x] 2.1 Add exact decimal helpers to `src/core/money.ts` (`sumDecimals`, comparison, half-away rounding reused from `decimalToCents`) with tests, including `37.3695327` from the eight 7 % lines
- [x] 2.2 Add `netPrecise` to `LedgerLine` and `amountPrecise` to `LedgerTax` in `src/core/source.ts`; update `docs/architecture.md` and the demo source and test helpers that build lines
- [x] 2.3 In `src/sources/apaleo/parse.ts` keep `toCents` for `grossAmount` only; derive `netCents`/`amountCents` by half-away rounding of the precise text; check `|gross − net − Σ taxes| ≤ 0.005` and fail naming day and entry; tests for the real line `000000032` and for an inconsistent line
- [x] 2.4 Make test 1.5 pass; run `pnpm test`, `pnpm lint`, `pnpm typecheck`

## 3. Resolver and templates (defects 2, 3, 10)

- [ ] 3.1 `src/mapping/resolve.ts`: pass over empty parent rows and continue to wildcards; return the first empty parent row only when nothing else applies; exact empty rows stay unmapped; tests for the v0.1.0 `3000` row at 7/19/0 % and for an exact empty revenue row
- [ ] 3.2 Templates `skr03-hotel@2` / `skr04-hotel@2`: AccountsReceivable rule as wildcard; LossOfAccountsReceivable 7/19 % as wildcards; no-show and cancellation-fee rules at 7 % (8300 / 4300) before the generic 7 % rule; 16 % and 5 % rules for Revenues and Liabilities with the 2020 comment; template tests updated
- [ ] 3.3 `suggestRows`: omit container accounts outside the global ledger whose type has wildcard rules and no rule yields an account; test on the recorded BER chart (no `3000` row, `*;AccountsReceivable;;;10000`, no-show/cancellation 7 % to 8300, 16/5 % rows empty)
- [ ] 3.4 `init-mapping`: count historical 16/5 % rows separately; `N-FOREIGN-VAT-RATES` for the VIE chart (4.9, 10, 13, 20 %); tests
- [ ] 3.5 `init-mapping --update`: `N-PARENT-ROW-EMPTY` and `N-TEMPLATE-SUGGESTION`; test with a template-v1 BER file: existing rows byte-identical, AR wildcard appended, notes for `3000`, `RevenueNoShow_Reduced:7.00`, `RevenueCancellationFees_Reduced:7.00`
- [ ] 3.6 `src/mapping/check.ts`: group `E-UNMAPPED` for per-reservation accounts by parent, type and rate with count and three examples; fix texts naming the empty parent row and the wildcard row with the template account; tests for the Liabilities and AccountsReceivable cases
- [ ] 3.7 Generate `test/fixtures/apaleo/live/BER/mapping-BER.live.csv` with `init-mapping --skr 03` (template v2) on the BER chart and commit it; `mapping check --from 2026-10-21 --to 2026-10-21` on it exits 0

## 4. Posting (defects 5, 7, 9, 6 summary part)

- [ ] 4.1 Deposit classification by side and sign with `receivedCents`, `releasedCents`, `refundedCents`; tests for the negative-charge release, the refund and the 0 % overpayment line
- [ ] 4.2 Accounts-receivable movement in the summary; test 114.00 on the BER day
- [ ] 4.3 Skipped totals unsigned; test 6 lines / 331.60 on the BER day
- [ ] 4.4 Per-rate VAT comparison in the summary (revenue and deposits): DATEV VAT, apaleo precise VAT, difference; tests with the BER values (37.38/37.37, 7.57/7.56, 14.26/14.26, 3.19/3.19)
- [ ] 4.5 German Buchungstext per design decision 10 (revenue group labels with rate, deposit cases with rate, payment labels, `Forderung an Debitor`); unit tests per case, the `Müller, Hans` test kept, and the "no English words" test on the BER day
- [ ] 4.6 Update `test/posting/fixture-month.test.ts` and the BSP expectations for the new texts, deposits and skipped totals, with the arithmetic in comments

## 5. Export checks and output (defects 4, 6, 8)

- [ ] 5.1 Rewrite `compareAggregates` per design decision 8 (balance, leaf global vs main account, net for Revenues/Liabilities, VAT accounts from precise taxes); unit tests on BER and VIE for 2026-10-21 and 2026-10-22, all accounts matching
- [ ] 5.2 Rewrite the BSP `aggregate-daily` fixtures in the real shape (leaf global accounts, guest parents, balances) and update `test/core/aggregates.test.ts`
- [ ] 5.3 `W-AGGREGATE-DIFF` message with both balances and the basis; test with one changed amount
- [ ] 5.4 `E-VAT-TOTAL` message with apaleo's precise total and the line-rounding difference; check stays cent-exact on rounded per-line tax; tests for "line rounding is not an error" and "roundings at another rate"
- [ ] 5.5 `src/export/summary.ts`: VAT comparison tables with the explaining sentence, deposits received/released/refunded, AR, skipped `gross (unsigned)`; dry-run and protocol tests
- [ ] 5.6 Manifest: `amountTotal`, `sollTotal` and `habenTotal` all the sum of booking amounts; update `ManifestEntry` docs and `test/golden/export/manifest.json`
- [ ] 5.7 Full-pipeline regression test on BER 2026-10-21 (`export` with `checks.aggregates: true`, fake clock after the day): one file, no `E-` and no `W-AGGREGATE-DIFF`, 35 lines / 29 bookings / 6 skipped, all hand-checked totals, writer validation passes
- [ ] 5.8 VIE regression test: no parse error, `E-UNMAPPED` for the 13/10/20 % accounts

## 6. live-smoke (defects 4, 5, 11)

- [ ] 6.1 Empty day: `WARN  ledger` line and the "nothing about the postings was checked" result, exit 0; test with a 204 day
- [ ] 6.2 Deposit question counts received/released/refunded with and without `taxes[]`; aggregate table by balance with "N of M accounts match"; test on the recorded BER day (6 received, 5 released of which 1 refunded, 18 of 18)

## 7. Docs and changelog

- [ ] 7.1 `docs/setup-apaleo.md` rewritten to the real screens (Apps > Connected apps > Add a new app > Add custom app, page New simple client, Secret description, fine-grained client, All properties / Only selected properties, Search permission, PII Retrieve / Omit linked / Omit all with Omit all recommended)
- [ ] 7.2 `docs/apaleo-source.md`: precise amounts wording, answers of the first live test, aggregate rule
- [ ] 7.3 `docs/mapping-guide.md`: resolution step 3 skips empty parent rows, `/Offset` accounts, AR wildcard, no-show/cancellation suggestions, 2020 rows, Austrian properties, `--update` notes; template rows list updated
- [ ] 7.4 `docs/posting-rules.md`: real deposit shapes, side-and-sign classification, booking texts, summary contents, invoice payments without a ledger line (`performAccountingForOpenInvoiceActions`)
- [ ] 7.5 `docs/export.md` (VAT comparison, manifest totals) and `docs/troubleshooting.md` (`N-PARENT-ROW-EMPTY`, `N-TEMPLATE-SUGGESTION`, `N-FOREIGN-VAT-RATES`, the open debtor after an invoice payment, Austrian properties, the old sub-cent error); fixture README in `test/fixtures/apaleo/README.md` points to `live/`
- [ ] 7.6 Regenerate `docs/examples/` and the golden EXTF file with the demo; review the diff (texts, protocol) by hand
- [ ] 7.7 CHANGELOG: under `## [Unveröffentlicht]` a German entry „0.1.1 (geplant) – wichtige Korrektur für echte apaleo-Daten“ with `### Behoben` (precise amounts, mapping defaults, aggregate check, deposit summary, VAT comparison, texts, skipped totals, live-smoke) and `### Geändert` (manifest totals, template v2, migration via `init-mapping --update`, re-export needs `--overwrite` after the Kanzlei removed the old batch)
- [ ] 7.8 Run `pnpm test` (docs consistency included), `pnpm lint`, `pnpm typecheck`, `pnpm build` green; `openspec validate s10-live-data-fixes --strict`
