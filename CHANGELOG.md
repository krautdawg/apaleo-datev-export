# Änderungsprotokoll

Alle wichtigen Änderungen an diesem Projekt stehen in dieser Datei.

Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), und dieses Projekt hält sich an die [Semantische Versionierung](https://semver.org/lang/de/spec/v2.0.0.html).

## [Unveröffentlicht]

## [0.1.1] - 2026-10-21

**Wichtige Korrektur für echte apaleo-Daten**

Der erste Test gegen eine echte apaleo-Sandbox (Hotels BER und VIE, 2026-10-21) hat gezeigt, dass 0.1.0 echte Daten nicht exportieren konnte. Diese Korrekturen beheben das; die aufgezeichneten Antworten liegen anonym in `test/fixtures/apaleo/live/`, und die Tests lassen den ganzen Export darüber laufen.

### Behoben

- **Genaue Beträge**: apaleo schickt Netto- und Steuerbeträge mit bis zu acht Nachkommastellen. 0.1.0 brach dabei ab („is not a whole number of cents“). Jetzt bleiben sie genau erhalten; nur der Bruttobetrag muss ganze Cent sein, und Brutto muss Netto plus Steuern sein.
- **Kontenzuordnung**: Eine leere Elternzeile (`3000;Liabilities` aus der Vorlage) blockiert die `*`-Zeilen nicht mehr. Debitorenkonten pro Reservierung und ihre `/Offset`-Konten landen über `*;AccountsReceivable;;;10000` auf dem Sammeldebitor. `E-UNMAPPED` meldet Konten pro Reservierung einmal pro Elternkonto, Typ und Satz und nennt die `*`-Zeile, die fehlt.
- **Tagessummen** (`checks.aggregates`): Der Vergleich läuft über den Saldo pro Konto, so wie apaleo die Summen wirklich bildet (Erlöse und Anzahlungen netto, USt-Konten mit den genauen Steuern, sonst brutto). Auf den echten Daten passen alle Konten; 0.1.0 meldete falsche Abweichungen.
- **Anzahlungen in der Übersicht**: Eingang, Auflösung und Erstattung werden nach Seite und Vorzeichen erkannt; apaleo bucht Auflösungen als negative Belastung. 0.1.0 zeigte sie als Eingang.
- **USt-Vergleich**: Protokoll und Probelauf zeigen pro Satz die USt von DATEV (pro Buchung gerundet) neben der genauen USt von apaleo und der Differenz, für Erlöse und Anzahlungen. `E-VAT-TOTAL` erlaubt genau die Rundung der Zeilen und nennt die genaue Summe.
- **Buchungstexte auf Deutsch**: zum Beispiel `Erlös Logis 7 %`, `Auflösung Anzahlung 7 %`, `Erstattung Anzahlung 0 %`, `Zahlung Visa`, `Forderung an Debitor`, `Kurtaxe / City Tax` statt englischer Kontonamen aus apaleo.
- **Übersprungene Zeilen** zeigen ihre Summe ohne Vorzeichen; die zweiten Zeilen jeder Zahlung (`/Offset`) ergaben in 0.1.0 eine negative Summe.
- **`live-smoke`** warnt bei einem Tag ohne Buchungen, statt ihn als bestanden zu melden, zählt Anzahlungszeilen nach Eingang, Auflösung und Erstattung und vergleicht die Tagessummen über den Saldo.
- **Dokumentation**: die echten Bildschirme von apaleo beim Anlegen der Custom App (personenbezogene Daten: **Omit all**), `/Offset`-Konten, Zahlungen auf Rechnungen ohne Zeile im Buchungsjournal (`performAccountingForOpenInvoiceActions`), Hotels in Österreich.

### Geändert

- **Summen im Manifest**: `sollTotal` und `habenTotal` in `manifest.json` sind jetzt beide die Summe aller Buchungsbeträge, so wie die Kanzlei nach dem Import Summe Soll und Summe Haben sieht; dazu kommt `amountTotal` mit demselben Wert. Bis 0.1.0 waren es die Summen der Buchungen mit Kennzeichen `S` und `H`. Ein Skript, das diese Felder liest, muss angepasst werden.
- **Vorlage Version 2** (`skr03-hotel@2`, `skr04-hotel@2`): keine leere Zeile mehr für `3000` Liabilities, `*`-Zeilen für Debitoren und Forderungsverluste, Vorschläge für No-Show- und Stornoerlöse zu 7 % (8300 / 4300), die historischen Sätze 16 % und 5 % von 2020 bewusst leer, und der Hinweis `N-FOREIGN-VAT-RATES` bei fremden Sätzen (Österreich).
- **Umstieg**: Bestehende Kontenzuordnungen funktionieren weiter. `apaleo-datev init-mapping --property <id> --skr 03 --update` (oder `--skr 04`) ändert keine Zeile, hängt die neuen `*`-Zeilen an und meldet mit `N-PARENT-ROW-EMPTY` und `N-TEMPLATE-SUGGESTION`, was du prüfen solltest.
- **Erneuter Export**: Wegen der neuen Buchungstexte unterscheidet sich eine neu erzeugte Datei von einer Datei aus 0.1.0, und der Export lehnt sie mit `E-FILE-EXISTS` ab. Nutze `--overwrite` erst, wenn die Kanzlei den alten Stapel in DATEV gelöscht hat.
- **Dokumentation auf Deutsch**: Das README und die gesamte Dokumentation sind jetzt deutsch und sagen „du“; ein kurzes `README.en.md` erklärt das Tool für internationale Mitwirkende. `docs/setup-apaleo.de.md` und `docs/mapping-guide.de.md` heißen jetzt `docs/setup-apaleo.md` und `docs/mapping-guide.md`, die englischen Fassungen sind entfallen. `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, die Vorlagen für Issues und Pull Requests und die Kommentare in den Beispieldateien sind deutsch, `CODE_OF_CONDUCT.md` ist die offizielle deutsche Übersetzung des Contributor Covenant 2.1, und in `DISCLAIMER.md` ist die deutsche Fassung verbindlich. Der Docs-Test prüft jetzt auch Links, Anker und die Sprache. Code, Ausgaben der Kommandozeile und Commits bleiben englisch.

## [0.1.0] - 2026-10-21

### Hinzugefügt

- **Grundgerüst**: die Kommandozeile `apaleo-datev` mit `--help`, `--version` und `doctor`; Konfigurationsdatei in YAML oder JSON mit Werten aus der Umgebung und dem Client-Secret nur aus der Umgebung; MIT-Lizenz und ein Haftungsausschluss auf Deutsch und Englisch; CI für Typprüfung, Lint, Tests und Build.
- **Writer für das DATEV-Format**: EXTF-Buchungsstapel in Formatversion 13 mit dem Kopfsatz aus 31 Feldern, allen 125 Spalten, Windows-1252 und CRLF, Prüfung jedes Felds, Bereinigung der Texte in Belegfeld und Buchungstext, und Tests gegen Golden Files.
- **Quelle apaleo**: Lesezugriff über eine apaleo Custom App (Client Credentials), das Buchungsjournal pro Geschäftstag (`export-gross-daily`), der Kontenplan und die Tagessummen, mit Wiederholungen und Prüfung gegen die Swagger-Schemas; die Befehle `properties` und `live-smoke`.
- **Kontenzuordnung**: eine CSV-Datei pro Hotel, Hotel-Vorlagen für SKR03 und SKR04, `init-mapping` (auch mit `--update` und der Umwandlung eines Mapping-Exports von Grman) und `mapping check`, mit der Prüfung, dass jedes im Zeitraum gebuchte Konto zugeordnet ist.
- **Buchungsregeln**: eine DATEV-Buchung pro apaleo-Zeile, die USt-Seite im Gegenkonto, die Prüfung pro Zeile, dass DATEV die USt rechnet, die apaleo berechnet hat, Anzahlungen auf den Automatikkonten für versteuerte Anzahlungen, wobei die USt-Zeilen von apaleo übersprungen werden, die Ermittlung des Satzes für Auflösungen von Anzahlungen ohne USt, und keine Gästenamen im Buchungstext.
- **Befehl export**: `export --month` oder `--from`/`--to`, eine Datei pro Hotel und Monat, Datumsregeln für den Tagesabschluss, Plausibilitätsprüfungen (Vollständigkeit, Kontobewegungen, USt pro Satz, optional die Tagessummen), `--dry-run`, ein Protokoll und eine `manifest.json` neben jeder Datei, und erneute Läufe ohne doppelte Dateien, mit `--overwrite` für Nachbuchungen.
- **Zeitplan und Docker**: `schedule --once` mit monatlichem oder täglichem Rhythmus, Nachholen nach einem Ausfall und Warten, bis ein Zeitraum abgeschlossen ist; ein lokal gebautes Docker-Image und ein Compose-Beispiel mit einer stündlichen Schleife.
- **Dokumentation und Community**: ein vollständiges README auf Englisch und Deutsch, Anleitungen für Einrichtung, Kontenzuordnung, DATEV-Import, Konfiguration, Fehlerbehebung und Architektur, eine Beispielausgabe in `docs/examples/`, `export --demo` auf mitgelieferten Demodaten (der Dateiname endet auf `_DEMO`), Dateien für Mitwirkende, Sicherheit und Verhaltenskodex, Vorlagen für Issues und Pull Requests und ein Test, der die Dokumentation im Einklang mit dem Code hält.
