## Context

v0.1.0 was built against fabricated fixtures shaped like the Swagger. On 2026-10-21 a test agent ran it against an apaleo DEV sandbox (properties BER and VIE, 35 ledger lines each on business day 2026-10-21) and recorded the raw responses: `export-gross-daily`, `aggregate-daily` (2026-10-21 and the not-yet-audited 2026-10-22), `accounts/schema` and folios, in `~/.config/apaleo-datev-dev/recordings/`. The report lists 13 findings. Each claim used below was re-checked offline against those recordings while writing this design:

- Every `netAmount` and `taxes[].amount` has up to 8 decimals (`12.5210084`, `2.3789916`); every `grossAmount` is whole cents; `gross = net + Σ taxes` holds exactly on every line of all four export files.
- The real export carries no `PostPrepaymentVat` and no `Vat`/`VatOnLiabilities` lines. Deposits: `PostPrepayment` debit Payments, credit `<res>_Liabilities/<VatType>:<rate>` (parent `3000`) with `taxes[]`; release: `PostCharge` debit `<res>_Receivables`, credit `<res>_Liabilities/...` with **negative** gross and negative taxes; refund: `PostPrepayment` with negative gross; overpayment parked on the 0 % deposit: `PostCharge` debit Receivables, credit `Liabilities/Null:0.00`, positive.
- Payments come in pairs: `Payment → <folio>_Receivables/Offset` and `<folio>_Receivables → <folio>_Receivables/Offset` with the negative amount. The same for `PostToAccountsReceivables` with `<res>_AccountsReceivable` and `.../Offset`, all with parent `9999`.
- The chart has `3000` Liabilities, `1200` Receivables, `9999` AccountsReceivable (with one chart child `CollectiveDebitor_AccountsReceivable`) and `6900` in the guest, external and booking ledgers, all with `hasChildren: true`. It also has Revenues/Vat sub-accounts at 16 % and 5 % (2020) in every group, archived or not.
- BER hand-checked totals (SKR03 template plus the tester's fixes): revenue gross 571.22 at 7 %, 47.38 at 19 %, 45.00 at 0 % (= 663.60); payments 111.70 on 1000 and 675.90 on 1360 (= 787.60); deposits received 590.00, released 352.00 (10.00 of it refunded to a card), balance 238.00; 10000 Soll 114.00. Revenue VAT: DATEV per line 37.38 at 7 % and 7.57 at 19 %; apaleo precise 37.36953270 and 7.56487395 (37.37 / 7.56). Deposit VAT: DATEV 14.26 / 3.19, apaleo precise 14.26299065 / 3.19008404. Per line, DATEV's cent VAT always equals apaleo's tax rounded half away from zero, so no `W-VAT-ROUNDING` arises; the per-rate difference is pure line rounding.
- `aggregate-daily` lists **leaf** global accounts (`1101`, `RevenueAccommodation_Reduced:7.00`, `Vat_Reduced:7.00`, `LiabilitiesVat_Reduced:7.00`) and only the **parent** of guest-ledger accounts (`1200`, `3000`, `9999`). Balance (debit − credit) per such account equals the signed ledger sum on every account of BER and VIE for both days, when revenue and Liabilities use `netAmount`, all other types `grossAmount`, and `Vat_*` / `LiabilitiesVat_*` are compared with the signed precise taxes of revenue and Liabilities lines. The debit/credit split does not follow one rule (a negative payment is shown as credit, a negative charge on revenue stays a negative credit), so only the balance is comparable.

The recordings contain no tokens or secrets (only the keys `status`, `query`, `body` and Swagger fields). Account names carry reservation ids (`Liabilities for Reservation EPEBVUIU-1 (7%)`), never guest names; folio recordings do carry (synthetic) guest data and are not needed by the tool.

## Goals / Non-Goals

**Goals:**
- Export the recorded real day without errors and with the hand-checked totals, guarded by regression tests on the recordings.
- Fix each defect at its root (parser, resolver, template, checks, summary, texts), not by adjusting fixtures.
- Keep existing mapping files working; tell their owners what to revisit.

**Non-Goals:**
- A BMD writer or Austrian charts (report item 12); only the parts that affect the DATEV path (precise tax, clear failure for 10/13/20 %).
- Changing how apaleo books open-invoice payments (item 13); documented only.

## Decisions

1. **Precise amounts on the canonical line (defect 1).** `LedgerLine` keeps `grossCents` (whole cents, the sub-cent guard stays) and gains `netPrecise: string` and `LedgerTax.amountPrecise: string`, the source's decimal text. `netCents` and `amountCents` become the precise value rounded half away from zero (`decimalToCents`), so every existing cent-based rule keeps working. The apaleo parser builds the text with `String(number)` (shortest round-trip form; exact for apaleo's ≤ 8 decimals at hotel magnitudes) and checks `|gross − net − Σ taxes| ≤ 0.005`, else it fails naming the source entry (a consistency guard that replaces the sub-cent guard on net and tax). Precise sums use a new exact helper in `src/core/money.ts` (scaled `BigInt`, `sumDecimals`, `decimalToCents` reused), never floating point. *Alternative:* round net and tax at parse time only. Rejected: the per-rate comparison with apaleo's own VAT (defect 6) and the aggregate check on net revenue (defect 4) need the precise values.

2. **Per-line guard unchanged, on rounded tax.** The VAT guard compares DATEV's per-line VAT with `amountCents` (the rounded precise tax). On real data the difference is 0 per line; `W-VAT-ROUNDING` remains for sources that send already-rounded taxes (the BSP fixtures).

3. **VAT per rate: report the precise comparison, keep the check cent-exact (defect 6).** The posting summary gains, per rate and separately for revenue and deposits: DATEV VAT (sum of per-line VAT), apaleo VAT (precise sum, shown rounded to cents) and the difference. `E-VAT-TOTAL` keeps comparing DATEV's VAT computed from the bookings with the sum of apaleo's per-line tax rounded to cents, allowing one cent per `W-VAT-ROUNDING` at that rate; its message also names the precise apaleo total and the line-rounding difference `Σ rounded − precise`. The precise difference itself is never an error (it is bounded by half a cent per line and is how DATEV works); the protocol explains it in one sentence for the Kanzlei. *Alternative:* tolerance `lines × 0.5 cent` against the precise total. Rejected: it grows to euros over a month and would hide real defects that the cent-exact check catches.

4. **Resolver skips empty parent rows (defect 2).** In step 3 (parent chain) a row with an empty `datev_account` no longer ends the search; the walk continues to the next parent and then to the wildcard rows. An *exact* row (steps 1 and 2) with an empty DATEV account still means "unmapped", because the user listed that account on purpose. When nothing else applies, the empty parent row is returned so the finding can name it. This also makes v0.1.0 files with the empty `3000;Liabilities` row work without editing.

5. **Template version 2 (defects 2, 3, 10).** `skr03-hotel@2` / `skr04-hotel@2`:
   - `suggestRows` writes no row for a container account outside the global ledger (`hasChildren`) when its type has wildcard rules and no rule yields a DATEV account for it (`3000` Liabilities; `CollectiveDebitor_LossOfAccountsReceivable` once bad debt uses wildcards): the wildcards cover its per-reservation children, and one DATEV account cannot serve every rate.
   - LossOfAccountsReceivable rules at 7 % and 19 % become rate wildcards (`*`), like deposits, so per-reservation bad-debt accounts resolve without a row each (not seen in the recordings; same structure as Liabilities in the chart).
   - AccountsReceivable rule becomes a wildcard (`*`), so the file gets `*;AccountsReceivable;;;10000` besides the `CollectiveDebitor_AccountsReceivable` row; per-reservation debtor accounts and their `/Offset` resolve to the collective debtor.
   - New rules before the generic 7 % rule: `no-show|noshow|cancellation|storno` at 7 % → SKR03 8300 / SKR04 4300, comment: apaleo books it at 7 % (accommodation-related), so the DATEV account must apply 7 %; whether the fee is taxable at all is for the Kanzlei.
   - Rules for Revenues and Liabilities at 16 % and 5 %: empty DATEV account, comment "historischer Satz 01.07.–31.12.2020; apaleo legt das Konto in jedem Kontenplan an; leer lassen; bucht apaleo darauf, stoppt der Export (`E-UNMAPPED`), was für Leistungen nach 2020 richtig ist; Exporte für 2020 mit der Kanzlei klären". `init-mapping` counts these rows as "historical, left empty on purpose", not as rows to decide. *Alternative:* map them to 8300/8400 because DATEV applied 5/16 % on those Automatikkonten by Belegdatum in 2020. Rejected for v1: a 2026 export must never book at 16 %, and the guard would raise `E-VAT-RATE` anyway.
   - `init-mapping` adds `N-FOREIGN-VAT-RATES` when the chart has positive rates other than 5, 7, 16, 19 (VIE: 10, 13, 20, 4.9): the German templates and Automatikkonten do not cover them; Austrian properties need BMD.

6. **Hints and grouping (defects 2, 3).** `E-UNMAPPED` for accounts outside the chart with a parent is reported once per parent, type and rate ("5 per-reservation Liabilities accounts under 3000 at 7 %, e.g. …"), not once per reservation. The fix text names the parent row and its line when it exists and is empty, and proposes the wildcard row with the template account (`*;Liabilities;;7;1711;;7`, `*;AccountsReceivable;;;10000`). It never suggests filling a parent row for a VAT-relevant type.

7. **`init-mapping --update` migration notes.** Existing rows stay byte-identical (the guarantee of s04). `--update` appends new rows (including the new AR wildcard) and prints notes: `N-PARENT-ROW-EMPTY` for an empty parent row such as `3000;Liabilities` ("no longer blocks; you may delete it"), and `N-TEMPLATE-SUGGESTION` for each existing row with an empty DATEV account for which template v2 now has a suggestion (no-show and cancellation fees at 7 %), naming line and account. The header comment of an updated file is left alone.

8. **Aggregate comparison by balance (defect 4).** `compareAggregates` is rewritten:
   - key: a side whose account is a global chart account uses its own number; any other side (guest, external, booking, per-reservation, `/Offset`) uses its main account (`ChartIndex.mainAccountOf`); several ledgers with the same number are added up as before;
   - amount: `netPrecise` for Revenues and Liabilities, gross for every other type;
   - VAT: each tax entry of a line with a Revenues side is added to the chart's `Vat` account of the same VAT type and percent, of a Liabilities side to the `VatOnLiabilities` account, signed like that side;
   - comparison: balance (debit − credit, signed sums), both sides rounded to cents only at the end; equal is a match. Debit and credit are still shown for information.
   `W-AGGREGATE-DIFF` names the account, apaleo's balance, the ledger balance and the basis (gross, net or tax). `live-smoke` prints the same table and "N of M accounts match". Verified: 18 of 18 (BER) and 19 of 19 (VIE) on 2026-10-21, and all on 2026-10-22. The BSP fixtures' aggregate files are rewritten in the real shape.

9. **Deposits by side and sign (defect 5).** A Liabilities side increases the deposit balance when it is credited with a positive or debited with a negative amount, and decreases it otherwise. `deposits` becomes `{ receivedCents, releasedCents, refundedCents }`, all unsigned: decreases whose other side is a Payments account are refunds and also count in `releasedCents` ("released 352.00, of it refunded 10.00"). Release inference (`isUntaxedRelease`, `depositDirection`) already handles both shapes and is left as is; the live-smoke question is rephrased to count received, released and refunded lines with and without `taxes[]`.

10. **German booking texts (defect 7).** `buchungstext` picks the label from command, sign and the account types, then a German account label:
    - revenue: `Erlös` (positive credit) / `Erlösminderung` (negative or debit) + label; apaleo's standard groups get German labels (`RevenueAccommodation` → `Logis`, `RevenueFoodAndBeverages` → `Speisen und Getränke`, `RevenueNoShow` → `No-Show`, `RevenueCancellationFees` → `Stornogebühr`, `RevenueOther` → `Sonstige Erlöse`) plus the rate (`Erlös Logis 7 %`); other accounts keep their own name without apaleo's English prefix `Revenues `;
    - deposits: `Anzahlung` (increase via payment), `Umbuchung Anzahlung` (increase from a folio), `Auflösung Anzahlung` (decrease against a folio), `Erstattung Anzahlung` (decrease via payment), each followed by the rate (`Auflösung Anzahlung 7 %`);
    - payments: `Zahlung` / `Erstattung` (negative) + payment label: card brands stay (`Visa`, `Amex`, `Mastercard`, `Girocard`), English generic names are translated (`Cash Payment` → `Bar`, `Bank Transfer` → `Überweisung`, `Direct Debit` → `Lastschrift`, `Voucher Payment` → `Gutschein`, `Other Payment` → `Sonstige`), and suffixes `Credit Card Payment`, `Debit Card Payment`, `Card Payment`, `Payment` are dropped (`Visa Debit`);
    - AR transfer `Forderung an Debitor`; guest-account labels unchanged (`Gastforderung`, `Debitor`, `Anzahlung Gast`), still never a guest's name.
    A test on the live fixture asserts no Buchungstext contains `Revenues`, `Payment`, `Liabilities`, `Receivables` or `Credit Card`.

11. **Manifest totals (defect 8).** In DATEV each booking adds its amount once to Soll and once to Haben, so the Kanzlei sees Summe Soll = Summe Haben after import. `sollTotal` and `habenTotal` both become the sum of all booking amounts (what DATEV shows), and a new `amountTotal` holds the same value under an unambiguous name. The old per-flag sums are dropped. Documented in `docs/export.md` and the CHANGELOG as a change of meaning.

12. **Skipped lines unsigned (defect 9).** `SkippedTotal.grossCents` becomes the sum of absolute gross amounts, the basis `E-CONSERVATION` already uses; the protocol column reads `gross (unsigned)`. BER: 6 lines, 331.60.

13. **Empty day in live-smoke (defect 11).** With 0 ledger lines the run still exits 0 (every step worked) but prints `WARN  ledger: no lines on <day>` and the result line `passed, but <day> has no bookings, so nothing about the postings was checked; run again with --date <a day with bookings>`.

14. **Regression fixtures.** `test/fixtures/apaleo/live/` receives, unwrapped to the bare response body plus a `README.md` naming origin, date and the scan: `BER|VIE` `accounts-schema.json`, `export-gross-daily/2026-10-21.json`, `2026-10-22.json`, `aggregate-daily/2026-10-21.json`, `2026-10-22.json`. Folios are not copied. Before copying, a scan rejects any key or value matching token/secret/bearer/password/email patterns and any account name outside the known `… for Reservation|Folio <id>` forms; names, emails and addresses would be stripped if present (none were found while writing this design). `mapping-BER.live.csv` is generated by `init-mapping --skr 03` (template v2) on the BER chart and committed, with only the no-show/cancellation suggestions accepted as the template proposes. Tests run the full pipeline (adapter on a fake fetch, posting, checks, writer) on BER 2026-10-21 and assert the hand-checked totals; a VIE test asserts a clean `E-UNMAPPED` on 13 %/10 %/20 % rows instead of a parse error, and the aggregate test asserts all accounts match for both properties and days. The fixture validation test also runs the live files against the Swagger excerpt.

## Risks / Trade-offs

- [`String(number)` loses digits for amounts with more than ~15 significant digits] → apaleo sends 8 decimals on hotel-sized amounts (< 10^7); the consistency check `gross = net + Σ taxes` fails loudly if a value were ever mangled.
- [The aggregate rule is inferred from one sandbox and two days] → It held on every account of both properties and both days, including refunds, releases and AR; differences stay warnings and the file is still written.
- [Changing `sollTotal`/`habenTotal` meaning breaks a script that read them] → No known consumer; CHANGELOG flags it; `amountTotal` is the stable name.
- [Booking texts change, so re-exporting an already exported month yields `E-FILE-EXISTS`] → Expected for v0.1.0 files that could only exist from fixtures or the demo; the CHANGELOG tells users to use `--overwrite` only after the Kanzlei removed the old batch.
- [Template v2 suggestions for no-show and cancellation fees could be taken as tax advice] → Comment states that apaleo's rate decides the DATEV rate and the Kanzlei decides taxability; the disclaimer stays.
- [Skipping empty parent rows could hide an intentional "block everything under 3000" row] → Exact rows still block; a parent row was never a reliable blocker because wildcards for VAT types are needed anyway.

## Migration Plan

- Existing mapping files keep working: the empty `3000` row no longer blocks. Owners run `init-mapping --property <id> --skr 03|04 --update`, which appends the AccountsReceivable wildcard and prints `N-PARENT-ROW-EMPTY` / `N-TEMPLATE-SUGGESTION` notes; nothing existing is rewritten.
- No config changes. Output folders, file names and the manifest schema stay; only the meaning of two manifest totals and the booking texts change.
- Rollback: check out v0.1.0 (it cannot read real data anyway).

## Open Questions

- Whether apaleo production (not DEV) sends the same shapes; live-smoke keeps asking and the regression fixtures can grow.
- Whether apaleo properties with `performAccountingForOpenInvoiceActions: true` book invoice payments as `PostPayment` against AccountsReceivable; documented as unknown until a recording exists.
