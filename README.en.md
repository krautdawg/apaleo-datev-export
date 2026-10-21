# apaleo-datev-export

**Deutsch:** [README.md](README.md)

Free, open-source export from the apaleo hotel PMS to DATEV-Format (EXTF) Buchungsstapel files that your Steuerberater imports into DATEV Rechnungswesen. It reads the apaleo ledger of a month through a read-only apaleo custom app, books every line with an account mapping per property (SKR03 and SKR04 hotel templates), checks that DATEV will compute exactly the VAT apaleo charged, and writes one file per property and month. It runs on your own machine or in a locally built Docker container. No subscription, no hosted service.

> **No warranty, not tax advice.** Your Steuerberater must review the account mapping and the first DATEV imports. Read the [disclaimer](DISCLAIMER.md) (the German text is binding, an English translation follows it).

## Quick start

There is no npm package or container image release yet. You install from source.

1. Create an apaleo custom app (Apps > Connected apps > Add custom app, simple client) with the permissions in [docs/setup-apaleo.md](docs/setup-apaleo.md).
2. Install (needs Node.js 24 and git):

   ```sh
   git clone https://github.com/krautdawg/apaleo-datev-export.git
   cd apaleo-datev-export
   corepack enable
   pnpm install --frozen-lockfile
   pnpm build
   node dist/cli/main.js --help
   ```

   The commands below use `apaleo-datev`. Without `pnpm link --global`, type `node dist/cli/main.js` instead.

3. Try it on the bundled demo data, without apaleo: `node dist/cli/main.js export --month 2026-09 --demo --dry-run`.
4. Copy `apaleo-datev.config.example.yaml` to `apaleo-datev.config.yaml`, fill it in, and set the secret in the environment (`APALEO_CLIENT_SECRET`), never in the file. Then create the mapping, have your Steuerberater check it, and export:

   ```sh
   apaleo-datev init-mapping --property BSP --skr 03
   apaleo-datev export --month 2026-09 --dry-run
   apaleo-datev export --month 2026-09
   ```

## Documentation (German)

The documentation is written in German for hotels and Steuerberater in Germany and Austria:

- [README.md](README.md): overview, quick start, Docker, comparison, FAQ
- [docs/setup-apaleo.md](docs/setup-apaleo.md): the apaleo custom app and its permissions
- [docs/mapping-guide.md](docs/mapping-guide.md): the account mapping, for the Steuerberater
- [docs/datev-import.md](docs/datev-import.md): importing the file into DATEV
- [docs/configuration.md](docs/configuration.md), [docs/docker.md](docs/docker.md), [docs/troubleshooting.md](docs/troubleshooting.md)
- [docs/architecture.md](docs/architecture.md): modules and how to add a source or target

## Contributing

Issues and pull requests in English are welcome. Code, identifiers, CLI output and commit messages are English. Read [CONTRIBUTING.md](CONTRIBUTING.md) (German) and [SECURITY.md](SECURITY.md) first; fixtures never contain real guest data.

## Licence

[MIT](LICENSE). Not affiliated with apaleo GmbH or DATEV eG.
