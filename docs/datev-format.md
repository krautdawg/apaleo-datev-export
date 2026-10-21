# DATEV-Format (EXTF) Buchungsstapel: was der Writer macht und warum

Diese Seite hält fest, was `src/datev` schreibt, gegen welche Quellen es geprüft wurde und welche Entscheidungen sich nicht von selbst aus dem Code ergeben. Sie ist für Mitwirkende und für die Steuerberatung, die die ersten Importe prüft.

Zuletzt geprüft: **2026-10-20**.

## Geprüfte Quellen

| Quelle | Was verwendet wurde | Datum |
|---|---|---|
| DATEV-Formatbeschreibung, [Header](https://developer.datev.de/de/file-formats/details/datev-format/format-description/header) | die 31 Felder des Kopfsatzes, ihre Ausdrücke und der Beispiel-Kopfsatz von DATEV | gelesen 2026-10-20 |
| DATEV-Formatbeschreibung, [Buchungsstapel](https://developer.datev.de/de/file-formats/details/datev-format/format-description/booking-batch) | die 125 Feldausdrücke (Typen, Längen), Feld 9 BU-Schlüssel, Feld 114 Festschreibung | gelesen 2026-10-20 |
| DATEV [Zeichensatz](https://developer.datev.de/de/file-formats/details/datev-format/character-set), Notation der Ausdrücke, Änderungsprotokoll | CP1252 als Standard, Unicode nur mit BOM und nicht für `KrStaPv`; `\w` heißt `[a-zA-Z0-9_]`; Formatversion 13 seit Februar 2024, Korrekturen der regulären Ausdrücke im März 2025 | gelesen 2026-10-20 |
| DATEV-Beispieldaten „Musterdaten DATEV-Format“ (Download auf den Formatseiten), Datei `EXTF_Buchungsstapel.csv` vom 2025-06-18 | die Zeile mit den Spaltenüberschriften, wie BU-Schlüssel und leere Felder in der Praxis geschrieben werden | gelesen 2026-10-20 |
| [ameax/datev-extf](https://github.com/ameax/datev-extf) (MIT, PHP), `src/DatevExtfWriter.php` | unabhängige Gegenprüfung der Feldreihenfolge (nur gelesen, kein Code übernommen) | gelesen 2026-10-20 |

Die Seiten auf developer.datev.de werden im Browser aufgebaut; ihr Inhalt wurde aus dem JSON-Feed gelesen, den die Seiten laden (`/mediator/strapi/file-formats/slug/datev-format`).

## Was der Writer erzeugt

- Zeile 1: der Kopfsatz `"EXTF";700;21;"Buchungsstapel";13;…` mit 31 Feldern. Textfelder stehen in Anführungszeichen (ein leeres Textfeld ist `""`), Zahlen und Datumsangaben nicht, die reservierten Positionen 7, 23, 25, 26, 28 und 29 sind leer, und 10, 24 und 30 werden als `""` geschrieben (siehe unten).
- Zeile 2: die 125 Spaltennamen der Formatversion 13, getrennt durch `;`, ohne Anführungszeichen.
- Eine Zeile pro Buchung mit genau 125 Feldern.
- Windows-1252 (CP1252), ohne Byte-Order-Mark, Trennzeichen `;`, CRLF nach jeder Zeile, auch nach der letzten, Dezimalkomma, kein Tausendertrennzeichen.
- Dateiname `EXTF_Buchungsstapel_<Berater>_<Mandant>_<JJJJMMTT>-<JJJJMMTT>[_<Zusatz>].csv`. DATEV importiert nur Dateien, deren Name mit `EXTF_` beginnt. Benenne die Datei nicht um, und öffne und speichere sie nicht in Excel.

Gefüllte Spalten einer Buchung: 1 Umsatz, 2 Soll/Haben-Kennzeichen, 7 Konto, 8 Gegenkonto, 9 BU-Schlüssel, 10 Belegdatum (`TTMM`), 11 Belegfeld 1, 12 Belegfeld 2, 14 Buchungstext, 37 KOST1, 38 KOST2, 114 Festschreibung. Jede andere Spalte ist leer.

## Spaltennamen

Die 125 Namen in `src/datev/columns.ts` sind aus der Überschriftenzeile der Beispieldatei von DATEV übernommen. Die geschriebene Überschriftenzeile ist mit dieser Zeile identisch (geprüft durch Dekodieren beider Zeilen, 2026-10-20). Die Tabelle auf der Seite der Formatbeschreibung und ameax/datev-extf haben dieselben 125 Felder in derselben Reihenfolge; sie unterscheiden sich nur in der Schreibweise (zum Beispiel `KOST1 -Kostenstelle` gegen `KOST1 - Kostenstelle`, `Leerfeld` gegen `Buchungs GUID` an Position 103). DATEV liest die Daten nach Position, die Schreibweise der Überschriften beeinflusst den Import also nicht.

## Entscheidungen

### BU-Schlüssel: in Anführungszeichen, nicht aufgefüllt (GEPRÜFT an der Beispieldatei von DATEV)

Der Feldausdruck ist `^(["]\d{4}["])$`, was man als „genau vier Ziffern“ lesen könnte. Die Beispieldatei von DATEV schreibt BU-Schlüssel aber ohne Auffüllen und in Anführungszeichen: `"3"`, `"9"`, `"40"`, `"501"`, `"6501"`. Der Writer macht es genauso: `BU_KEY_PAD = 0` in `src/datev/format.ts`, Schlüssel 3 wird also `"3"` geschrieben. Schlüssel mit einer bis vier Ziffern werden angenommen; alles andere lehnt der Writer mit `E-EXTF-BU-KEY` ab.

Ein echter DATEV-Import hat das noch nicht bestätigt. Es steht auf der Checkliste für den ersten Import unten.

### Festschreibung: im Kopfsatz standardmäßig 0 und in Feld 114 wiederholt

Feld 21 des Kopfsatzes ist standardmäßig `0`, damit ein Stapel in DATEV bearbeitbar bleibt. Ein festgeschriebener Stapel lässt sich weder korrigieren noch löschen, also nach einer Nachbuchung auch nicht ersetzen (das Tool schreibt keinen Differenzstapel), und die ersten Importe einer neuen Kontenzuordnung brauchen oft einen zweiten Anlauf. Setze `festschreibung: 1` erst, wenn die Kanzlei der Ausgabe vertraut und die Exporte warten, bis ein Zeitraum abgeschlossen ist; siehe [datev-import.md](datev-import.md).

Die Beschreibung des Buchungsfelds 114 sagt: „leer = nicht definiert; wird automatisch festgeschrieben“, und die Beispieldatei von DATEV füllt das Feld in jeder Zeile. Der Writer wiederholt deshalb den Wert aus dem Kopfsatz in Feld 114 jeder Zeile. Das kam während der Umsetzung dazu; die ursprüngliche Spezifikation ließ Feld 114 leer.

### Kontonummern werden nie aufgefüllt

Konto und Gegenkonto dürfen nur aus Ziffern bestehen, nicht null sein und müssen genau die Sachkontenlänge haben (Sachkonto) oder eine Stelle mehr (Personenkonto). Bei Sachkontenlänge 5 wird `1360` abgelehnt (`E-EXTF-ACCOUNT`), statt als `01360` geschrieben zu werden, denn das wäre ein anderes Konto.

### Texte bereinigen

- Belegfeld 1 und 2: Umlaute und ß werden zu `ae oe ue ss`, andere Akzente fallen weg (`é` → `e`), Leerzeichen werden zu `-`, jedes Zeichen außerhalb von `A-Z a-z 0-9 $ & % * + - /` wird entfernt. Belegfeld 1 wird auf 36 Zeichen gekürzt, Belegfeld 2 auf 12.
- Buchungstext, KOST1, KOST2: Tabulatoren und Zeilenumbrüche werden zu Leerzeichen, andere Steuerzeichen werden entfernt, Zeichen außerhalb von CP1252 werden umgeschrieben (`ć` → `c`, `−` → `-`) oder durch `?` ersetzt. Der Buchungstext wird auf 60 Zeichen gekürzt, KOST1 und KOST2 auf 36.
- Jede Änderung ist eine Warnung (`W-EXTF-BELEGFELD`, `W-EXTF-CONTROL-CHARS`, `W-EXTF-CHARSET`, `W-EXTF-TRUNCATED`) mit der Nummer der Buchung, dem Feld und dem ursprünglichen Wert.

### Kopfsatz-Felder 10, 24 und 30: `""`, nicht leer

Die Ausdrücke von DATEV für Importiert von (10, `^["]\w{0,25}["]$`), Derivatskennzeichen (24, `^["]["]$`) und reserviert (30, `^["]["]$`) stehen in Anführungszeichen, anders als 7, 23, 25, 26 und 29 (`^[]$`). Der Beispiel-Kopfsatz von DATEV schreibt genau an diesen Positionen `""`, und der Writer macht es genauso. Der erste Stand hat sie leer geschrieben; geändert nach dem Review von PR #3.

### Textfelder im Kopfsatz: keine Steuerzeichen

Ein Zeilenumbruch in Bezeichnung, Herkunft oder Exportiert von (zum Beispiel aus einem YAML-Block in der Konfiguration) würde die erste Zeile teilen, und DATEV würde die Datei ablehnen. Der Writer lehnt einen solchen Kopfsatz mit `E-EXTF-HEADER` ab, statt ihn zu bereinigen, denn diese Werte kommen aus der Konfiguration und sollten dort korrigiert werden.

### Zerlegte Umlaute

Manche Systeme (Dateinamen unter macOS, manche Webformulare) schicken `ü` als `u` + U+0308. Jeder Text wird zusammengesetzt (NFC), bevor er bereinigt oder kodiert wird. So wird er im Buchungstext zu `0xFC` und in Belegfeld 1 zu `ue`, nicht zu `u?` oder `u`.

### Meldungen für das Backoffice

Befunde nennen Felder so, wie DATEV sie nennt (`Umsatz`, `Konto`, `Belegdatum`), in der Eigenschaft `label` und in der Meldung, und `formatFinding` zählt Buchungen ab 1 (`booking 4`). Die Eigenschaften `field` und `index` (ab 0 gezählt) bleiben für Code und Tests.

### Erzeugt am

Geschrieben als `YYYYMMDDHHMMSSFFF` in deutscher Ortszeit (`Europe/Berlin`), unabhängig von der Zeitzone des Rechners. Die Uhrzeit wird übergeben (`erzeugtAm`), damit die Golden Files stabil bleiben.

## Wo der Writer strenger oder großzügiger ist als die Ausdrücke von DATEV

| Feld | Ausdruck von DATEV | Writer | Warum |
|---|---|---|---|
| Belegfeld 1 | `[\w$&%*+\-\/]{0,36}`, `\w` schließt `_` ein | entfernt `_` | die Projektspezifikation nennt die erlaubten Zeichen ohne `_`; strenger ist sicher |
| Belegfeld 2 | `[\w$&%*+\-\/]{0,36}` | gekürzt auf 12 | das Design des Projekts und ältere DATEV-Versionen nutzen 12 |
| KOST1, KOST2 | `[\w ]{0,36}` | nur Länge und CP1252 geprüft | die Namen der Kostenstellen kommen aus deiner Kontenzuordnung; DATEV lehnt ein `-` oder einen Umlaut vielleicht ab |
| Bezeichnung (Kopfsatz 17) | `[\w.-/ ]{0,30}` | nur Länge geprüft | DATEV lehnt Umlaute vielleicht ab; halte den Namen des Stapels schlicht |
| Exportiert von (Kopfsatz 9) | `\w{0,25}` | Standard `apaleo-datev-export` (mit `-`) | Projektspezifikation; mit `exportiertVon` änderbar, falls DATEV den Wert ablehnt |

## Checkliste für den ersten Import in der Kanzlei

Schick bitte das DATEV-Importprotokoll des ersten Imports (Stapelverarbeitung). Prüfe besonders:

1. Die Datei wird ohne Formatfehler angenommen (Zeichensatz, Kopfsatz, Feldanzahl).
2. Eine Buchung mit BU-Schlüssel (`"3"`) zeigt in DATEV den richtigen Steuerschlüssel (Auffüllen des BU-Schlüssels).
3. Der Stapel ist nach dem Import nicht festgeschrieben, wenn Festschreibung 0 ist.
4. Das Feld „Exportiert von“ im Kopfsatz (`apaleo-datev-export`) erzeugt keine Warnung.
5. Kostenstellen (KOST1/KOST2) kommen an, falls ihr sie nutzt.
