# documentation Specification

## Purpose
The German README with a short English `README.en.md`, the German guides in `docs/`, the example output in `docs/examples/`, the `export --demo` mode that shows the output without apaleo, and the test that keeps commands, flags, config keys, finding codes, links, anchors and the language of the docs in line with the code.
## Requirements
### Requirement: README first screen
The README SHALL be German. Its first line SHALL be the H1 and SHALL contain "apaleo DATEV Export", "kostenlos" and "Open Source". The first non-empty line after the H1 SHALL link `README.en.md`. Then, before any installation detail, the README SHALL show the German tagline "Kostenloser apaleo DATEV Export: Buchungsstapel (EXTF) für DATEV Rechnungswesen, Open Source", CI, licence and Node.js badges, an intro paragraph that names `apaleo-datev-export`, the notice "Keine Gewähr, keine Steuerberatung" with "Lass deine Kontenzuordnung von deiner Steuerberatung prüfen" linking `DISCLAIMER.md`, and a `## Was es macht` list with five items.

#### Scenario: Visitor from a search
- **WHEN** someone opens the repository page
- **THEN** the first screen states in German that the tool is a free, open-source apaleo DATEV Export that writes DATEV EXTF files, shows the disclaimer notice and links the English README

#### Scenario: Search terms in the first lines
- **WHEN** the title, tagline and intro paragraph are scanned
- **THEN** they contain apaleo, DATEV, DATEV-Export, Buchungsstapel, EXTF, DATEV-Format, SKR03, SKR04, Steuerberater, Hotel, Open Source and kostenlos

### Requirement: Quick start that works
The README SHALL contain a `## Schnellstart` with five numbered steps labelled "apaleo Custom App anlegen.", "Installieren", "Kontenzuordnung anlegen", "Probelauf" and "Export" (create the apaleo custom app; install from source with `git clone`, `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm build`; then `init-mapping`, `export --dry-run`, `export`), and a `## Schnellstart mit Docker` that builds the image locally with `docker compose -f docker-compose.example.yml build`. It SHALL contain the sentence "Es gibt noch kein npm-Paket und kein Container-Image zum Herunterladen. Du installierst aus dem Quellcode.", SHALL NOT show `npx` or `docker pull` (nor shall `README.en.md`), and every command shown SHALL exist in the CLI. CI SHALL run the install block marked `<!-- quickstart -->` in `README.md` verbatim up to `--help` and then the demo dry run.

#### Scenario: Install commands run in CI
- **WHEN** the `readme-quickstart` CI job runs
- **THEN** it executes the German README's quick-start install block, `node dist/cli/main.js --help` exits 0, and `node dist/cli/main.js export --month 2026-09 --demo --dry-run` prints a posting summary and exits 0 without network or credentials

#### Scenario: No dead-end install step
- **WHEN** `README.md` and `README.en.md` are scanned
- **THEN** they contain no `npx apaleo-datev` and no `docker pull`, and each contains its sentence that there is no npm or registry release yet

### Requirement: Example output and demo mode
The repository SHALL contain `docs/examples/` with a golden EXTF file, its protocol text and a filled sample mapping CSV for "Hotel Beispiel", linked from the README and the mapping guide, and `apaleo-datev export --demo` SHALL run the pipeline on bundled demo data with no config, secret or network, marking its output as demo.

#### Scenario: Kanzlei reviews before setup
- **WHEN** a Steuerberater opens `docs/examples/`
- **THEN** they find an EXTF file, its protocol and the mapping that produced it, and a test guarantees the EXTF file equals the current golden output

#### Scenario: Demo without credentials
- **WHEN** someone runs `apaleo-datev export --month 2026-09 --demo --dry-run` with no config file and no `APALEO_CLIENT_SECRET`
- **THEN** the summary is printed with a `DEMO` marker, no network call is made, and the exit code is 0

#### Scenario: Demo file is marked in its name
- **WHEN** someone runs `apaleo-datev export --month 2026-09 --demo` without `--dry-run`
- **THEN** the file is written below `./demo-output/` with `_DEMO` after the property id in its name, `DEMO` in its Bezeichnung and a `DEMO` first line in its protocol, so it never looks like a real export in a file list

#### Scenario: Demo in the Docker image
- **WHEN** someone runs the real demo in the image with `-w /data` and a data folder owned by uid 1000, as docs/docker.md shows
- **THEN** the files appear in that folder under `demo-output/`, and CI runs exactly that; without a writable working directory the run fails with `E-EXPORT` and a hint naming `-w /data`

### Requirement: Honest scope and comparison
The README SHALL include a `## Was es nicht macht` section (no transfer to DATEV online, no Debitoren-Stammdaten, no postings of payment-provider fees or booking-portal commissions, no Weboberfläche, no gehosteter Dienst) and a `## Vergleich mit kostenpflichtigen Connectoren` section that names no vendor, cites prices "laut apaleo Store, Oktober 2026", and states the trade-offs of self-hosting ("Selbst betreiben heißt").

#### Scenario: Comparison table
- **WHEN** a reader looks at the comparison
- **THEN** it shows Preis, Betrieb, Einrichtung, Übertragung an DATEV online, Support and Vorlagen für die Zuordnung for both options and contains no vendor or product name of a competitor

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

### Requirement: Docs consistency test
The test suite SHALL check `README.md`, `README.en.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `DISCLAIMER.md`, `CHANGELOG.md`, every Markdown file in `docs/` and `examples/demo/README.md`. It SHALL fail when one of them contains, inside an `sh` or `bash` code fence, an `apaleo-datev` command line whose command is not registered or whose flag is not in that command's options; when it contains a backticked token matching `^(apaleo|datev|output|posting|properties|schedule|checks)(\.[A-Za-z\[\]]+)+$` that is not a config schema path; when a finding code (`[EWN]-[A-Z-]+`) used in the source is missing from `docs/troubleshooting.md` or a documented code no longer exists in the source; when a relative link outside code fences points to a missing file or to an anchor that is not a heading slug of its target (GitHub slug rules, umlauts kept); when a `*.de.md` file exists outside `node_modules/`, `dist/` and `openspec/`; when the prose of a German file is not predominantly German; or when a German file other than `CODE_OF_CONDUCT.md` addresses the reader with "Sie".

#### Scenario: Renamed command
- **WHEN** a command is renamed in code but not in the README
- **THEN** `pnpm test` fails and names the stale mention and the file

#### Scenario: Stale flag
- **WHEN** `docs/datev-import.md` shows ```` ```sh ```` `apaleo-datev export --month 2026-10 --email` and `export` has no `--email` option
- **THEN** `pnpm test` fails naming `--email`, the command and the file

#### Scenario: Stale config key
- **WHEN** `docs/configuration.md` mentions `` `posting.aggregate` `` and the schema has no such key
- **THEN** `pnpm test` fails naming `posting.aggregate` and the file

#### Scenario: Other backticked text is ignored
- **WHEN** a doc mentions `` `EXTF_` ``, `` `1360` `` or `` `Revenues` ``
- **THEN** the test does not treat them as config keys or commands

#### Scenario: Broken anchor after translation
- **WHEN** the README links `docs/docker.md#the-demo-in-the-image` and that heading is now `### Die Demo im Image`
- **THEN** `pnpm test` fails naming the README, the link and the missing anchor, and passes once the link is `docs/docker.md#die-demo-im-image`

#### Scenario: Umlaut anchor
- **WHEN** a doc links `../README.md#häufige-fragen` and the README has `## Häufige Fragen`
- **THEN** the link check passes

#### Scenario: English paragraph in a German doc
- **WHEN** `docs/troubleshooting.md` is left in English
- **THEN** `pnpm test` fails naming the file as not German, and `README.en.md` is the only checked file expected to be English

### Requirement: German-first documentation
The README and every user-facing document SHALL be written in German only: `README.md`, every Markdown file in `docs/` (including `docs/examples/README.md`), `examples/demo/README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `DISCLAIMER.md`, `CHANGELOG.md`, the issue forms and the pull-request template in `.github/`, and the comments in `apaleo-datev.config.example.yaml`, `.env.example` and `docker-compose.example.yml`. The text SHALL address the reader with "du", SHALL use German words where a common one exists, and SHALL use DATEV and accounting terms as German practitioners do (Buchungsstapel, Kontenrahmen, Gegenkonto, BU-Schlüssel, Kontenzuordnung, Steuerberater or Kanzlei). Source code, identifiers, CLI output, commit messages, `LICENSE`, `src/**/README.md` and the OpenSpec specs SHALL stay English, and commands, flags, config keys, finding codes and quoted CLI output SHALL appear unchanged. No topic SHALL be documented in two languages, except `README.en.md` and the non-binding English translation in `DISCLAIMER.md`; there SHALL be no `*.de.md` files.

#### Scenario: Hotel reads a guide
- **WHEN** a hotel back office opens any file in `docs/`
- **THEN** the text is German, uses "du", and every command and config key in it is the one the CLI accepts

#### Scenario: Guide in two languages is rejected
- **WHEN** someone adds `docs/docker.de.md` or an English section to a German doc
- **THEN** `pnpm test` fails, naming the `.de.md` file or the file whose prose is not German

#### Scenario: Polite address is rejected
- **WHEN** a German doc contains "Prüfen Sie die Datei" or "Ihre Kanzlei"
- **THEN** `pnpm test` fails naming the file, while "Sie prüft die Datei" at the start of a sentence passes

#### Scenario: Code stays English
- **WHEN** the German docs are merged
- **THEN** no file under `src/` changed, the example config files changed only in comments, and the CLI prints the same output as before

### Requirement: Short English README
The repository SHALL contain `README.en.md` of at most 80 lines with: what the tool is, the disclaimer linking `DISCLAIMER.md`, a quick start with the same install commands as the German README and the sentence "There is no npm package or container image release yet. You install from source.", a list of the German guides, a contributing note that English issues and pull requests are welcome, and the licence linking `LICENSE`. It SHALL NOT contain the `<!-- quickstart -->` marker.

#### Scenario: International contributor
- **WHEN** an English-speaking developer opens the repository and follows the "English" link at the top of the README
- **THEN** `README.en.md` tells them what the tool does, how to install it from source, that the docs are German, and how to contribute

#### Scenario: English README stays short and in step
- **WHEN** `pnpm test` runs
- **THEN** it fails if `README.en.md` exceeds 80 lines, contains the quickstart marker, or lists install commands that differ from the German quick-start block apart from shell comments

