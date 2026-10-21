# Der Befehl export

`apaleo-datev export` liest das apaleo-Buchungsjournal eines Zeitraums, bucht es mit deiner Kontenzuordnung und schreibt pro Hotel und Kalendermonat einen DATEV-Buchungsstapel in den Ausgabeordner. Deine Kanzlei holt die Dateien dort ab (ein gemeinsamer Ordner, ein Cloud-Ordner, oder du schickst sie). Nichts wird irgendwohin hochgeladen.

Keine Gewähr, keine Steuerberatung: Lass deine Steuerberatung die Kontenzuordnung und die ersten Importe prüfen.

```sh
apaleo-datev export --month 2026-10 --dry-run          # alles prüfen, Übersicht zeigen, nichts schreiben
apaleo-datev export --month 2026-10                    # jedes Hotel aus der Konfiguration
apaleo-datev export --month 2026-10 --property BSP     # ein Hotel
apaleo-datev export --from 2026-09-25 --to 2026-10-05  # beide Tage eingeschlossen; zwei Dateien, eine pro Monat
apaleo-datev export --month 2026-10 --overwrite        # nach einer Nachbuchung, siehe „Noch einmal exportieren“
```

Der Exit-Code ist 0, wenn jedes Hotel und jeder Monat geschrieben wurde oder schon aktuell war, 1, wenn einer davon fehlgeschlagen ist, und 2 bei falschem Aufruf (zum Beispiel ohne Zeitraum).

## Demo ohne apaleo

```sh
apaleo-datev export --month 2026-09 --demo --dry-run   # die Übersicht für das erfundene Hotel Beispiel
apaleo-datev export --month 2026-09 --demo             # die Datei, nur nach ./demo-output/
```

`--demo` lässt genau diese Verarbeitung auf den aufgezeichneten apaleo-Antworten in `examples/demo/` laufen: keine Konfigurationsdatei, kein Secret, kein Netz. Die Uhr der Demo steht auf 2026-10-05, der September 2026 ist also abgeschlossen. Ihr Dateiname endet auf `_DEMO` (`EXTF_Buchungsstapel_1234567_42_20260901-20260930_BSP_DEMO.csv`), ihre Bezeichnung sagt `DEMO`, und ihr Protokoll beginnt mit einer Zeile `DEMO`; importiere sie nie in einen echten Mandanten. Die Demo schreibt unterhalb des Arbeitsverzeichnisses; im Docker-Image ist das das nur lesbare `/config`, siehe deshalb [docker.md](docker.md#die-demo-im-image). `--config` lässt sich nicht mit `--demo` kombinieren, und die Umgebung ändert nicht, wohin die Demo schreibt.

## Einstellungen

```yaml
datev:
  beraternummer: 1234567
  mandantennummer: 42
  sachkontenlaenge: 4
  wjBeginn: "01-01"     # Wirtschaftsjahresbeginn, MM-TT
  skr: "03"             # 03 oder 04; leer = der SKR aus der Kontenzuordnung
  festschreibung: 0     # 1 schreibt den Stapel nach dem Import in DATEV fest
properties:
  - id: BSP
    mapping: ./mapping-BSP.csv
    mandantennummer: 43 # optional, ersetzt datev.mandantennummer für dieses Hotel
output:
  dir: ./exports
checks:
  aggregates: false     # zusätzliche Vollständigkeitsprüfung, siehe unten
```

## Welche Tage sich exportieren lassen

apaleo veröffentlicht nicht, ob der Tagesabschluss (Night Audit) einen Tag geschlossen hat. Das Tool nutzt deshalb Datumsregeln in der Zeitzone des Hotels:

- Einen Zeitraum, der bis heute (oder später) reicht, lehnt es mit `E-DAY-NOT-CLOSED` ab.
- Einen Zeitraum, der gestern endet, exportiert es mit der Warnung `W-RECENT-DAY`: Der Tagesabschluss ist vielleicht noch nicht gelaufen, spätere Buchungen für diesen Tag sind also möglich. Exportiere nach Möglichkeit nur bis vorgestern.

Ein Zeitraum wird an Monatsgrenzen und am Wirtschaftsjahresbeginn (`datev.wjBeginn`) geteilt, damit jede Datei in einem Monat und einem Wirtschaftsjahr bleibt. Der WJ-Beginn im Kopfsatz ist der letzte Wirtschaftsjahresbeginn am oder vor dem ersten Tag der Datei: Mit `wjBeginn: "07-01"` bekommt der März 2027 den WJ-Beginn 2026-07-01.

## Was vor dem Schreiben geprüft wird

Für jedes Hotel und jeden Monat, in dieser Reihenfolge:

1. Das Hotel und jede apaleo-Zeile des Monats sind in EUR (`E-CURRENCY`). Die DATEV-Datei weist alle Beträge als EUR aus, und das Tool rechnet nicht um; ein Hotel in CHF oder einer anderen Währung wird deshalb abgelehnt.
2. Die Kontenzuordnung lässt sich lesen, und der Kontenrahmen ist bekannt (`datev.skr` oder die Kontenzuordnung; `E-SKR-UNKNOWN`, `E-SKR-CONFLICT`).
3. Jedes im Zeitraum gebuchte Konto ist zugeordnet (`E-UNMAPPED`, `E-VAT-MISMATCH`, `E-VAT-RATE-UNKNOWN`, wie bei `mapping check --from --to`).
4. Die Buchungsregeln und ihre USt-Prüfung pro Zeile ([posting-rules.md](posting-rules.md)).
5. Plausibilitätsprüfungen auf dem Ergebnis, die nachrechnen, was die Buchungen ergeben müssen:
   - `E-CONSERVATION`: Jede apaleo-Zeile ist gebucht oder übersprungen, nach Anzahl und Betrag ohne Vorzeichen.
   - `E-ACCOUNT-BALANCE`: Pro Geschäftstag und DATEV-Konto bewegen die Buchungen das Konto genau so wie die apaleo-Zeilen, die ihm zugeordnet sind. Das findet Fehler bei Soll/Haben und Vorzeichen.
   - `E-VAT-TOTAL`: Pro USt-Satz entspricht die USt, die DATEV aus den Buchungen rechnen wird, der Summe der Steuerbeträge von apaleo, jeder pro Zeile auf Cent gerundet, mit höchstens einem Cent pro gemeldeter Rundungsdifferenz bei diesem Satz (Rundungen bei einem Satz entschuldigen nie eine Differenz bei einem anderen). Die Meldung nennt auch die genaue Summe von apaleo und die Rundungsdifferenz der Zeilen. Dass die USt von DATEV um ein paar Cent von der genauen Summe von apaleo abweicht, ist allein nie ein Fehler (siehe unten).
6. Optional (`checks.aggregates: true`): die Tagessummen von apaleo, eine Anfrage pro Geschäftstag, gegen die Zeilen des Buchungsjournals an diesem Tag. Verglichen wird pro Konto, das apaleo listet, der **Saldo** (Soll minus Haben): globale Konten wie Zahlungsarten, Erlös- und USt-Unterkonten für sich, Gast-, externe und Buchungskonten über ihr oberstes Elternkonto (`1200`, `3000`, `9999`); Erlöse und Anzahlungen mit dem genauen Nettobetrag, die USt-Konten von apaleo mit den genauen Steuern der Erlös- und Anzahlungszeilen, alle anderen Konten brutto. So passten im ersten Live-Test alle Konten. Ein Konto, dessen Saldo abweicht, ergibt die Warnung `W-AGGREGATE-DIFF` mit beiden Salden und der Grundlage (brutto, netto oder Steuer); die Datei wird trotzdem geschrieben. Dafür braucht es die optionale Berechtigung `core.subledger_aggregate.create`; ohne sie scheitert der Monat mit `E-AGGREGATE-CHECK` und einem Hinweis, sie zu vergeben. Ist apaleo nicht erreichbar oder antwortet mit einem anderen Fehler, scheitert der Monat ebenfalls mit `E-AGGREGATE-CHECK`; starte ihn später noch einmal. Standardmäßig aus: Die Regel stammt aus einer Sandbox und zwei Tagen und ist für Produktivkonten noch nicht bestätigt.

Jeder Befund mit `E-` stoppt dieses Hotel und diesen Monat: Dafür wird keine Datei geschrieben, und die anderen Hotels und Monate laufen weiter. Warnungen (`W-`) werden ausgegeben und im Protokoll festgehalten.

Ein Monat ohne Buchungen schreibt keine Datei (`N-NO-BOOKINGS`).

### USt im Protokoll: DATEV pro Buchung, apaleo genau

Das Protokoll und der Probelauf zeigen pro USt-Satz, für die Erlöse und für die Anzahlungen, die USt, die DATEV rechnen wird, daneben die USt von apaleo und die Differenz, zum Beispiel am Live-Tag BER:

```
Revenue and VAT per rate:
  7 %: gross 571.22, DATEV VAT 37.38, apaleo VAT 37.37, difference 0.01 (apaleo precise 37.3695327)
  19 %: gross 47.38, DATEV VAT 7.57, apaleo VAT 7.56, difference 0.01 (apaleo precise 7.56487395)
```

DATEV rechnet die USt aus jeder Buchung und rundet sie auf den Cent; apaleo hält die Steuer jeder Zeile genau (bis zu acht Nachkommastellen) und rundet erst die Summe. Die Differenz von ein paar Cent ist diese Rundung, kein Fehler, und kein Grund, Buchungen zu ändern. In der Umsatzsteuer-Voranmeldung zählt, was DATEV gebucht hat.

## Ausgabeordner

```
exports/
  BSP/
    2026-10/
      EXTF_Buchungsstapel_1234567_42_20261001-20261031_BSP.csv
      EXTF_Buchungsstapel_1234567_42_20261001-20261031_BSP.protokoll.txt
      manifest.json
```

- Die EXTF-Datei ist das, was die Kanzlei importiert. Benenne sie nicht um (DATEV importiert nur Namen, die mit `EXTF_` beginnen), und öffne und speichere sie nicht in Excel.
- Das Protokoll ist die Übersicht des Probelaufs (Summen pro DATEV-Konto, Erlöse und USt pro Satz, Anzahlungen und ihre USt pro Satz, Kurtaxe, Zahlungen pro Geldtransitkonto, erhaltene, aufgelöste und erstattete Anzahlungen, Debitor, übersprungene Zeilen, Befunde) plus die SHA-256-Prüfsumme der Datei, die der Kontenzuordnung und die Version des Tools.
- `manifest.json` listet jede Datei des Ordners mit ihrer SHA-256-Prüfsumme, der Prüfsumme ihres Inhalts (ohne die Kopfzeile, die die Erstellungszeit enthält), der Anzahl der Buchungen, der Summe aller Buchungsbeträge, der Prüfsumme der Kontenzuordnung, der Version des Tools und der Erstellungszeit.
- `sollTotal`, `habenTotal` und `amountTotal` im Manifest sind dieselbe Summe: die Summe aller Buchungsbeträge der Datei. DATEV zählt jeden Betrag einmal im Soll und einmal im Haben, also sieht die Kanzlei nach dem Import genau diese Summe als Summe Soll und Summe Haben. (Bis 0.1.0 waren `sollTotal` und `habenTotal` die Summen der Buchungen mit Kennzeichen `S` und `H`; ein Skript, das sie liest, liest jetzt die Gesamtsumme. `amountTotal` ist der eindeutige Name.)

## Noch einmal exportieren

DATEV erkennt einen schon importierten Stapel nicht wieder: Dieselben Buchungen zweimal zu importieren, bucht sie zweimal. Der Export nutzt deshalb den Ausgabeordner als Gedächtnis:

- Dieselbe Datei wie die im Ordner (nur die Erstellungszeit im Kopfsatz ist anders): `unchanged`, nichts wird geschrieben, Exit-Code 0. Denselben Monat noch einmal zu exportieren, ist also immer sicher.
- Andere Buchungen (eine Nachbuchung, eine geänderte Kontenzuordnung) oder ein anderer Kopfsatz (geändertes `datev.wjBeginn`, `datev.festschreibung` oder `datev.skr`): abgelehnt mit `E-FILE-EXISTS`. Hat die Kanzlei die alte Datei importiert, muss sie diesen Stapel zuerst in DATEV löschen. Dann starte den Export noch einmal mit `--overwrite`. Ein Stapel, der mit Festschreibung 1 importiert wurde, lässt sich nicht löschen: Dann nie eine Datei aus `--overwrite` importieren, die Kanzlei bucht die Differenz von Hand anhand der Übersicht aus `--dry-run` ([datev-import.md](datev-import.md)). Mit `--overwrite` bleibt die alte Datei als `<name>.replaced-<Zeitstempel>.csv` erhalten (ihr Protokoll ebenso), die neue Datei wird geschrieben, und das Manifest verzeichnet beide.
- Ein anderer Zeitraum, der einige derselben Tage abdeckt wie eine Datei im Ordner (zum Beispiel ein Monatsexport nach einem Teilexport): abgelehnt mit `E-PERIOD-OVERLAP`, weil der Import beider Dateien diese Tage doppelt buchen würde. Verschiebe zuerst die alte Datei, und lass die Kanzlei ihren Stapel löschen, falls sie importiert wurde.

Der Vergleich liest die Datei selbst, er funktioniert also auch, wenn `manifest.json` gelöscht wurde. Ist die Datei unverändert, aber ihr Protokoll oder ihr Eintrag im Manifest fehlt oder beschreibt eine andere Datei (zum Beispiel weil `manifest.json` gelöscht oder ein Lauf nach dem Schreiben der CSV-Datei unterbrochen wurde), schreibt der Lauf beides neu und meldet den Hinweis `N-COMPANIONS-REPAIRED`; die CSV-Datei selbst bleibt unberührt.

Während ein Lauf in einen Ordner für Hotel und Monat schreibt, hält er dort die Sperrdatei `.apaleo-datev.lock` und prüft noch einmal, dass die Datei auf der Festplatte noch die ist, die er verglichen hat. Ein zweiter Lauf, der gleichzeitig startet, scheitert für diesen Monat mit `E-EXPORT` und schreibt nichts; starte ihn noch einmal, wenn der erste fertig ist. Wurde ein Lauf beim Schreiben abgebrochen, kann die Sperrdatei übrig bleiben: Wenn kein anderer Lauf aktiv ist, lösch sie und starte noch einmal.
