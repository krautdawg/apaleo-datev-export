# apaleo DATEV Export: kostenlos und Open Source

**English:** [README.en.md](README.en.md)

Kostenloser apaleo DATEV Export: Buchungsstapel (EXTF) für DATEV Rechnungswesen, Open Source.

[![CI](https://github.com/krautdawg/apaleo-datev-export/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/krautdawg/apaleo-datev-export/actions/workflows/ci.yml)
[![Lizenz: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![Node.js 24](https://img.shields.io/badge/node.js-24-339933.svg)](https://nodejs.org/)

apaleo-datev-export ist ein kostenloser DATEV-Export für Hotels mit apaleo. Er liest das apaleo-Buchungsjournal eines Monats und schreibt pro Hotel einen DATEV-Buchungsstapel im DATEV-Format (EXTF), fertig für deine Kanzlei und deinen Steuerberater oder deine Steuerberaterin, mit Vorlagen für die Kontenzuordnung im SKR03 und SKR04. Das Tool ist Open Source (MIT-Lizenz) und läuft auf deinem eigenen Rechner mit deinem eigenen apaleo-Konto. Kein Abo, kein gehosteter Dienst, kein Konto bei uns.

> **Keine Gewähr, keine Steuerberatung.** Lass deine Kontenzuordnung von deiner Steuerberatung prüfen, ebenso die ersten DATEV-Importe. Lies den [Haftungsausschluss](DISCLAIMER.md).

## Was es macht

- Liest das apaleo-Buchungsjournal (`export-gross-daily`) und den Kontenplan über eine apaleo Custom App, die nur lesen darf.
- Bucht jede Zeile auf DATEV-Konten, mit einer Kontenzuordnung (CSV) pro Hotel aus einer Hotel-Vorlage für SKR03 oder SKR04.
- Prüft jede Zeile vor dem Schreiben: DATEV muss genau die Umsatzsteuer rechnen, die apaleo berechnet hat, jedes Konto muss zugeordnet sein, und die Summen pro Konto müssen aufgehen.
- Schreibt pro Hotel und Monat einen EXTF-Buchungsstapel (Windows-1252, Formatversion 13) mit Protokoll und Prüfsummen und schreibt denselben Monat nie zweimal.
- Läuft von Hand, per Cron oder in einem selbst gebauten Docker-Container (`schedule --once`).

## Für wen

- Hotel-Backoffice und kleine Hotelgruppen mit apaleo, deren Buchhaltung eine Kanzlei mit DATEV macht.
- Steuerberater und Kanzleien, die die Kontenzuordnung sehen, prüfen und selbst verantworten wollen.
- Technische Helfer, die es für ein Hotel einrichten. Du brauchst einen Rechner mit Node.js 24 oder Docker und die Kommandozeile.

## Beispielausgabe ansehen

In [docs/examples/](docs/examples/) liegt eine DATEV-Datei, die das Tool für das erfundene „Hotel Beispiel“ geschrieben hat, mit Protokoll und der Kontenzuordnung, aus der sie entstanden ist. Die Kanzlei kann sie prüfen oder in einen Test-Mandanten importieren, bevor irgendjemand etwas einrichtet.

## Ohne apaleo ausprobieren

Nach der Installation (Schritt 2 unten) läuft der echte Export auf mitgelieferten Demodaten. Dafür brauchst du keine Konfiguration, kein apaleo-Konto und kein Netz:

```sh
node dist/cli/main.js export --month 2026-09 --demo --dry-run
```

Das zeigt die Buchungsübersicht für September 2026 im „Hotel Beispiel“. Ohne `--dry-run` schreibt es die Datei nach `./demo-output/`, markiert mit `DEMO` im Dateinamen (`…_BSP_DEMO.csv`), in der Bezeichnung und im Protokoll. Im Docker-Image: siehe [docs/docker.md](docs/docker.md#die-demo-im-image).

## Schnellstart

Es gibt noch kein npm-Paket und kein Container-Image zum Herunterladen. Du installierst aus dem Quellcode.

1. **apaleo Custom App anlegen.** In apaleo: Apps > Connected apps > Add custom app, Client-Typ simple, mit den Berechtigungen aus [docs/setup-apaleo.md](docs/setup-apaleo.md). Kopiere Client-ID und Secret.

2. **Installieren** (braucht Node.js 24 und git):

   <!-- quickstart -->
   ```sh
   git clone https://github.com/krautdawg/apaleo-datev-export.git
   cd apaleo-datev-export
   corepack enable
   pnpm install --frozen-lockfile
   pnpm build
   node dist/cli/main.js --help        # oder: pnpm link --global, dann apaleo-datev --help
   ```

   Dann die Konfiguration ausfüllen und das Secret setzen. Das Secret kommt nie in die Konfigurationsdatei.

   ```sh
   cp apaleo-datev.config.example.yaml apaleo-datev.config.yaml   # apaleo.clientId, Beraternummer, Mandantennummer eintragen
   export APALEO_CLIENT_SECRET='das Secret aus apaleo'
   node dist/cli/main.js doctor
   node dist/cli/main.js properties
   ```

   Die Befehle unten verwenden `apaleo-datev`. Ohne `pnpm link --global` tippst du stattdessen `node dist/cli/main.js`.

3. **Kontenzuordnung anlegen** und von deiner Kanzlei mit dem [Leitfaden zur Kontenzuordnung](docs/mapping-guide.md) prüfen lassen:

   ```sh
   apaleo-datev init-mapping --property BSP --skr 03     # schreibt mapping-BSP.csv; --skr 04 für SKR04
   apaleo-datev mapping check --property BSP --from 2026-09-01 --to 2026-09-30
   ```

4. **Probelauf**: alle Prüfungen und die Übersicht, keine Datei.

   ```sh
   apaleo-datev export --month 2026-09 --dry-run
   ```

5. **Export**: eine Datei pro Hotel nach `exports/<Hotel>/<JJJJ-MM>/`. Gib sie der Kanzlei für den [DATEV-Import](docs/datev-import.md).

   ```sh
   apaleo-datev export --month 2026-09
   ```

## Schnellstart mit Docker

Das Image wird auf deinem Rechner aus diesem Repository gebaut; nichts wird aus einer Registry geladen. Der Container ruft stündlich `schedule --once` auf und exportiert jeden Monat, sobald er fällig ist (Oktober am 3. November).

```sh
cp .env.example .env                 # APALEO_CLIENT_SECRET eintragen
mkdir -p config data
cp apaleo-datev.config.example.yaml config/apaleo-datev.config.yaml   # dann bearbeiten
cp mapping-BSP.csv config/           # die von der Kanzlei geprüfte Zuordnung
sudo chown 1000:1000 data            # der Container läuft als Benutzer node (uid 1000)
docker compose -f docker-compose.example.yml build
docker compose -f docker-compose.example.yml up -d
```

Die Dateien erscheinen in `./data/<Hotel>/<JJJJ-MM>/`. Cron auf dem Host, einmalige Befehle und Updates: [docs/docker.md](docs/docker.md).

## Befehle

| Befehl | Was er macht |
|---|---|
| `doctor` | Prüft Node.js, Konfigurationsdatei und Uhr. Ohne Netz. |
| `properties` | Listet die apaleo-Hotels, die die Custom App lesen darf. |
| `live-smoke` | Liest einen Geschäftstag aus apaleo mit echten Zugangsdaten und zeigt, was zurückkam. Schreibt nichts. |
| `init-mapping` | Schreibt eine Kontenzuordnung aus dem apaleo-Kontenplan und der Vorlage SKR03 oder SKR04; `--update` hängt neue Konten an. |
| `mapping check` | Prüft eine Kontenzuordnung, und mit `--from`/`--to`, ob jedes im Zeitraum gebuchte Konto zugeordnet ist. |
| `export` | Schreibt die DATEV-Dateien eines Monats oder Zeitraums nach allen Prüfungen; `--dry-run` schreibt nichts, `--demo` nimmt die Demodaten. |
| `schedule` | `schedule --once` exportiert jeden fälligen Zeitraum, der noch nicht im Ausgabeordner liegt, und endet. Für Cron und Docker. |

`apaleo-datev <Befehl> --help` zeigt die Optionen. Exit-Codes: 0 Erfolg, 1 eine Prüfung oder ein Lauf ist fehlgeschlagen, 2 falscher Aufruf. Jeder Befund-Code mit Lösung: [docs/troubleshooting.md](docs/troubleshooting.md).

## Konfiguration

Eine YAML-Datei und Umgebungsvariablen für das Secret. Jeder Schlüssel mit Standardwert und Umgebungsvariable: [docs/configuration.md](docs/configuration.md). Die Vorlage zum Kopieren: [apaleo-datev.config.example.yaml](apaleo-datev.config.example.yaml).

## Was es nicht macht

- Keine Übertragung an DATEV online (Buchungsdatenservice). Dafür braucht es eine Freigabe von DATEV; dieses Tool schreibt nur Dateien für den DATEV-Import.
- Keine Debitoren-Stammdaten. Firmenrechnungen gehen auf einen Sammeldebitor.
- Keine Buchung von Gebühren der Zahlungsdienstleister oder Provisionen der Buchungsportale. Die bucht die Kanzlei aus den Abrechnungen.
- Keine Weboberfläche, kein gehosteter Dienst, kein E-Mail-Versand, kein GoBD-zertifiziertes Archiv.
- Nur EUR, nur apaleo. Andere PMS oder Zielformate (Mews, BMD, lexoffice) sind als Beitrag willkommen; siehe [docs/architecture.md](docs/architecture.md).

## Vergleich mit kostenpflichtigen Connectoren

Im apaleo Store gibt es kostenpflichtige DATEV-Connectoren. Die Tabelle vergleicht das typische Angebot mit diesem Tool, ohne Namen zu nennen.

| | Kostenpflichtige Connectoren im apaleo Store | apaleo-datev-export |
|---|---|---|
| Preis | etwa 24–51 € pro Hotel und Monat, laut apaleo Store, Oktober 2026 | kostenlos |
| Betrieb | beim Anbieter | bei dir (Rechner, Server oder Docker) |
| Einrichtung | Oberfläche des Anbieters | Konfigurationsdatei und Kontenzuordnung (CSV) |
| Übertragung an DATEV online | bei manchen | nicht unterstützt, nur Dateiimport |
| Support | Support des Anbieters | Community, ohne Garantie |
| Vorlagen für die Zuordnung | unterschiedlich | Vorschläge für SKR03 und SKR04, geprüft von deiner Kanzlei |

Selbst betreiben heißt: Du behältst die Daten und zahlst nichts, aber du spielst Updates ein, behältst die geplanten Läufe im Blick und löst Probleme selbst oder mit einem technischen Helfer. Kann das niemand übernehmen, ist ein bezahlter Connector vielleicht die bessere Wahl.

## Häufige Fragen

**Was kostet es?** Nichts. Es steht unter der MIT-Lizenz. Deine Kosten sind der Rechner, auf dem es läuft, und die Zeit der Kanzlei für die Prüfung der Zuordnung.

**Wohin gehen meine Daten?** Nur auf deine eigene Festplatte. Das Tool liest apaleo mit deiner Custom App und schreibt Dateien in einen lokalen Ordner. Es schickt nichts an uns oder an andere. Die DATEV-Datei enthält keine Gästenamen: Buchungstexte nutzen Kontobezeichnungen, nie die Namen von Gastfolios.

**Kann es an DATEV online übertragen?** Nein. Dafür braucht es eine Freigabe von DATEV. Die Kanzlei importiert die Datei über die Stapelverarbeitung; siehe [docs/datev-import.md](docs/datev-import.md).

**Festschreibung?** Standardmäßig aus (`datev.festschreibung: 0`), damit ein Stapel nach dem Import bearbeitbar bleibt. Ein festgeschriebener Stapel (`1`) lässt sich nicht löschen, eine Nachbuchung also nicht mit einer neuen Datei beheben: Die Kanzlei bucht die Differenz von Hand und importiert nie eine Datei aus `--overwrite`. Schalte sie erst ein, wenn die Kanzlei der Ausgabe vertraut, und nur mit Exporten, die den Tagesabschluss (Night Audit) abwarten (`schedule --once` oder von Hand höchstens bis vorgestern); siehe [docs/datev-import.md](docs/datev-import.md#festschreibung-0-oder-1).

**Mehrere Hotels?** Trag sie unter `properties` in der Konfiguration ein. Jedes bekommt eine eigene Zuordnung und eine eigene Datei, auf Wunsch unter einer eigenen Mandantennummer.

**Ich nutze heute einen bezahlten Connector. Kann ich wechseln?** Ja. Dessen Export der Kontenzuordnung (Spalten `ApaleoAccountNumber;DatevAccountNumber;CostCenter;CostCenter2`) wird direkt gelesen, und `init-mapping --update` wandelt ihn um. Fang mit dem ersten Monat an, den der alte Connector nicht mehr geliefert hat, damit nichts doppelt importiert wird; siehe [docs/docker.md](docs/docker.md#der-erste-lauf).

**Österreich (BMD)?** Noch nicht. Das Tool schreibt nur DATEV-Dateien. Ein BMD-Writer ist als Beitrag willkommen ([docs/architecture.md](docs/architecture.md)).

**Ist die Zuordnung Steuerberatung?** Nein. Die Vorlagen sind Vorschläge. Jede Zeile entscheidet deine Kanzlei.

## Haftungsausschluss

Ohne Gewähr, keine Haftung, keine Steuerberatung. Deine Kanzlei muss die Kontenzuordnung und die ersten DATEV-Importe prüfen. Lies den vollständigen [Haftungsausschluss](DISCLAIMER.md) (verbindlich auf Deutsch, mit einer unverbindlichen englischen Übersetzung). Keine Verbindung zur apaleo GmbH oder zur DATEV eG.

## Mitmachen

Fehlermeldungen, Korrekturen, neue Quellen und Zielformate sind willkommen. Lies zuerst [CONTRIBUTING.md](CONTRIBUTING.md): Einrichtung, OpenSpec-Ablauf und die Regel, dass Testdaten nie echte Gästedaten enthalten. Issues und Pull Requests auf Englisch sind ebenso willkommen; Code, Bezeichner und Commits sind auf Englisch. Sicherheitsprobleme: [SECURITY.md](SECURITY.md). Änderungen: [CHANGELOG.md](CHANGELOG.md).

## Lizenz

[MIT](LICENSE) (englischer Originaltext).
