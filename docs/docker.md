# Zeitplan und Docker

`apaleo-datev schedule --once` ermittelt, welche Zeiträume fällig sind, exportiert die, die noch nicht im Ausgabeordner liegen, und endet. Im Tool läuft keine eigene Uhr: Cron, ein systemd-Timer, ein Kubernetes CronJob oder die Schleife in `docker-compose.example.yml` ruft es auf. Du kannst es so oft aufrufen, wie du willst, zum Beispiel stündlich: Ein Zeitraum, dessen Datei schon existiert, kostet keine Anfrage an apaleo.

Keine Gewähr, keine Steuerberatung: Lass deine Steuerberatung die Kontenzuordnung und die ersten Importe prüfen, bevor das Tool allein läuft.

Es gibt kein Image in einer Registry. Du baust es selbst aus diesem Repository, wie unten gezeigt.

## Was fällig ist

```yaml
schedule:
  timezone: Europe/Berlin   # IANA-Zeitzone; auch APALEO_DATEV_TIMEZONE
  cadence: monthly          # monthly (Standard) oder daily
  monthly:
    dayOfMonth: 3           # 1 bis 5
  daily:
    offsetDays: 2           # 1 bis 3
  finalAfter: "06:00"       # Ortszeit, ab der vorgestern abgeschlossen ist, "00:00" bis "12:00"
  catchUpDays: 40           # mindestens 3 (monatlich) oder 5 (täglich)
```

- „Heute“ ist das Datum in `schedule.timezone`, nie eine Schätzung in UTC: Am 3. November um 00:30 Uhr ist in Berlin der 3. November, auch wenn in UTC noch der 2. November ist.
- `cadence: monthly` (Standard): Ein Kalendermonat ist ab `schedule.monthly.dayOfMonth` des Folgemonats fällig. Mit Tag 3 wird der Oktober ab dem 3. November exportiert. Die Kanzlei bekommt einen Stapel pro Monat.
- `cadence: daily`: Ein Tag ist `schedule.daily.offsetDays` Tage später fällig. Mit 2 (Standard) wird der 18. Oktober am 20. Oktober ab 06:00 Uhr exportiert. Täglich heißt für die Kanzlei etwa 30 Importe im Monat; stimm das also vorher mit ihr ab.
- Ein geplanter Lauf schreibt nie einen Zeitraum, der noch nicht abgeschlossen ist. apaleo kann auf einen Tag noch buchen, bis der Tagesabschluss (Night Audit) den *folgenden* Tag schließt (ein Gast, der um 04:00 Uhr eincheckt, wird auf den Vortag gebucht), und dieser Abschluss läuft nach Mitternacht. Ein Zeitraum, der am Tag T endet, gilt deshalb erst ab `schedule.finalAfter` (Standard 06:00 Uhr) am Tag T+2 als abgeschlossen, nicht früher: Sobald die Datei existiert, überspringt jeder spätere Lauf den Zeitraum, spätere Buchungen kämen also nie in DATEV an. Bis dahin meldet das Tool den Zeitraum als `not yet final` (Hinweis `N-NOT-FINAL`), ohne apaleo zu fragen, und der erste Lauf nach dieser Uhrzeit exportiert ihn. Beispiele mit den Standardwerten: Der 18. Oktober wird am 20. Oktober ab 06:00 Uhr geschrieben; mit `offsetDays: 1` wartet der 19. Oktober bis zum 21. Oktober 06:00 Uhr; mit `dayOfMonth: 1` oder `2` wartet der Oktober bis zum 2. November 06:00 Uhr. Setze `finalAfter` auf die Uhrzeit, zu der dein Tagesabschluss sicher fertig ist (gern früher, nie später als 12:00 Uhr). Ob ein Zeitraum abgeschlossen ist, prüft das Tool in `schedule.timezone` und noch einmal in der Zeitzone des Hotels aus apaleo.
- Ein Rhythmus pro Installation. Lass nie einen täglichen und einen monatlichen Zeitplan in denselben DATEV-Mandanten laufen: Die Buchungen würden doppelt importiert.
- `schedule.catchUpDays`: Nach einem Ausfall wird jeder Zeitraum exportiert, dessen Fälligkeitstag (bei täglich: der Tag selbst) in den letzten `catchUpDays` Tagen liegt, der älteste zuerst. Ein Zeitraum, der aus diesem Fenster gefallen ist, wird nicht mehr automatisch exportiert; starte für ihn `export` von Hand (siehe unten). Der Wert muss bei `cadence: monthly` mindestens 3 und bei `cadence: daily` mindestens 5 sein: Ein Lauf kann einen Zeitraum bis zu vier Tage nach seinem letzten Tag als nicht abgeschlossen zurückhalten (vor `finalAfter`, in einer Zeitzone des Hotels, die hinter `schedule.timezone` liegt), und beim nächsten Lauf muss der Zeitraum noch im Fenster liegen. Starte `schedule --once` mindestens einmal am Tag, zum Beispiel stündlich, wie es die Compose-Schleife tut.

### Der erste Lauf

Der erste Lauf exportiert jeden Zeitraum, der im Nachholfenster fällig ist, nicht nur den neuesten. Mit den Standardwerten exportiert ein erster Lauf zwischen dem 3. und etwa dem 12. eines Monats die letzten zwei Monate.

Hat ein früheres Tool (zum Beispiel ein bezahlter Connector) einige dieser Zeiträume schon an die Kanzlei geliefert, setze `schedule.catchUpDays` für den ersten Lauf so niedrig, dass das Fenster nach dem letzten Zeitraum beginnt, den dieses Tool geliefert hat, und erhöhe den Wert danach wieder. Ein Beispiel: Der alte Connector hat den September geliefert, und du startest am 5. November. Mit `catchUpDays: 5` wird nur der Oktober (fällig am 3. November) exportiert. Die Dateien des alten Tools in den Ausgabeordner zu kopieren hilft **nicht**: `schedule` erkennt nur seine eigenen Dateien (einen Eintrag in `manifest.json` oder `<Hotel>/<JJJJ-MM>/EXTF_Buchungsstapel_<Berater>_<Mandant>_<von>-<bis>_<Hotel>.csv` für genau diesen Zeitraum). Der Zeitraum würde also noch einmal exportiert, und DATEV würde ihn doppelt buchen. Prüfe vor dem ersten echten Lauf mit `export --month <JJJJ-MM> --dry-run`, was ein Lauf schreiben würde.

### Was übersprungen wird und was nicht

- Ein Hotel und Zeitraum, dessen EXTF-Datei im Ausgabeordner liegt oder in der `manifest.json` dieses Monats als aktuell vermerkt ist (auch nachdem du die Datei verschoben hast), meldet das Tool als `already exported`, ohne apaleo zu fragen.
- Ein fehlgeschlagener Zeitraum (zum Beispiel `E-UNMAPPED`) wird bei jedem Lauf erneut versucht, bis er klappt oder das Nachholfenster verlässt.
- Ein Zeitraum ohne Buchungen schreibt keine Datei und wird deshalb bei jedem Lauf im Fenster erneut abgefragt.
- Nachbuchungen, nachdem eine Datei geschrieben wurde, holt das Tool nicht automatisch ab. Dafür gibt es den Ablauf mit `export --overwrite` in [export.md](export.md), den du von Hand startest, nachdem die Kanzlei den importierten Stapel entfernt hat. Ein Stapel, der mit `datev.festschreibung: 1` importiert wurde, lässt sich nicht entfernen; dann bucht die Kanzlei die Differenz von Hand ([datev-import.md](datev-import.md)).

### Ausgabe und Exit-Codes

Eine Zeile pro Hotel und Zeitraum:

```text
2026-11-03T06:00:12+01:00 BSP 2026-10 written /data/BSP/2026-10/EXTF_Buchungsstapel_1234567_42_20261001-20261031_BSP.csv
2026-11-03T06:00:12+01:00 BSP2 2026-10 already exported /data/BSP2/2026-10/EXTF_Buchungsstapel_1234567_43_20261001-20261031_BSP2.csv
2026-11-03T06:00:13+01:00 BSP3 2026-10 failed E-UNMAPPED
  E-UNMAPPED (apaleo_account): apaleo account 5121 ...
2026-11-03T06:00:14+01:00 BSP4 2026-10 written /data/BSP4/2026-10/EXTF_Buchungsstapel_1234567_44_20261001-20261031_BSP4.csv W-EXTF-CHARSET
  W-EXTF-CHARSET (booking 12, Buchungstext): ...
```

Jede Zeile erscheint, sobald ihr Hotel und Zeitraum fertig sind, ein Lauf, der mittendrin abbricht, zeigt also trotzdem die Dateien, die er geschrieben hat. Das Ergebnis ist `written`, `already exported`, `no bookings`, `not yet final` oder `failed`, gefolgt von jedem Befund-Code (zuerst `E-`, dann Warnungen `W-` und Hinweise `N-`) und den Befunden selbst, eingerückt, damit auch die Mails von Cron und `docker logs` die Warnungen zeigen. Ist nichts fällig, steht dort `nothing due`. Der Exit-Code ist 0, wenn jeder Zeitraum geschrieben wurde, schon exportiert war, keine Buchungen hatte oder noch nicht abgeschlossen ist, 1, wenn einer fehlgeschlagen ist, und 2 bei falschem Aufruf (zum Beispiel `schedule` ohne `--once`). Ein Secret erscheint nie in der Ausgabe.

## Docker Compose (empfohlen)

```sh
git clone https://github.com/krautdawg/apaleo-datev-export.git
cd apaleo-datev-export
cp .env.example .env                 # APALEO_CLIENT_SECRET eintragen
mkdir -p config data
cp apaleo-datev.config.example.yaml config/apaleo-datev.config.yaml   # dann bearbeiten
# die Kontenzuordnung(en) nach config/ legen, zum Beispiel config/mapping-BSP.csv
sudo chown 1000:1000 data            # der Container läuft als Benutzer node (uid 1000)
docker compose -f docker-compose.example.yml up -d --build
docker compose -f docker-compose.example.yml logs -f
```

Der Dienst ruft `schedule --once` auf, wartet eine Stunde und wiederholt das. Die Dateien erscheinen in `./data/<Hotel>/<JJJJ-MM>/`.

Lässt du das `chown` weg, legt Docker `./data` mit root als Besitzer an, und jeder Zeitraum scheitert mit `E-EXPORT` und `EACCES: permission denied`, gefolgt von dem `chown`-Befehl, den du ausführen musst. Der Lauf macht mit den anderen Zeiträumen weiter und endet mit 1; es geht nichts verloren, der nächste Lauf nach der Korrektur exportiert sie.

`config/`, `data/` und `./schedule.log` (siehe Cron auf dem Host unten) enthalten die Berater- und Mandantennummer, die Kontenzuordnung und die exportierten Buchhaltungsdaten. Sie liegen im geklonten Repository, und `.gitignore` schließt sie aus, damit ein `git add -A` sie nicht mitnimmt. Sichere sie getrennt.

So ist der Container aufgebaut:

| Pfad | Inhalt | Einbindung |
| --- | --- | --- |
| `/config` | `apaleo-datev.config.yaml` und die Kontenzuordnungen (CSV); auch das Arbeitsverzeichnis | `./config`, nur lesbar |
| `/data` | die Exporte (`APALEO_DATEV_OUTPUT_DIR=/data`, geht `output.dir` vor) | `./data` |
| `/app` | das gebaute Tool | im Image |

Weil das Arbeitsverzeichnis `/config` ist, zeigt ein Pfad zur Kontenzuordnung in der Konfiguration wie `./mapping-BSP.csv` (der Standard für `properties[].mapping`) in den Ordner `config/`.

### Secrets und Umgebung

Die eingebundene Konfiguration braucht kein Secret: `APALEO_CLIENT_SECRET` kommt aus `.env`, und Git ignoriert diese Datei. Schreib es nie in die Konfigurationsdatei; das Tool lehnt das ab. Neben dem Secret lassen sich nur diese einzelnen Werte aus der Umgebung setzen: `APALEO_DATEV_CONFIG`, `APALEO_DATEV_OUTPUT_DIR`, `APALEO_CLIENT_ID`, `APALEO_DATEV_BERATERNUMMER`, `APALEO_DATEV_MANDANTENNUMMER` und `APALEO_DATEV_TIMEZONE`. Listen wie `properties` bleiben in der Konfigurationsdatei: `APALEO_DATEV_PROPERTIES` lehnt das Tool mit einer entsprechenden Meldung ab.

### Einmalige Befehle

Mit Argumenten führt der Compose-Dienst genau diesen einen Befehl aus und endet, statt in der Schleife zu laufen:

```sh
docker compose -f docker-compose.example.yml run --rm apaleo-datev export --month 2026-10 --dry-run
docker compose -f docker-compose.example.yml run --rm apaleo-datev export --month 2026-10
docker compose -f docker-compose.example.yml run --rm apaleo-datev mapping check --property BSP
```

So schließt du eine Lücke nach einem Ausfall, der länger als `schedule.catchUpDays` war, oder startest `export --overwrite` nach einer Nachbuchung.

## Cron auf dem Host statt der Schleife

Wenn dir Cron auf dem Host lieber ist als ein Container, der dauerhaft läuft, baust du das Image einmal und lässt Cron stündlich einen kurzlebigen Container starten:

```sh
docker compose -f docker-compose.example.yml build
crontab -e
# diese Zeile eintragen (Pfad anpassen):
0 * * * * cd /opt/apaleo-datev-export && docker compose -f docker-compose.example.yml run --rm apaleo-datev schedule --once >> schedule.log 2>&1
```

Ohne Docker, nach der Installation aus dem Quellcode (`pnpm install --frozen-lockfile && pnpm build`), lautet die Cron-Zeile:

```sh
0 * * * * cd /opt/apaleo-datev-export && node dist/cli/main.js schedule --once >> schedule.log 2>&1
```

Cron schickt die Ausgabe per Mail an den Benutzer des Rechners, wenn das eingerichtet ist; sonst behalte `./schedule.log` im Blick. Ein fehlgeschlagener Lauf endet mit 1 und nennt den Befund-Code. Eine Alarm-Mail gibt es in dieser Version nicht.

## Einfaches docker run

```sh
docker build -t apaleo-datev-export:local .
docker run --rm --env-file .env -v "$PWD/config:/config:ro" -v "$PWD/data:/data" apaleo-datev-export:local
docker run --rm --env-file .env -v "$PWD/config:/config:ro" -v "$PWD/data:/data" apaleo-datev-export:local export --month 2026-10
```

Der Standardbefehl des Image ist `schedule --once`; Argumente ersetzen ihn.

### Die Demo im Image

`export --demo` braucht keine Konfiguration und kein Secret. Der Probelauf funktioniert so, wie er ist:

```sh
docker run --rm apaleo-datev-export:local export --month 2026-09 --demo --dry-run
```

Ohne `--dry-run` schreibt die Demo nach `./demo-output/` unterhalb des Arbeitsverzeichnisses, und das ist im Image `/config`, das root gehört (und das Compose nur lesbar einbindet). Der Lauf würde mit `E-EXPORT` und `EACCES` scheitern. Setze das Arbeitsverzeichnis auf einen Datenordner, in den der Benutzer node schreiben darf:

```sh
mkdir -p data && sudo chown 1000:1000 data
docker run --rm -w /data -v "$PWD/data:/data" apaleo-datev-export:local export --month 2026-09 --demo
```

Die Datei landet in `./data/demo-output/BSP/2026-09/` und endet auf `_BSP_DEMO.csv`. Lösch `./data/demo-output/` danach; importiere nie eine Demodatei in einen echten Mandanten.

## Aktualisieren

Hol den neuen Quellcode und baue neu. `--pull` holt auch das neueste Basis-Image `node:24-bookworm-slim` mit seinen Sicherheitskorrekturen, baue also ab und zu neu, auch ohne neue Version:

```sh
git pull
docker compose -f docker-compose.example.yml build --pull
docker compose -f docker-compose.example.yml up -d
```
