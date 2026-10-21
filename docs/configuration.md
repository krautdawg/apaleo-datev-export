# Konfiguration: alle Einstellungen

Das Tool liest eine Konfigurationsdatei im Format YAML oder JSON und dazu ein paar Umgebungsvariablen. Fang mit [`apaleo-datev.config.example.yaml`](../apaleo-datev.config.example.yaml) an: Kopiere die Datei nach `apaleo-datev.config.yaml` und füll sie aus.

## Wo die Datei liegt

1. `--config <Pfad>` auf der Kommandozeile, sonst
2. die Umgebungsvariable `APALEO_DATEV_CONFIG`, sonst
3. `./apaleo-datev.config.yaml` im Arbeitsverzeichnis.

Eine Datei, deren Name auf `.json` endet, wird als JSON gelesen, jede andere als YAML. Unbekannte Schlüssel lehnt das Tool mit ihrem Namen ab, damit ein Tippfehler nie unbemerkt bleibt. Ein Schlüssel ohne Wert (`skr:`) gilt als nicht gesetzt. `apaleo-datev doctor` zeigt, welche Datei verwendet wird und ob sie gültig ist.

## Secrets

Das Client-Secret der apaleo Custom App kommt nur aus der Umgebung: `APALEO_CLIENT_SECRET`. Steht in der Konfigurationsdatei ein Secret unter `apaleo`, startet das Tool nicht und sagt dir, dass du es in die Umgebung verschieben sollst. Mit Docker kommt es in die Datei `.env`, die Git ignoriert; siehe [docker.md](docker.md). Das Tool gibt das Secret nie aus.

## Umgebungsvariablen

Das Tool liest nur diese Variablen. Jede andere Variable, die mit `APALEO_DATEV_` beginnt, lehnt es mit einer Meldung ab, damit eine falsch geschriebene nicht still wirkungslos bleibt. Listen wie `properties` lassen sich nur in der Datei setzen.

| Variable | Setzt | Typ |
|---|---|---|
| `APALEO_CLIENT_SECRET` | das Client-Secret der Custom App (nie in der Datei) | Text |
| `APALEO_DATEV_CONFIG` | den Pfad der Konfigurationsdatei | Pfad |
| `APALEO_CLIENT_ID` | `apaleo.clientId` | Text |
| `APALEO_DATEV_OUTPUT_DIR` | `output.dir` | Pfad |
| `APALEO_DATEV_BERATERNUMMER` | `datev.beraternummer` | ganze Zahl |
| `APALEO_DATEV_MANDANTENNUMMER` | `datev.mandantennummer` | ganze Zahl |
| `APALEO_DATEV_TIMEZONE` | `schedule.timezone` | IANA-Zeitzone |

Ein Wert aus der Umgebung geht dem Wert in der Datei vor.

## Schlüssel

### `apaleo`

| Schlüssel | Standard | Bedeutung |
|---|---|---|
| `apaleo.clientId` | keiner | Client-ID der Custom App ([setup-apaleo.md](setup-apaleo.md)). Jeder Befehl, der mit apaleo spricht, braucht sie. Auch über `APALEO_CLIENT_ID`. |
| `apaleo.scopes` | wird nicht gesendet | Scopes, durch Leerzeichen getrennt, nur für Clients mit Scopes statt Berechtigungen, zum Beispiel `accounting.read`. Custom Apps mit Berechtigungen lassen den Schlüssel weg. |
| `apaleo.baseUrl` | `https://api.apaleo.com` | Adresse der API. Ändere sie nur, um gegen eine andere apaleo-Umgebung zu testen. Muss https sein (einfaches http nur für localhost). |
| `apaleo.identityUrl` | `https://identity.apaleo.com` | Adresse der Anmeldung, dieselben Regeln wie bei `apaleo.baseUrl`. |

### `datev`

Diese Werte bekommst du von der Kanzlei.

| Schlüssel | Standard | Bedeutung |
|---|---|---|
| `datev.beraternummer` | Pflicht | Beraternummer der Steuerberatung, 1001 bis 9999999. Auch über `APALEO_DATEV_BERATERNUMMER`. |
| `datev.mandantennummer` | Pflicht | Mandantennummer des Hotels bei der Kanzlei, 1 bis 99999. Auch über `APALEO_DATEV_MANDANTENNUMMER`. |
| `datev.sachkontenlaenge` | `4` | Sachkontenlänge im DATEV-Bestand der Kanzlei, 4 bis 8. Debitoren haben eine Stelle mehr. |
| `datev.wjBeginn` | `"01-01"` | Wirtschaftsjahresbeginn als `MM-TT`, in Anführungszeichen. Eine Datei reicht nie über ihn hinweg. |
| `datev.skr` | der SKR aus der Kontenzuordnung | Der Kontenrahmen des Mandanten: `"03"` (SKR03) oder `"04"` (SKR04). |
| `datev.festschreibung` | `0` | `1` schreibt den importierten Stapel in DATEV fest (Festschreibung), `0` lässt ihn bearbeitbar. Bleib bei `0`, bis die Kanzlei der Ausgabe vertraut. Ein festgeschriebener Stapel lässt sich nicht löschen: Nach einer Nachbuchung bucht die Kanzlei die Differenz von Hand und importiert nie eine Datei aus `--overwrite`; siehe [datev-import.md](datev-import.md). |

### `posting`

| Schlüssel | Standard | Bedeutung |
|---|---|---|
| `posting.belegfeld1` | `receipt` | Was in Belegfeld 1 steht: `receipt` nimmt den Beleg aus apaleo (Rechnungs- oder Zahlungsreferenz) und sonst die Reservierungsreferenz; `reference` nimmt immer die Reservierungsreferenz. |

### `properties`

Die apaleo-Hotels, mit denen das Tool arbeitet. `export` und `schedule --once` exportieren jedes hier eingetragene Hotel, außer du gibst `--property` an. Die IDs, die die Custom App lesen darf, listet `apaleo-datev properties`.

| Schlüssel | Standard | Bedeutung |
|---|---|---|
| `properties` | leere Liste | Ein Eintrag pro Hotel. |
| `properties[].id` | Pflicht | Die Property-ID in apaleo, zum Beispiel `BSP`. |
| `properties[].mapping` | `./mapping-<id>.csv` | Die Kontenzuordnung (CSV) des Hotels, relativ zum Arbeitsverzeichnis. |
| `properties[].mandantennummer` | `datev.mandantennummer` | Für ein Hotel, das die Kanzlei unter einer eigenen Mandantennummer bucht. |

```yaml
properties:
  - id: BSP
    mapping: ./mapping-BSP.csv
  - id: BSP2
    mapping: ./mapping-BSP2.csv
    mandantennummer: 43
```

### `output`

| Schlüssel | Standard | Bedeutung |
|---|---|---|
| `output.dir` | `./exports` | Ordner für die DATEV-Dateien, relativ zum Arbeitsverzeichnis. Jede Datei landet in `<output.dir>/<Hotel>/<JJJJ-MM>/`. Auch über `APALEO_DATEV_OUTPUT_DIR`. |

### `checks`

| Schlüssel | Standard | Bedeutung |
|---|---|---|
| `checks.aggregates` | `false` | Vergleicht das Buchungsjournal zusätzlich mit den Tagessummen von apaleo, Saldo pro Konto, und warnt bei Abweichungen (`W-AGGREGATE-DIFF`, siehe [export.md](export.md)). Braucht die optionale Berechtigung `core.subledger_aggregate.create` und eine zusätzliche Anfrage pro Tag. |

### `schedule`

Nur für `schedule --once`. Was jede Einstellung bewirkt, mit Beispielen: [docker.md](docker.md).

| Schlüssel | Standard | Bedeutung |
|---|---|---|
| `schedule.timezone` | `Europe/Berlin` | „Heute“ ist das Datum in dieser IANA-Zeitzone. Auch über `APALEO_DATEV_TIMEZONE`. |
| `schedule.cadence` | `monthly` | `monthly` (eine Datei pro Monat) oder `daily` (eine Datei pro Tag). Ein Rhythmus pro Installation. |
| `schedule.monthly` | | Einstellungen für `cadence: monthly`. |
| `schedule.monthly.dayOfMonth` | `3` | Ein Monat ist ab diesem Tag des Folgemonats fällig, 1 bis 5. |
| `schedule.daily` | | Einstellungen für `cadence: daily`. |
| `schedule.daily.offsetDays` | `2` | Ein Tag ist so viele Tage später fällig, 1 bis 3. |
| `schedule.finalAfter` | `"06:00"` | Ortszeit, ab der ein Zeitraum, der vorgestern endete, als abgeschlossen gilt, `"00:00"` bis `"12:00"`, in Anführungszeichen. |
| `schedule.catchUpDays` | `40` | Wie viele Tage zurück ein verpasster Zeitraum noch exportiert wird, mindestens 3 (monatlich) oder 5 (täglich), höchstens 366. |

## Ein vollständiges Beispiel

```yaml
apaleo:
  clientId: HOTEL-DATEV-EXPORT
datev:
  beraternummer: 1234567
  mandantennummer: 42
  sachkontenlaenge: 4
  wjBeginn: "01-01"
  skr: "03"
  festschreibung: 0
posting:
  belegfeld1: receipt
properties:
  - id: BSP
output:
  dir: ./exports
checks:
  aggregates: false
schedule:
  timezone: Europe/Berlin
  cadence: monthly
```

Das Secret kommt in die Umgebung, nicht in diese Datei:

```sh
export APALEO_CLIENT_SECRET='das Secret aus apaleo'
apaleo-datev doctor
```
