# Import in DATEV

Für die Kanzlei: So kommt die Datei in DATEV Rechnungswesen, und darauf solltest du beim ersten Import achten. Keine Gewähr, keine Steuerberatung.

## Was du bekommst

Pro Hotel und Monat eine Datei `EXTF_Buchungsstapel_<Berater>_<Mandant>_<von>-<bis>_<Hotel>.csv` im DATEV-Format (Buchungsstapel, Formatversion 13, Windows-1252), daneben ein Protokoll `….protokoll.txt` mit den Summen pro Konto und USt-Satz und eine `manifest.json` mit Prüfsummen. Eine Beispieldatei mit Protokoll und Zuordnung liegt in [examples/](examples/).

## Import

1. Kopiere die Datei unverändert in einen Ordner, den DATEV lesen kann.
2. In DATEV Rechnungswesen: **Stapelverarbeitung**, Import von Buchungsstapeln im DATEV-Format. Wähle den richtigen Mandanten und das Wirtschaftsjahr. Die genaue Menüführung hängt von deiner DATEV-Version ab.
3. Prüfe das **Importprotokoll**: keine Formatfehler, die Anzahl der Buchungen entspricht dem Protokoll des Tools.
4. Vergleiche die Summen pro Konto und die Umsatzsteuer pro Satz mit dem Protokoll und mit den Berichten in apaleo.

Wer automatisch importiert: `KrStaPv` (die Stapelverarbeitung als Kommandozeile) liest nur Windows-1252, kein Unicode. Die Dateien dieses Tools sind Windows-1252, das passt.

## Festschreibung: 0 oder 1

`datev.festschreibung: 0` (Standard) lässt den Stapel nach dem Import bearbeitbar. Bei `1` wird er festgeschrieben und kann weder geändert noch gelöscht werden. Der Wert steht im Kopf der Datei und in jeder Buchungszeile (Feld 114).

Das hat eine Folge für Nachbuchungen: Ein festgeschriebener Stapel lässt sich nicht durch eine neue Datei ersetzen. Das Tool erzeugt keinen Differenz- oder Korrekturstapel. Kommt nach dem Import einer Datei mit Festschreibung 1 eine Nachbuchung, importiert die Kanzlei **nie** die Datei aus `export --overwrite`, sonst stehen alle Buchungen des Monats doppelt im Mandanten. Sie bucht die Differenz von Hand; `export --month <YYYY-MM> --dry-run` zeigt die neuen Summen pro Konto zum Vergleich mit dem Protokoll der importierten Datei.

Bleib deshalb bei 0, bis die Zuordnung ein paar Monate ohne Korrektur durchgelaufen ist. Stelle danach nur dann auf 1 um, wenn die Kanzlei das möchte **und** spät genug exportiert wird: mit `schedule --once` (das schreibt einen Zeitraum erst ab `schedule.finalAfter` am zweiten Tag nach seinem Ende) oder bei `export` von Hand höchstens bis vorgestern. Nachbuchungen auf alte Monate (etwa eine stornierte Rechnung) bleiben trotzdem möglich.

## Drei Regeln

- **Nie in Excel öffnen und speichern.** Excel ändert Zeichensatz, Trennzeichen, Datumsformate und führende Nullen; DATEV lehnt die Datei dann ab oder bucht falsch. Zum Ansehen nimm einen Texteditor oder das Protokoll.
- **Nie umbenennen.** DATEV importiert nur Dateien, deren Name mit `EXTF_` beginnt, und der Name zeigt Berater, Mandant und Zeitraum.
- **Nie zweimal importieren.** DATEV erkennt einen schon importierten Stapel nicht: Dieselben Buchungen stünden doppelt im Mandanten. Das Tool schreibt einen Monat nur einmal. Kommt später eine Nachbuchung, lehnt es den Monat mit `E-FILE-EXISTS` ab. Ist der alte Stapel nicht festgeschrieben (Festschreibung 0), lösche ihn zuerst in DATEV, danach schreibt `export --overwrite` die neue Datei. Ist er festgeschrieben (Festschreibung 1), lässt er sich nicht löschen: Dann importiere keine neue Datei, sondern buche die Differenz von Hand (siehe oben).

```sh
apaleo-datev export --month 2026-10 --dry-run      # was hat sich geändert?
apaleo-datev export --month 2026-10 --overwrite    # nur bei Festschreibung 0, erst nachdem der alte Stapel in DATEV gelöscht ist
```

## Erster Import: bitte prüfen

1. Die Datei wird ohne Formatfehler angenommen (Zeichensatz, Kopf, Feldanzahl).
2. Eine Buchung mit BU-Schlüssel (`"3"`) zeigt in DATEV den richtigen Steuerschlüssel.
3. Der Stapel ist nach dem Import nicht festgeschrieben, wenn Festschreibung 0 ist.
4. Das Feld „Exportiert von“ (`apaleo-datev-export`) erzeugt keine Warnung.
5. Kostenstellen (KOST1, KOST2) kommen an, falls ihr sie nutzt.

Schick uns gern das Importprotokoll (ohne Namen und Beträge) als Issue, wenn etwas nicht passt. Mehr zum Format: [datev-format.md](datev-format.md).
