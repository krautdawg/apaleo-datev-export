## MODIFIED Requirements

### Requirement: Docs folder
The repository SHALL contain, in German, `docs/setup-apaleo.md` (custom app creation with the exact permissions, the optional one marked `optional`), `docs/mapping-guide.md` (columns, resolution order, VAT guard, city tax, deposits, payments, and a last section `## Checkliste zur Freigabe durch die Kanzlei`), `docs/datev-import.md`, `docs/configuration.md`, `docs/docker.md`, `docs/troubleshooting.md`, `docs/architecture.md`, `docs/maintainers.md` (`## Vor der Veröffentlichung` checklist and `## Später geplant` backlog), `docs/datev-format.md`, `docs/posting-rules.md`, `docs/export.md`, `docs/apaleo-source.md` and `docs/examples/README.md`. The mapping guide SHALL explain that VAT rates depend on the service date (Speisen 7 % for services from 2026-01-01, 19 % before) and SHALL list every template row marked `Vorschlag (ungeprüft)`. Every link to a former `.de.md` file SHALL point to the main file name. The docs SHALL describe apaleo as tested live:
- `docs/setup-apaleo.md` SHALL follow the real screens: **Apps > Connected apps**, **Add a new app**, **Add custom app**, the page **New simple client**, the required field **Secret description**, a fine-grained client, property access **All properties** or **Only selected properties**, permissions picked through **Search permission**, and the PII options **Retrieve**, **Omit linked** and **Omit all**, recommending **Omit all** (tested live: the export needs no personal data);
- `docs/apaleo-source.md` SHALL say that net and tax amounts arrive with up to eight decimals and are kept precise, that only the gross amount must be whole cents, and SHALL record the answers of the first live test (per-reservation accounts with `parentNumber`, releases as negative charges with `taxes[]`, no `PostPrepaymentVat` lines, aggregates by balance on leaf global accounts and guest parents);
- `docs/mapping-guide.md` SHALL explain the `/Offset` accounts (the second line of every payment and AR transfer, mapped through the parent to the same DATEV account and skipped as `SAME_ACCOUNT`), that an empty parent row no longer blocks the wildcards, the AccountsReceivable wildcard to the collective debtor, the no-show and cancellation-fee suggestions, the historical 16 %/5 % rows of 2020, and that Austrian properties (10 %, 13 %, 20 %) are outside the DATEV templates;
- `docs/posting-rules.md` SHALL describe the real deposit shapes (prepayment, release as negative charge, refund, overpayment parked at 0 %), the classification by side and sign, the German booking texts, and that a payment on an invoice through apaleo's invoice actions creates no ledger line while the apaleo setting `performAccountingForOpenInvoiceActions` is false, so the debtor stays open in DATEV until the Kanzlei books the bank receipt against it;
- `docs/export.md` SHALL explain the VAT comparison in the protocol (DATEV per booking, apaleo precise per day) and that `sollTotal`, `habenTotal` and `amountTotal` in `manifest.json` are the same sum.

#### Scenario: Steuerberater review
- **WHEN** a Steuerberater reads the mapping guide and a mapping CSV
- **THEN** they can decide each row without running the tool, and the guide ends with the sign-off checklist

#### Scenario: Contributor adds a source
- **WHEN** a contributor wants to add a Smoobu source
- **THEN** `docs/architecture.md` explains in German the SourceAdapter contract, the canonical ledger line (`LedgerLine`) and where tests and fixtures go

#### Scenario: Former German file names
- **WHEN** someone looks for `docs/setup-apaleo.de.md` or `docs/mapping-guide.de.md`
- **THEN** neither exists, and the README and every doc link `docs/setup-apaleo.md` and `docs/mapping-guide.md`

#### Scenario: Hotel admin creates the app
- **WHEN** a hotel admin follows `docs/setup-apaleo.md` in apaleo
- **THEN** every button and field name in the guide (`Add a new app`, `Add custom app`, `New simple client`, `Secret description`, `Search permission`, `Omit all`) appears on the screens in that order, and the guide recommends `Omit all`

#### Scenario: Open debtor after an invoice payment
- **WHEN** the Kanzlei sees the collective debtor 10000 still open although the guest paid the invoice in apaleo
- **THEN** `docs/posting-rules.md` and `docs/troubleshooting.md` explain the `performAccountingForOpenInvoiceActions` setting and what to do

#### Scenario: Stale wording removed
- **WHEN** `docs/apaleo-source.md` is read after this change
- **THEN** it no longer says that a net or tax amount off a whole cent stops the export
