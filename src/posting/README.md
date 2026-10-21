# src/posting

Posting rules that turn ledger lines into DATEV bookings. PMS-neutral; must not import from `src/sources/` (enforced by lint). Rules and codes: [docs/posting-rules.md](../../docs/posting-rules.md).

- `build.ts`: `buildBookings(lines, mapping, chart, options)`, the pure entry point; resolution, skip rules and the direction rule (VAT side to Gegenkonto).
- `guard.ts`: the VAT consistency guard per line.
- `release.ts`: rate inference for deposit releases without `taxes[]` (`PostPrepaymentVat` pair, then chart) and for untaxed deposit refunds and receipts with a matching pair, also used by `mapping check --from --to`.
- `taxes.ts`: tax normalisation and DATEV's VAT computation.
- `fields.ts`: Belegfeld 1, Buchungstext without guest names, KOST1/KOST2.
- `summary.ts`: the posting summary.
