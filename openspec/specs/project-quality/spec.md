# project-quality Specification

## Purpose
The project's quality baseline: build, test, lint and typecheck scripts, the boundary that keeps PMS-neutral core modules free of source adapters, continuous integration, the licence and disclaimer, and protection against accidental publishing.
## Requirements
### Requirement: Quality scripts
The project SHALL provide `pnpm build`, `pnpm test`, `pnpm lint` and `pnpm typecheck` scripts, and all four SHALL pass on a fresh clone after `pnpm install --frozen-lockfile`.

#### Scenario: Fresh clone is green
- **WHEN** a contributor clones the repository, runs `pnpm install --frozen-lockfile` and then the four scripts
- **THEN** every script exits with code 0

### Requirement: Core modules do not depend on source adapters
The lint configuration SHALL fail when code under `src/core`, `src/datev`, `src/mapping` or `src/posting` imports from `src/sources/`.

#### Scenario: Forbidden import is caught
- **WHEN** a file in `src/datev` imports a module from `src/sources/apaleo`
- **THEN** `pnpm lint` reports a `no-restricted-imports` error and exits non-zero

### Requirement: Continuous integration
A GitHub Actions workflow SHALL run on every push and pull request, install with a frozen lockfile on Node.js 24, and run typecheck, lint, test, build and a `--help` smoke test of the built CLI, without using any repository secrets.

#### Scenario: Pull request check
- **WHEN** a pull request is opened against `main`
- **THEN** the CI workflow runs all checks and reports them as status checks on the pull request

#### Scenario: Merge only when checks are green
- **WHEN** a pull request is about to be merged
- **THEN** the merge is gated on `gh pr checks <number> --watch --fail-fast` exiting 0, and the pull request is merged only after that. While the repository is private, GitHub branch protection and rulesets are not available on the free plan, so GitHub itself does not block a red pull request; the gate is the documented merge step in CONTRIBUTING.md and docs/maintainers.md and in the automated slice workflow

### Requirement: Licence and disclaimer files
The repository SHALL contain an MIT `LICENSE` (English original text) and a `DISCLAIMER.md` whose German text comes first and is binding ("Verbindlich ist die deutsche Fassung."), followed by a section `## English (non-binding translation)`. Both versions SHALL state that the software is provided as is, without warranty or liability, that it is not tax or legal advice, and that a Steuerberater must review the account mapping and the first DATEV imports. `README.md` and `README.en.md` SHALL link both files.

#### Scenario: Licence and disclaimer are checked by a test
- **WHEN** `pnpm test` runs
- **THEN** a test asserts that `LICENSE` and `DISCLAIMER.md` exist at the repository root, that `README.md` and `README.en.md` link to both, that `DISCLAIMER.md` starts with `# Haftungsausschluss`, and that the German text with "ohne ausdrückliche oder stillschweigende Gewährleistung", "haften", "keine Steuerberatung" and "Kontenzuordnung" comes before the English translation with "without warranty", "not liable", "not tax advice" and "must review the account mapping"

#### Scenario: German text is binding
- **WHEN** a reader compares the German and English disclaimer
- **THEN** the file says that the German version is binding and the English one is a translation

### Requirement: No accidental publishing
`package.json` SHALL set `"private": true` so that `pnpm publish` refuses to publish the package.

#### Scenario: Publish attempt
- **WHEN** someone runs `pnpm publish` in the repository
- **THEN** the package manager refuses because the package is private

