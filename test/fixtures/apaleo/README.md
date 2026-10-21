# apaleo fixtures: "Hotel Beispiel" (property `BSP`)

Fabricated responses shaped exactly like the apaleo Swagger models. No real hotel, guest or account is behind them. `test/apaleo/fixtures.test.ts` validates every JSON file here against `swagger-excerpt.json` (definitions copied from the finance-v1 and inventory-v1 Swagger documents, downloaded 2026-10-20), so a fixture that drifts from the Swagger fails the suite. `test/helpers/apaleo.ts` serves the files as a fake apaleo API through `ctx.fetchFn`.

| File | Swagger model | What it holds |
|---|---|---|
| `properties/page-1.json` | PropertyListModel | `BSP` Hotel Beispiel (Europe/Berlin) and `HBW` Hotel Beispiel Wien. Page 2 is answered with 204. |
| `accounts-schema.json` | ChartOfAccountsModel | Chart at depth 4: payments (cash, Visa, Mastercard), revenues per VAT rate (accommodation 7/19 %, food 7 %, beverages 19 %, archived other 0 %), VAT, VAT on liabilities, city tax 0 %, AR, house; `1200` in guest and external accounts, `3000` in guest and booking accounts. |
| `export-gross-daily/<day>.json` | ExportGrossTransactionListModel | The ledger of one business day (below). Days without a file are answered with 204. |
| `aggregate-daily/<day>.json` | AggregateTransactionListModel | Gross totals per main account for the same day, with four-decimal precise amounts on some days. |

Business days (September 2026, so the demo month 2026-09 is always closed):

- **2026-09-14**: card prepayment 200.00 at 7 % for `BSP-GHIJKL-1` onto its `_Liabilities` account; package night for `BSP-ABCDEF-1` (logis 100.00 at 7 %, breakfast food 12.00 at 7 % and coffee 3.00 at 19 % as two lines with the same `sourceEntryNumber` and timestamp); city tax 5.00 with a `Without`/0 %/0.00 tax entry; drinks 23.80 at 19 %.
- **2026-09-15**: card prepayment 150.00 at 7 % for `BSP-MNOPQR-1`, with a `PostPrepaymentVat` line (debit `BSP-MNOPQR-1_Liabilities`, credit `2107` VAT on liabilities 7 %, 9.81) for the VAT due on the prepayment received; second package night; allowance −10.00 on logis with tax −0.65; charges on `BSP-12345-1` ("Müller, Hans", a guest account *with* `parentNumber` 1200).
- **2026-09-16**: check-out: a move of 5.00 between two guest folios, card 120.00, cash 23.80, 115.00 to accounts receivable (invoice), card 100.00 for `BSP-12345-1`.
- **2026-09-17**: no transactions (204).
- **2026-09-21**: deposit release, variant (a): the release line (debit `_Liabilities`, credit `_Receivables`) carries `taxes[]`.
- **2026-09-22**: deposit release, variant (b), for the `BSP-MNOPQR-1` prepayment of 09-15: the release line has no `taxes[]`, and a `PostPrepaymentVat` line (debit `2107`, credit `BSP-MNOPQR-1_Liabilities`, 9.81) reverses the VAT on the prepayment. Over 09-15 to 09-22 both `2107` and `BSP-MNOPQR-1_Liabilities` end at zero. The service VAT of 9.81 at 7 % is the one in the revenue line's `taxes[]` (`BSPE0020`); the `PostPrepaymentVat` lines move VAT between apaleo's own VAT accounts and must not be booked as a second 9.81 (s05 skips them as VAT account lines and uses them only to infer the release's rate).

Variant (a) (the `BSP-GHIJKL-1` prepayment of 09-14, released on 09-21) has no VAT-on-liabilities lines at all; variant (b) books VAT on the prepayment received. Which one a real property uses is a live-smoke question.

Per-reservation accounts (`BSP-ABCDEF-1_Receivables`, `BSP-GHIJKL-1_Liabilities`, ...) have no `parentNumber` and are not in the chart, like the account `QPMZZTUK-1_Receivables` in the Swagger example.

Real responses are welcome: if you run `apaleo-datev live-smoke` against a real account and the shapes differ, please anonymise names, reservation ids and amounts and add them as a new fixture day.
