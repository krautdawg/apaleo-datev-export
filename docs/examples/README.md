# Beispielausgabe: „Hotel Beispiel“

Das schreibt das Tool, noch bevor jemand eine apaleo-App anlegt. Alles hier ist erfunden: das Hotel „Hotel Beispiel“ (`BSP`), die Beraternummer 1234567, die Mandantennummer 42, die Reservierungen und die Beträge. Hinter den Daten steht kein echtes Hotel und kein echter Gast. Die Kanzlei kann damit die Ausgabe prüfen, bevor jemand etwas einrichtet.

| Datei | Was sie ist |
|---|---|
| [`EXTF_Buchungsstapel_1234567_42_20260901-20260930_BSP.csv`](EXTF_Buchungsstapel_1234567_42_20260901-20260930_BSP.csv) | Der DATEV-Buchungsstapel für September 2026: 22 Buchungen aus 25 apaleo-Zeilen (Logis, Speisen und Getränke mit 7 % und 19 %, Kurtaxe, Karten- und Barzahlungen, eine Rechnung an eine Firma, zwei Anzahlungen und ihre Auflösung). |
| [`EXTF_Buchungsstapel_1234567_42_20260901-20260930_BSP.protokoll.txt`](EXTF_Buchungsstapel_1234567_42_20260901-20260930_BSP.protokoll.txt) | Das Protokoll, das daneben geschrieben wird: Summen pro DATEV-Konto, Erlöse und USt pro Satz, Kurtaxe, Zahlungen, Anzahlungen, übersprungene Zeilen, Befunde und Prüfsummen. |
| [`mapping-BSP.example.csv`](mapping-BSP.example.csv) | Die SKR03-Kontenzuordnung, aus der die Datei entstanden ist, mit der Entscheidung zur Kurtaxe (vom Gast geschuldet, als Durchlaufender Posten 1590) in der Spalte für Kommentare. |

**Öffne die EXTF-Datei nicht in Excel und speichere sie dort nicht.** Sie ist in Windows-1252 kodiert, mit `;` als Trennzeichen und CRLF am Zeilenende, genau so, wie DATEV sie importiert, und Excel ändert das alles. Zum Ansehen nimm einen Texteditor, oder öffne sie in Excel, ohne zu speichern. Eine Kanzlei kann sie in einen Test-Mandanten mit Beraternummer 1234567 und Mandantennummer 42 importieren.

Die EXTF-Datei ist das Golden File der Tests: Ein Test schlägt fehl, sobald sie von dem abweicht, was der aktuelle Code schreibt, und ein weiterer prüft das Protokoll und die Kontenzuordnung. So erzeugst du eine solche Datei selbst, ohne apaleo:

```sh
apaleo-datev export --month 2026-09 --demo
```

Die Demo markiert ihre Datei und ihr Protokoll mit `DEMO` und schreibt nach `./demo-output/`.
