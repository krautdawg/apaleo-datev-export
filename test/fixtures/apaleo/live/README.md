# Live recordings: apaleo DEV sandbox (properties `BER` and `VIE`)

Real responses of an apaleo DEV sandbox account, recorded on 2026-10-21 by the s10 test agent before the night audit of that day. The guests, reservations and bookings in the sandbox are synthetic; no real hotel or person is behind them. They pin the tool to what apaleo really sends (eight-decimal net and tax amounts, per-reservation accounts with `parentNumber`, `/Offset` accounts, releases as negative charges, aggregates on leaf global accounts and guest parents).

Each file is the bare response body, unwrapped from the recording (`{ status, query, body }`); the query always matched the folder and the day.

| File | Swagger model | What it holds |
|---|---|---|
| `<BER\|VIE>/accounts-schema.json` | ChartOfAccountsModel | `GET /finance/v1/accounts/schema?depth=4&includeArchived=true`. BER: German rates 7/19 % plus the historical 16/5 % of 2020; VIE: Austrian rates 4.9/10/13/20 %. |
| `<BER\|VIE>/export-gross-daily/2026-10-21.json` | ExportGrossTransactionListModel | 35 ledger lines each: prepayments, releases, a refund, an overpayment parked at 0 %, payments with their `/Offset` lines, an AR transfer, a no-show and a cancellation fee. |
| `<BER\|VIE>/export-gross-daily/2026-10-22.json` | ExportGrossTransactionListModel | 4 lines each, posted ahead for the next business day (not yet audited). |
| `<BER\|VIE>/aggregate-daily/<day>.json` | AggregateTransactionListModel | apaleo's own daily totals for the same days. |
| `BER/mapping-BER.v1.csv` | mapping file | What `init-mapping --skr 03` wrote with template `skr03-hotel@1` on the BER chart (input of the `--update` migration test). |
| `BER/mapping-BER.live.csv` | mapping file | What `init-mapping --skr 03` writes with template `skr03-hotel@2` on the BER chart, used by the regression tests. |

Folio recordings were not copied: the tool does not read folios.

## Privacy scan

Before copying, `node test/helpers/fixture-scan.ts ~/.config/apaleo-datev-dev/recordings` scanned every recording except the folios (and never opened a `.env` file there). It rejects keys or values that look like a token, secret, bearer, authorization or password, e-mail addresses, and every account name that is neither an apaleo default name nor of the form `… for Reservation|Folio <id>`. Result on 2026-10-21:

```
12 file(s) scanned, 0 problem(s)
```

No names, e-mail addresses or postal addresses had to be stripped. `test/apaleo/live-fixtures.test.ts` runs the same scan over this folder on every test run.

## Hand-checked BER totals of 2026-10-21

With the SKR03 template version 2 (`BER/mapping-BER.live.csv`):

- 35 apaleo lines: 29 bookings, 6 skipped `SAME_ACCOUNT` lines (the `/Offset` second lines) with an unsigned gross of 331.60.
- Revenue gross 571.22 at 7 %, 47.38 at 19 %, 45.00 at 0 % (663.60 in all).
- Revenue VAT: DATEV per booking 37.38 at 7 % and 7.57 at 19 %; apaleo precise 37.3695327 and 7.56487395 (37.37 and 7.56).
- Deposit VAT: DATEV 14.26 at 7 % and 3.19 at 19 %; apaleo precise 14.26299065 and 3.19008404.
- Payments 111.70 on 1000 (cash) and 675.90 on 1360 (cards), 787.60 in all.
- Deposits received 590.00, released 352.00, of it refunded 10.00 (to a Girocard); balance 238.00.
- Accounts receivable (10000) 114.00 Soll.
- No `W-VAT-ROUNDING`: per line DATEV's VAT equals apaleo's tax rounded half away from zero.
- `aggregate-daily` matches the ledger by balance on all 18 accounts (VIE: 19).
