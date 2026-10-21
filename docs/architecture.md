# Architektur, für Mitwirkende

apaleo-datev-export ist ein kleines Kommandozeilenprogramm in TypeScript (Node.js 24, ESM, strenge Typen, drei Abhängigkeiten zur Laufzeit: `csv-parse`, `yaml`, `zod`). Es liest ein PMS (apaleo) und schreibt ein Zielformat (DATEV EXTF). Der Code ist so geschnitten, dass eine zweite Quelle (Mews, Smoobu, Stripe) oder ein zweites Zielformat (BMD, lexoffice) dazukommen kann, ohne den Rest anzufassen.

Code, Bezeichner und Commit-Nachrichten sind auf Englisch; diese Seite erklärt sie auf Deutsch.

## Module

```text
src/
  cli/          Einstieg, Auswertung der Argumente, CommandContext, eine Datei pro Befehl in cli/commands/
  core/         Typen und Hilfen ohne PMS-Bezug: Konfiguration, Datum, Geld, Befunde, der Vertrag SourceAdapter
  sources/
    apaleo/     der Adapter für apaleo: Token, HTTP mit Wiederholungen, Schemas nach der Swagger-Beschreibung, Umwandlung in die Typen aus core
  demo/         export --demo: aufgezeichnete apaleo-Antworten aus examples/demo/, ohne Netz
  mapping/      die Kontenzuordnung als CSV: laden, auflösen, prüfen, Vorlagen für SKR03 und SKR04
  posting/      Journalzeilen + Kontenzuordnung -> DATEV-Buchungen, mit der USt-Prüfung
  datev/        der Writer für den EXTF-Buchungsstapel: Kopfzeile, 125 Spalten, Prüfung, Bereinigung, CP1252
  export/       der Ablauf: Regeln für Zeiträume, Abruf, Buchen, Plausibilitätsprüfungen, Ausgabeordner und Manifest
  schedule/     schedule --once: welche Zeiträume fällig sind, dann der Export für jeden
```

Die Abhängigkeiten zeigen in eine Richtung:

```text
cli -> export / schedule -> sources/<name>     (Verdrahtung)
                        -> mapping, posting, datev -> core
```

Zwei Lint-Regeln (in `eslint.config.js`, getestet in `test/lint/`) sorgen dafür, dass das so bleibt:

- `core`, `datev`, `mapping` und `posting` dürfen nichts aus `src/sources/` importieren. Sie sehen nur die kanonischen Typen in `src/core/source.ts`.
- Alles unter `src/` außer dem Einstieg der Kommandozeile erreicht die Uhr, das Netz und die Umgebung nur über den übergebenen `CommandContext` (`ctx.now()`, `ctx.fetchFn`, `ctx.env`, `ctx.fs`). Kein `new Date()`, kein `Date.now()`, kein nacktes `fetch` und kein `process.env`. Tests bauen mit `createTestContext()` in `test/helpers/context.ts` einen Kontext mit Attrappen.

## Der Vertrag SourceAdapter

`src/core/source.ts` legt fest, was eine Quelle liefert. Eine neue Quelle setzt diese Schnittstelle in `src/sources/<name>/` um:

```ts
interface SourceAdapter {
  readonly name: string;
  listProperties(): Promise<SourceProperty[]>;
  getChartOfAccounts(propertyId: string): Promise<SourceAccount[]>;
  /** every business day from `from` to `toExclusive`, sorted with sortLedgerLines */
  getLedger(propertyId: string, from: LocalDate, toExclusive: LocalDate): Promise<LedgerLine[]>;
  getAccountTotals(propertyId: string, businessDate: LocalDate): Promise<AccountTotals>;
}
```

### Die kanonische Buchungszeile

Eine `LedgerLine` ist ein gebuchtes Paar aus Soll und Haben im Buchungsjournal der Quelle:

| Feld | Bedeutung |
|---|---|
| `businessDate` | der Geschäftstag (`YYYY-MM-DD`), wird zum Belegdatum |
| `postedAt` | der Zeitstempel der Quelle, wie gesendet |
| `debit`, `credit` | die beiden Konten: `number`, `name`, `type`, optional `parentNumber` |
| `command` | der Geschäftsvorfall, zum Beispiel `PostCharge`, `PostPayment` |
| `currency` | muss für den Export `EUR` sein (sonst `E-CURRENCY`) |
| `grossCents`, `netCents` | ganze Cent mit dem Vorzeichen der Quelle; Nachlässe sind negativ |
| `taxes[]` | `vatType`, `percent`, `amountCents`, so weitergegeben, wie sie ankommen |
| `receipt`, `reference`, `referenceType` | Rechnungs- oder Zahlungsreferenz und die Reservierung, für Belegfeld 1 |
| `sourceEntryNumber`, `source` | damit sich jede Zeile bis zur Quelle zurückverfolgen lässt |

Die Kontotypen nutzen die Namen von apaleo (`Revenues`, `Payments`, `Liabilities`, `Receivables`, `CityTaxes`, `Vat`, ...), das genaueste Modell, das bisher bekannt ist. Eine andere Quelle ordnet ihre Konten diesen Typen zu. Beträge sind immer ganze Cent: Rechne Gleitkommazahlen am Rand um, wie es `toCents` in `src/core/money.ts` tut, und lehne Beträge unter einem Cent ab.

`getAccountTotals` liefert die Daten für die optionale Vollständigkeitsprüfung (`checks.aggregates`). Eine Quelle ohne solche Summen kann eine leere Liste von Konten zurückgeben.

### Eine Quelle hinzufügen (zum Beispiel Smoobu)

1. Leg `src/sources/smoobu/` an, mit einem Client, der nur `ctx.fetchFn` und `ctx.now()` nutzt, zod-Schemas für die Antworten, die du liest, und Umwandlungen in `SourceProperty`, `SourceAccount` und `LedgerLine`.
2. Bau die Quelle aus der Konfiguration in einer Funktion `createSmoobuSource(loaded, ctx)` und wähle sie in `createSource` in `src/cli/source.ts` aus (heute: `ctx.sourceFactory` oder apaleo). Ein neuer Abschnitt der Konfiguration kommt in `configSections` in `src/core/config.ts`; der Docs-Test erwartet ihn dann in `docs/configuration.md`.
3. Leg aufgezeichnete oder erfundene Antworten, die genau der API-Dokumentation der Quelle entsprechen, in `test/fixtures/smoobu/` ab, mit einer `README.md`, die sagt, was jede Datei enthält. Nie echte Gästedaten: Anonymisiere Namen, Reservierungsnummern und Beträge.
4. Teste den Adapter mit den Testdaten über eine Attrappe für `fetchFn` (siehe `test/helpers/apaleo.ts` und `test/apaleo/`). Die Tests für Kontenzuordnung, Buchungsregeln und Export bleiben unabhängig vom PMS und nutzen `FakeSource` in `test/helpers/fake-source.ts`.
5. Hat die Quelle kein Buchungsjournal (Smoobu, Stripe), bildet der Adapter die Paare aus Soll und Haben selbst. Beschreib diese Regel in `docs/`, denn die Steuerberatung muss sie verstehen.

## Ein Zielformat hinzufügen (zum Beispiel BMD oder lexoffice)

Die Buchungsregeln erzeugen Werte vom Typ `PostedBooking` (Konto, Gegenkonto, Soll/Haben, Betrag, BU-Schlüssel, Belegdatum, Belegfeld 1, Buchungstext, Kostenstellen) und eine Übersicht. Nur `src/datev/` kennt das Dateiformat EXTF. Ein neuer Writer:

1. liegt in `src/<Ziel>/` (zum Beispiel `src/bmd/`), hängt nicht von `src/sources/` ab und meldet fehlerhafte Daten als Befunde mit Codes, wie `renderBuchungsstapel` (dessen `ExtfValidationError` alle Befunde auf einmal enthält);
2. hat Golden Files in `test/golden/<Ziel>/`, die Byte für Byte verglichen werden (siehe `test/datev/golden.test.ts`);
3. wird in `src/export/pipeline.ts` ausgewählt. Heute ruft der Ablauf den DATEV-Writer direkt auf; ein zweites Zielformat ist der Moment, dort eine kleine Schnittstelle für Writer einzuführen.

USt-Logik, die nur ein Zielformat betrifft (BMD hat zum Beispiel keine Automatikkonten), gehört in den Buchungsschritt für dieses Ziel, nicht in den Writer.

## Befunde

Jede Prüfung liefert Werte vom Typ `Finding` (`src/core/findings.ts`) mit einem Code: `E-` blockiert, `W-` warnt, `N-` gibt einen Hinweis. Ein neuer Code braucht eine Zeile in [troubleshooting.md](troubleshooting.md); der Docs-Test schlägt fehl, bis es sie gibt.

## Tests und Konventionen

- `pnpm test` (Vitest), `pnpm lint`, `pnpm typecheck` und `pnpm build` müssen grün bleiben. Die CI führt sie bei jedem Push und jedem Pull Request aus.
- Golden Files: Nach einer gewollten Änderung der Ausgabe starte `UPDATE_GOLDEN=1 pnpm test` und prüfe den Diff.
- Jedes Stück Arbeit ist eine OpenSpec-Änderung in `openspec/changes/`; siehe [CONTRIBUTING.md](../CONTRIBUTING.md).
- Der Docs-Test (`test/docs.test.ts`) prüft, dass Befehle, Optionen, Konfigurationsschlüssel und Befund-Codes in der Dokumentation im Code existieren, dass jeder relative Link und jeder Anker auflöst und dass die Dokumentation deutsch ist und „du“ sagt.
