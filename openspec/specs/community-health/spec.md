# community-health Specification

## Purpose
The files that let others contribute safely: contribution guide, code of conduct, security policy, changelog, GitHub issue forms and pull-request template, and the repository description and topics for discoverability once the repository is public.
## Requirements
### Requirement: Contribution and conduct files
The repository SHALL contain, in German, `CONTRIBUTING.md` (`## Einrichtung`, `## Skripte`, OpenSpec workflow including `openspec archive`, Conventional Commits, the rule that fixtures contain no real guest data and that contributed apaleo responses are anonymised, and the rule that code, identifiers and commit messages stay English while English issues and pull requests are welcome), `CODE_OF_CONDUCT.md` (the official German translation of the Contributor Covenant 2.1, verbatim, with the project contact filled in) and `SECURITY.md` (private reporting through a GitHub security advisory, supported versions, no bounty).

#### Scenario: Security report
- **WHEN** someone finds a vulnerability
- **THEN** `SECURITY.md` tells them in German to report it **vertraulich** through a private GitHub security advisory and not in a public issue

#### Scenario: Code of conduct is the official translation
- **WHEN** `pnpm test` runs
- **THEN** it asserts that `CODE_OF_CONDUCT.md` names the Contributor Covenant, version 2.1, and has the headings of the official German translation (Unsere Verpflichtung, Unsere Standards, Verantwortlichkeiten bei der Durchsetzung, Geltungsbereich, Durchsetzung, Durchsetzungsrichtlinien, Bezug)

### Requirement: Changelog
The repository SHALL contain `CHANGELOG.md` in German in the Keep a Changelog format (German edition, `https://keepachangelog.com/de/1.1.0/`) with a `## [Unveröffentlicht]` section that lists the user-visible changes since the last version, using the German section names (Hinzugefügt, Geändert, Entfernt, Behoben). Entries SHALL be German; command names, flags and file names in them SHALL stay unchanged.

#### Scenario: Unreleased section
- **WHEN** this slice is merged
- **THEN** `## [Unveröffentlicht]` has a `### Geändert` entry saying that README and docs are now German with a short `README.en.md`, and `## [0.1.0] - 2026-10-21` lists under `### Hinzugefügt`, in German, the features of slices s01 to s08 including `export --demo`, `schedule --once`, `init-mapping`, `live-smoke`, `--dry-run` and Docker

### Requirement: Issue and pull-request templates
The repository SHALL provide German GitHub issue forms for bug reports (`Fehlerbericht`, asking for tool version, command, finding codes and anonymised output, and warning not to paste secrets or guest data), feature requests (`Funktionswunsch`), and new source or target requests (`Neue Quelle oder neues Zielformat`), and a German pull-request template with a checklist for tests, documentation, secrets and personal data. Form field ids SHALL stay unchanged.

#### Scenario: Bug report form
- **WHEN** a user opens a new bug report
- **THEN** the form asks in German for version, command and finding codes and shows "**Füge nie Secrets oder Gästedaten ein.**" with a link to `SECURITY.md`

### Requirement: Repository description and topics
The repository description and topics SHALL be set for discoverability (including apaleo, datev, datev-export, buchungsstapel, extf, hotel, hospitality, accounting, buchhaltung, steuerberater, skr03, skr04) without changing the repository visibility, and SHALL NOT be changed by translating the docs. `docs/maintainers.md` SHALL state in German that discoverability only takes effect once the maintainer makes the repository public and SHALL contain a `## Vor der Veröffentlichung` checklist (visibility, social preview, Discussions, first release tag).

#### Scenario: Metadata applied
- **WHEN** the slice is merged
- **THEN** `gh repo view --json description,repositoryTopics,visibility` shows the same description and topics as before and the visibility is still private

#### Scenario: Going public later
- **WHEN** the maintainer decides to publish the repository
- **THEN** `docs/maintainers.md` lists the steps in order under `## Vor der Veröffentlichung`, and none of them was done by this slice

