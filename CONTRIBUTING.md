# Mitmachen

Danke, dass du helfen willst. Dieses Projekt ist ein Geschenk an Hotels und ihre Steuerberatung: klein, lesbar und nachprüfbar. Fehlermeldungen, Korrekturen, Dokumentation, Wissen über die Kontenzuordnung und neue Quellen oder Zielformate sind alle willkommen.

Die Dokumentation ist deutsch. Code, Bezeichner, Kommentare im Code, Ausgaben der Kommandozeile und Commit-Nachrichten bleiben auf Englisch, damit auch Mitwirkende ohne Deutsch den Code lesen können. Issues und Pull Requests auf Englisch sind genauso willkommen wie auf Deutsch.

Mit deinem Beitrag stimmst du zu, dass er unter der [MIT-Lizenz](LICENSE) steht, und du hältst dich an den [Verhaltenskodex](CODE_OF_CONDUCT.md).

## Einrichtung

Du brauchst Node.js 24 (siehe `.nvmrc`) und git. pnpm kommt über corepack.

```sh
git clone https://github.com/krautdawg/apaleo-datev-export.git
cd apaleo-datev-export
corepack enable
pnpm install --frozen-lockfile
pnpm test && pnpm lint && pnpm typecheck && pnpm build
node dist/cli/main.js export --month 2026-09 --demo --dry-run
```

Für die Entwicklung brauchst du kein apaleo-Konto: Die Tests laufen gegen erfundene Testdaten, und `--demo` lässt den ganzen Export auf ihnen laufen.

## Skripte

| Skript | Was es macht |
|---|---|
| `pnpm test` | Vitest: Unit-Tests, Golden Files, vollständige Läufe über `runCli`, der Docs-Test |
| `pnpm lint` | ESLint, mit den Regeln für die Modulgrenzen und den `CommandContext` |
| `pnpm typecheck` | TypeScript im strengen Modus, für `src` und `test` |
| `pnpm build` | übersetzt `src` nach `dist` |
| `UPDATE_GOLDEN=1 pnpm test` | schreibt die Golden Files nach einer gewollten Änderung der Ausgabe neu; prüfe den Diff |

Die CI führt alle bei jedem Push und jedem Pull Request aus, dazu die Installationsbefehle aus dem README, den Probelauf der Demo und einen lokalen Docker-Build.

## Wie eine Änderung entsteht: OpenSpec

Jedes Stück Arbeit ist eine OpenSpec-Änderung in `openspec/changes/<name>/`: ein kurzer Vorschlag (warum, was, was nicht), ein Design, Spezifikationen mit Szenarien und eine Liste von Aufgaben. Die angenommenen Spezifikationen liegen in `openspec/specs/`.

1. Für alles, was größer ist als ein Tippfehler oder ein offensichtlicher Fehler, eröffne zuerst ein Issue, damit wir uns über den Umfang einig sind.
2. Schreib die Änderung (`openspec new change <name>`) und prüfe sie mit `openspec validate <name> --strict`.
3. Setze die Aufgaben um, mit einem Test für jedes Szenario. Halte `pnpm test`, `pnpm lint` und `pnpm typecheck` grün.
4. Wenn sie fertig ist, archiviere sie: `openspec archive <name> -y`, dann `openspec validate --specs --strict`.

Wie der Code aufgebaut ist und wie du eine Quelle oder ein Zielformat hinzufügst: [docs/architecture.md](docs/architecture.md).

## Regeln für den Code

- Befehle bekommen Uhr, Netz, Dateisystem und Umgebung nur aus dem `CommandContext` (`ctx.now()`, `ctx.fetchFn`, `ctx.fs`, `ctx.env`); Lint setzt das durch. Tests nutzen `createTestContext()`.
- `core`, `datev`, `mapping` und `posting` importieren nie aus `src/sources/`.
- Geld sind ganze Cent. Nie Gleitkommazahlen.
- Jede Prüfung meldet einen `Finding` mit Code. Ein neuer Code braucht eine Zeile in `docs/troubleshooting.md`.
- Ein neuer Befehl, eine neue Option oder ein neuer Konfigurationsschlüssel wird im README oder in `docs/` beschrieben, auf Deutsch. Der Docs-Test schlägt fehl, wenn ein beschriebener Befehl, eine Option, ein Konfigurationsschlüssel oder ein Befund-Code im Code nicht existiert, wenn ein Link ins Leere zeigt oder wenn ein Text nicht deutsch ist.
- Halte die Abhängigkeiten zur Laufzeit klein. Besprich eine neue zuerst im Issue.

## Commits und Pull Requests

- [Conventional Commits](https://www.conventionalcommits.org/de/v1.0.0/), auf Englisch: `feat(export): ...`, `fix(mapping): ...`, `docs: ...`, `test: ...`, `chore: ...`.
- Ein Thema pro Pull Request. Füll die Checkliste der Vorlage für Pull Requests aus.
- Führe nur zusammen, wenn die CI grün ist: `gh pr checks <number> --watch --fail-fast && gh pr merge <number> --squash`.

## Testdaten und personenbezogene Daten

- **Niemals echte Gästedaten committen**: keine Gästenamen, E-Mail-Adressen, Reservierungsnummern, Rechnungsnummern oder echten Beträge aus einem Hotel. Testdaten sind erfunden („Hotel Beispiel“) oder vollständig anonymisiert.
- **Anonymisiere apaleo-Antworten**, bevor du sie beisteuerst: Ersetze Namen, Nummern von Reservierungen und Folios, Belegnummern, Namen der Hotels und Beträge, und lass die Struktur genau so, wie apaleo sie geschickt hat. Beschreib den Tag in der `README.md` des Ordners mit den Testdaten.
- **Niemals Secrets committen**: kein Client-Secret, kein Token, keine echte Beraternummer oder Mandantennummer, keine `.env`. Die Tests dürfen nie die echte apaleo-API aufrufen; `live-smoke` ist der einzige Befehl für echte Zugangsdaten, und du startest ihn von Hand.
- Füge die Ausgabe von `live-smoke` erst in ein Issue ein, nachdem du die Namen entfernt hast.

## Wissen über die Kontenzuordnung

Änderungen an den Vorlagen für SKR03 oder SKR04 (`templates/`) brauchen eine Quelle: den DATEV-Kontenrahmen mit Artikelnummer und Datum, im Kommentar der Zeile genannt, wie bei den vorhandenen Zeilen. Eine Zeile, die nicht gegen eine Quelle geprüft ist, wird mit `Vorschlag (ungeprüft)` markiert, und der Leitfaden zur Kontenzuordnung führt sie auf.
