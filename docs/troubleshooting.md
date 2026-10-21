# Fehlerbehebung: alle Befund-Codes

Jede Prüfung des Tools meldet einen Befund mit einem Code. Der Anfang des Codes sagt, wie ernst er ist:

- `E-` ist ein Fehler. Er stoppt das Hotel und den Monat, zu dem er gehört: Dafür wird keine Datei geschrieben. Andere Hotels und Monate laufen weiter.
- `W-` ist eine Warnung. Die Datei wird geschrieben; lies die Warnung und entscheide, ob etwas korrigiert werden muss.
- `N-` ist ein Hinweis. Es ist nichts falsch; er sagt dir, was passiert ist.

Die Codes sind dieselben in `export`, `export --dry-run`, `mapping check`, `init-mapping` und `schedule --once`, in der Protokolldatei und in der Ausgabe von Cron oder `docker logs`. Die Tests prüfen, dass diese Seite jeden Code aus dem Quellcode aufführt, und nur diese.

Meldungen nennen apaleo-Konten mit Nummer und Typ, nie mit Namen, überall dort, wo ein Gästename stehen könnte. Wenn du in einem Issue um Hilfe bittest, kannst du Code und Meldung einfügen, entferne aber vorher alle Namen.

Keine Gewähr, keine Steuerberatung: Wenn eine Lösung die Kontenzuordnung ändert, lass sie von deiner Steuerberatung bestätigen.

## Zeitraum und Hotel

| Code | Ursache | Lösung |
|---|---|---|
| `E-DAY-NOT-CLOSED` | Der Zeitraum reicht bis heute (oder später) in der Zeitzone des Hotels. apaleo hat diesen Tag noch nicht mit dem Tagesabschluss (Night Audit) geschlossen, Buchungen können sich also noch ändern. | Exportiere höchstens bis gestern, besser bis vorgestern. |
| `W-RECENT-DAY` | Der Zeitraum endet gestern. Der Tagesabschluss ist vielleicht noch nicht gelaufen, spätere Buchungen für diesen Tag sind also möglich. | Exportiere lieber nur bis vorgestern. Kommt eine Nachbuchung, siehe `E-FILE-EXISTS`. |
| `N-NOT-FINAL` | Nur bei `schedule --once`: Der Zeitraum ist fällig, aber sein letzter Tag ist noch nicht abgeschlossen (siehe `schedule.finalAfter` in [docker.md](docker.md)). Es wurde nichts abgerufen und nichts geschrieben. | Nichts zu tun. Der erste geplante Lauf nach dieser Uhrzeit exportiert ihn. |
| `E-PROPERTY-UNKNOWN` | Die Property-ID aus der Konfiguration oder aus `--property` ist für die apaleo Custom App nicht sichtbar. | Lass dir mit `apaleo-datev properties` die IDs anzeigen, die die App lesen darf. Prüfe die Hotel-Auswahl der Custom App in apaleo ([setup-apaleo.md](setup-apaleo.md)). |
| `E-CURRENCY` | Das Hotel oder eine Zeile im Buchungsjournal ist nicht in EUR. Die DATEV-Datei weist alle Beträge als Euro aus, und das Tool rechnet nicht um. | Nicht unterstützt. Das Tool funktioniert nur für Hotels, die ihre Bücher in EUR führen. |
| `N-NO-BOOKINGS` | apaleo hat für den Zeitraum keine Buchungen, also wurde keine Datei geschrieben. | Nichts zu tun, außer du hast Buchungen erwartet: Dann prüfe die Property-ID und die Daten. |

## Kontenzuordnung

Diese Befunde kommen aus `mapping check`, `init-mapping` und jedem Export, denn der liest zuerst die Kontenzuordnung. Spalten und Regeln: [mapping-guide.md](mapping-guide.md).

| Code | Ursache | Lösung |
|---|---|---|
| `E-UNMAPPED` | Ein im Zeitraum gebuchtes apaleo-Konto hat keine Zeile mit DATEV-Konto, oder seine Zeile lässt `datev_account` leer. Die Zeilen für die Kurtaxe und für die Sätze 16 % und 5 % von 2020 bleiben in der Vorlage absichtlich leer. Konten pro Reservierung oder Folio (zum Beispiel Anzahlungen unter `3000`) meldet der Befund einmal pro Elternkonto, Typ und Satz, mit bis zu drei Beispielen. | Folge der Meldung: Sie nennt die Zeile, in die `datev_account` gehört, oder die `*`-Zeile, die du ergänzen sollst, zum Beispiel `*;Liabilities;;7;<DATEV-Konto>;;7` (Vorlage: 1711) oder `*;AccountsReceivable;;;10000`. Eine leere Elternzeile wie `3000;Liabilities` füllst du nicht aus: Ein DATEV-Konto kann nicht jeden Satz abdecken. Frag deine Steuerberatung, welches Konto. Dann starte `apaleo-datev mapping check --property <id> --from <erster Tag> --to <letzter Tag>`. |
| `E-VAT-MISMATCH` | apaleo bucht das Konto mit einem USt-Satz, aber das DATEV-Konto (oder der BU-Schlüssel) seiner Zeile wendet einen anderen an, zum Beispiel ein Logis-Konto mit 7 %, das über die Zeile seines Elternkontos auf 8400 (19 %) landet. | Gib dem Konto eine eigene Zeile mit einem DATEV-Konto zum selben Satz. Der Satz von DATEV muss immer dem Satz von apaleo entsprechen. |
| `E-VAT-RATE-UNKNOWN` | Eine Auflösung einer Anzahlung kommt in apaleo ohne USt, und ihr Satz lässt sich weder aus einer `PostPrepaymentVat`-Zeile desselben Tages und derselben Reservierung noch aus dem Kontenplan ermitteln. Das Tool bucht eine solche Auflösung nie mit 0 %. | Starte `apaleo-datev live-smoke` für diesen Tag und eröffne ein Issue mit der anonymisierten Ausgabe; siehe [posting-rules.md](posting-rules.md). |
| `E-VAT-CONFLICT` | Der Wert in `datev_vat_percent` widerspricht dem Satz, den DATEV wegen des Automatikkontos oder des BU-Schlüssels anwendet. | Korrigiere `datev_vat_percent` auf den Satz aus der Meldung, oder ändere das DATEV-Konto oder den BU-Schlüssel. |
| `E-VAT-PERCENT` | `apaleo_vat_percent` oder `datev_vat_percent` ist keine Zahl. | Schreib eine einfache Zahl wie `7` oder `19`, oder lass das Feld leer. |
| `E-BU-KEY` | Der BU-Schlüssel hat nicht eine bis vier Ziffern. | Schreib nur Ziffern, zum Beispiel `3`, oder lass das Feld leer. |
| `E-BU-ON-AUTOMATIC` | Auf einem Automatikkonto (zum Beispiel 8300 im SKR03) steht ein BU-Schlüssel. Auf einem solchen Konto rechnet DATEV die USt selbst und lehnt die meisten BU-Schlüssel ab. | Lass `bu_key` auf Automatikkonten leer. Erlaubt sind dort nur `2x` (Generalumkehr) und `4x` (Aufhebung der Automatik). |
| `E-BU-INPUT-TAX` | Ein Vorsteuerschlüssel (`8` oder `9`) steht auf Erlösen, Anzahlungen, Abgaben oder Forderungsverlusten, die Umsatzsteuer schulden. | Nimm ein Automatikkonto mit leerem `bu_key` oder einen Umsatzsteuerschlüssel (`2` oder `3`). |
| `W-BU-KEY-UNCHECKED` | Das Tool kennt diesen BU-Schlüssel nicht und verlässt sich für die USt-Prüfung auf `datev_vat_percent`. | Stell sicher, dass `datev_vat_percent` der Satz ist, den DATEV mit diesem Schlüssel anwendet. |
| `E-ACCOUNT-DIGITS` | In `datev_account` steht etwas anderes als Ziffern. | Schreib nur Ziffern. Formatiere die Spalte in Excel als Text. |
| `E-ACCOUNT-LENGTH` | Das DATEV-Konto hat nicht genau die Sachkontenlänge (`datev.sachkontenlaenge`), bei einem Debitor eine Stelle mehr. | Schreib das Konto in der Länge der Kanzlei, zum Beispiel 83000 statt 8300 bei Sachkontenlänge 5. Vielleicht hat Excel führende Nullen entfernt. |
| `W-PADDED` | Bei Sachkontenlänge 4 hat ein Konto der Klasse 0 seine führenden Nullen verloren (650 statt 0650), und das Tool hat sie ergänzt. | Formatiere die Spalte `datev_account` in Excel als Text und speichere die Datei neu. |
| `W-UNKNOWN-TYPE` | `apaleo_type` ist keiner der Kontotypen von apaleo. | Korrigiere die Schreibweise (`Revenues`, `Payments`, `Liabilities`, ...). |
| `W-UNKNOWN-COLUMN` | Die Datei hat eine Spalte, die das Tool nicht nutzt. Sie wird ignoriert. | Nichts, außer du hast einen Spaltennamen falsch geschrieben. |
| `W-GRMAN-LAYOUT` | Die Datei ist der Mapping-Export eines anderen DATEV-Connectors (Spalten `ApaleoAccountNumber;DatevAccountNumber;CostCenter;CostCenter2`). Sie hat keine BU-Schlüssel und keine USt-Sätze. | Wandle sie mit `apaleo-datev init-mapping --property <id> --skr 03 --update` (oder `--skr 04`) um. |
| `N-SKR-UNKNOWN` | `mapping check` kennt den Kontenrahmen nicht, also wurden die Automatikkonten nicht geprüft. | Gib `--skr 03` oder `--skr 04` an, oder setze `datev.skr`. |
| `N-VAT-ROW-IGNORED` | Die Datei hat Zeilen für die apaleo-Konten `Vat` oder `VatOnLiabilities`. Diese Buchungen werden immer übersprungen, weil DATEV die USt rechnet. | Nichts. Du kannst diese Zeilen löschen. |
| `N-TEMPLATE-SCALED` | `init-mapping` hat an die Konten der Vorlage Nullen angehängt, damit sie zu einer Sachkontenlänge über 4 passen (aus 8300 wird 83000). | Nichts. Prüfe mit der Kanzlei, dass das ihren Konten entspricht. |
| `N-PARENT-ROW-EMPTY` | Nur bei `init-mapping --update`: Die Datei hat eine leere Zeile für ein Elternkonto, zum Beispiel `3000;Liabilities` aus der Vorlage-Version 1. Seit 0.1.1 blockiert sie nichts mehr: Die Konten darunter (Anzahlungen je Reservierung) laufen über die Platzhalterzeilen `*` ihres Typs und Satzes. | Nichts. Du kannst die Zeile löschen. |
| `N-TEMPLATE-SUGGESTION` | Nur bei `init-mapping --update`: Eine Zeile mit leerem `datev_account` hat in der aktuellen Vorlage einen Vorschlag, zum Beispiel No-Show- und Stornoerlöse zu 7 % auf 8300 (SKR03). Bestehende Zeilen ändert das Tool nie. | Trag das vorgeschlagene Konto in der genannten Zeile ein, wenn deine Steuerberatung zustimmt. |
| `N-FOREIGN-VAT-RATES` | Nur bei `init-mapping`: Der Kontenplan hat USt-Sätze, die die deutschen Vorlagen und die DATEV-Automatikkonten nicht kennen (zum Beispiel 10 %, 13 % und 20 % in Österreich). Die Zeilen dafür bleiben leer, und ein Export mit Buchungen darauf stoppt mit `E-UNMAPPED`. | Für ein österreichisches Hotel ist dieser DATEV-Export nicht gedacht; es braucht ein österreichisches Ziel wie BMD. |
| `E-SKR-UNKNOWN` | Der Export kennt den Kontenrahmen des Mandanten nicht: `datev.skr` ist nicht gesetzt, und die Kontenzuordnung nennt keine Vorlage. | Setze `datev.skr` auf `"03"` oder `"04"` (frag die Kanzlei). |
| `E-SKR-CONFLICT` | `datev.skr` und die Vorlage aus der Kontenzuordnung passen nicht zusammen. | Frag die Kanzlei, welchen Kontenrahmen der Mandant nutzt, und korrigiere eine der beiden Angaben. |

## Buchungsregeln und Umsatzsteuer

Das Tool rechnet keine Umsatzsteuer: Das macht DATEV. Diese Prüfungen stellen sicher, dass DATEV genau die USt rechnet, die apaleo berechnet hat. Einzelheiten: [posting-rules.md](posting-rules.md).

| Code | Ursache | Lösung |
|---|---|---|
| `W-VAT-ROUNDING` | Die USt von DATEV auf einer Zeile weicht um einen Cent von der von apaleo ab. Die Zeile wird gebucht, und die Differenz geht in die Rundungssumme der Übersicht. | Nichts. |
| `E-VAT-AMOUNT` | Die USt von DATEV auf einer Zeile weicht um mehr als einen Cent von der von apaleo ab. | Eröffne ein Issue mit der anonymisierten Zeile. Mit einer korrekten Kontenzuordnung sollte das nicht passieren. |
| `E-VAT-RATE` | Der Satz von apaleo auf der Zeile weicht von dem Satz ab, den DATEV auf dem zugeordneten Konto anwendet. Das passiert auch, wenn ein Zeitraum aus 2025 mit einer Kontenzuordnung für 2026 exportiert wird (Speisen 19 % vor 2026-01-01). | Korrigiere die Zeile der Kontenzuordnung, die die Meldung nennt, oder nimm eine Kontenzuordnung für dieses Jahr. |
| `E-VAT-MISSING` | apaleo hat USt berechnet, aber keines der beiden zugeordneten Konten lässt DATEV USt rechnen. | Ordne das Erlös- oder Anzahlungskonto einem Automatikkonto mit dem Satz von apaleo zu. |
| `E-VAT-UNEXPECTED` | apaleo hat keine USt berechnet, aber DATEV würde auf dem zugeordneten Konto welche rechnen. | Ordne das Konto einem Konto ohne USt zu, zum Beispiel 8200 im SKR03 für Erlöse ohne USt. |
| `E-VAT-MIXED` | Eine Zeile des Buchungsjournals hat mehr als einen USt-Satz. | Eröffne ein Issue mit der anonymisierten Zeile. |
| `E-VAT-SIGN` | USt und Bruttobetrag einer Zeile haben verschiedene Vorzeichen. | Eröffne ein Issue mit der anonymisierten Zeile. |
| `E-DATEV-RATE-UNKNOWN` | Der Satz, den DATEV auf einer Zeile der Kontenzuordnung anwendet, ist nicht bekannt: ein unbekannter BU-Schlüssel bei leerem `datev_vat_percent`. | Trag `datev_vat_percent` in dieser Zeile ein. |
| `E-TWO-VAT-SIDES` | Beide Seiten einer Zeile sind Konten mit USt zugeordnet, zum Beispiel eine Umbuchung zwischen zwei Erlöskonten. Das Tool kann nicht entscheiden, welche Seite DATEV versteuern soll. | Eröffne ein Issue mit der anonymisierten Zeile; bis dahin buche sie in DATEV von Hand. |
| `W-VAT-INFERRED` | Eine Auflösung einer Anzahlung ohne USt in apaleo hat ihren Satz aus dem Kontenplan bekommen, weil keine `PostPrepaymentVat`-Zeile gefunden wurde. | Prüfe die Auflösung im Protokoll. Teile bitte eine anonymisierte Ausgabe von `live-smoke`, damit sich die Regel bestätigen lässt. |

## Plausibilitätsprüfungen

Bevor eine Datei geschrieben wird, rechnet das Tool nach, was die Buchungen ergeben müssen. Diese Fehler bedeuten, dass das Tool selbst etwas falsch gemacht hat. Eröffne bitte ein Issue mit der anonymisierten Übersicht.

| Code | Ursache | Lösung |
|---|---|---|
| `E-CONSERVATION` | Nicht jede apaleo-Zeile ist gebucht oder übersprungen worden (nach Anzahl und Betrag ohne Vorzeichen). | Eröffne ein Issue. Es wurde keine Datei geschrieben. |
| `E-ACCOUNT-BALANCE` | An einem Geschäftstag bewegt sich ein DATEV-Konto in den Buchungen anders als die apaleo-Zeilen, die ihm zugeordnet sind. Das findet Fehler bei Soll/Haben und Vorzeichen. | Eröffne ein Issue. Es wurde keine Datei geschrieben. |
| `E-VAT-TOTAL` | Pro USt-Satz weicht die USt, die DATEV rechnen wird, um mehr als die gemeldeten Rundungsdifferenzen von der Summe der pro Zeile gerundeten Steuern von apaleo ab. Die Meldung nennt auch die genaue Summe von apaleo. Dass DATEV um ein paar Cent von dieser genauen Summe abweicht, ist allein nie dieser Fehler; das ist die Rundung pro Buchung (siehe [export.md](export.md)). | Eröffne ein Issue. Es wurde keine Datei geschrieben. |
| `W-AGGREGATE-DIFF` | Nur bei `checks.aggregates: true`: Der Saldo (Soll minus Haben) eines Kontos in den Tagessummen von apaleo weicht vom Saldo der Zeilen des Buchungsjournals an diesem Tag ab. Die Meldung nennt beide Salden und die Grundlage (brutto, netto oder Steuer). Die Datei wird trotzdem geschrieben. | Vergleiche den Tag mit den Berichten in apaleo. Teile den anonymisierten Befund in einem Issue. |
| `E-AGGREGATE-CHECK` | Nur bei `checks.aggregates: true`: Die Tagessummen von apaleo ließen sich nicht lesen, weil die optionale Berechtigung fehlt oder apaleo nicht erreichbar war. | Gib der Custom App die Berechtigung `core.subledger_aggregate.create`, versuch es später noch einmal oder setze `checks.aggregates: false`. |

## Ausgabeordner und erneute Läufe

Einzelheiten: [export.md](export.md).

| Code | Ursache | Lösung |
|---|---|---|
| `E-FILE-EXISTS` | Im Ausgabeordner liegt schon eine Datei für denselben Zeitraum, mit anderen Buchungen (eine Nachbuchung, eine geänderte Kontenzuordnung) oder einem anderen Kopfsatz (geändertes `datev.wjBeginn`, `datev.festschreibung` oder `datev.skr`). DATEV würde beide Dateien buchen. | Hat die Kanzlei die alte Datei mit Festschreibung 0 importiert, löscht sie diesen Stapel zuerst in DATEV. Dann starte denselben Export noch einmal mit `--overwrite`. Ein Stapel, der mit Festschreibung 1 importiert wurde, ist festgeschrieben und lässt sich nicht löschen: Dann nie eine Datei aus `--overwrite` importieren (jede Buchung des Monats stünde doppelt in DATEV); die Kanzlei bucht die Differenz von Hand anhand der Übersicht aus `--dry-run`. Siehe [datev-import.md](datev-import.md). |
| `E-PERIOD-OVERLAP` | Im Ordner liegt schon eine Datei für einen anderen Zeitraum, der einige derselben Tage abdeckt, zum Beispiel ein Monatsexport nach einem Teilexport. | Verschiebe die alte Datei. Wurde sie importiert, löscht die Kanzlei zuerst ihren Stapel. |
| `N-COMPANIONS-REPAIRED` | Die Datei war unverändert, aber ihr Protokoll oder ihr Eintrag in `manifest.json` fehlte oder war falsch (ein früherer Lauf wurde unterbrochen), und wurde neu geschrieben. | Nichts. |
| `E-EXPORT` | Ein Schritt des Exports ist fehlgeschlagen: Das Dateisystem hat das Schreiben verweigert (Rechte, volle Festplatte, schreibgeschützter Mount), ein anderer Lauf hielt die Sperre des Ordners, oder ein Problem mit der Kontenzuordnung oder mit apaleo hat den Monat gestoppt. Die Meldung sagt, was. | Folge dem Hinweis in der Meldung. Mit Docker braucht ein Ordner `./data`, der root gehört, `sudo chown -R 1000:1000 data`. Eine übrig gebliebene `.apaleo-datev.lock` aus einem abgebrochenen Lauf darfst du löschen, wenn kein anderer Lauf aktiv ist. |

## DATEV-Datei (EXTF)

Der Writer prüft jedes Feld gegen das DATEV-Format, bevor er eine Datei schreibt. Einzelheiten: [datev-format.md](datev-format.md).

| Code | Ursache | Lösung |
|---|---|---|
| `E-EXTF-HEADER` | Ein Wert im Kopfsatz liegt außerhalb des erlaubten Bereichs oder enthält einen Zeilenumbruch: Beraternummer (1001 bis 9999999), Mandantennummer (1 bis 99999), Sachkontenlänge (4 bis 8), Festschreibung, Datumsangaben, Bezeichnung. | Korrigiere den Wert in der Konfiguration (`datev.beraternummer`, `datev.mandantennummer`, ...). |
| `E-EXTF-PERIOD` | Der Zeitraum des Stapels ist vertauscht oder reicht über den Wirtschaftsjahresbeginn. | Prüfe `datev.wjBeginn`. Der Export teilt normalerweise selbst am Wirtschaftsjahresbeginn; eröffne ein Issue, wenn dieser Befund erscheint. |
| `E-EXTF-ACCOUNT` | Ein Konto oder Gegenkonto besteht nicht nur aus Ziffern, ist null oder hat nicht die Sachkontenlänge (bei einem Debitor eine Stelle mehr). | Korrigiere das Konto in der Kontenzuordnung. Konten werden nie aufgefüllt. |
| `E-EXTF-SAME-ACCOUNT` | Konto und Gegenkonto sind gleich. | Eröffne ein Issue: Solche Zeilen werden normalerweise vor dem Schreiben übersprungen. |
| `E-EXTF-AMOUNT` | Ein Betrag ist null, negativ oder zu groß für DATEV. | Eröffne ein Issue. |
| `E-EXTF-SIDE` | Das Soll/Haben-Kennzeichen ist nicht `S` oder `H`. | Eröffne ein Issue. |
| `E-EXTF-BU-KEY` | Ein BU-Schlüssel in einer Buchung hat nicht eine bis vier Ziffern. | Korrigiere `bu_key` in der Kontenzuordnung. |
| `E-EXTF-BELEGDATUM` | Ein Belegdatum ist ungültig oder liegt außerhalb des Zeitraums des Stapels. | Eröffne ein Issue. |
| `E-EXTF-FILE-NAME` | Die Property-ID lässt sich nicht im Dateinamen verwenden (erlaubt sind nur Buchstaben, Ziffern, `_` und `-`). | Eröffne ein Issue mit der Property-ID (sie kommt aus apaleo). |
| `W-EXTF-BELEGFELD` | Belegfeld 1 oder 2 enthielt Zeichen, die DATEV nicht annimmt, und wurde bereinigt (Umlaute als `ae`, `oe`, `ue`, Leerzeichen als `-`). | Nichts. |
| `W-EXTF-CHARSET` | Ein Zeichen außerhalb von Windows-1252 (dem Zeichensatz der DATEV-Datei) wurde ersetzt, zum Beispiel in einem Buchungstext. | Nichts, außer der ersetzte Text ist wichtig. |
| `W-EXTF-CONTROL-CHARS` | Steuerzeichen (Tabulatoren, Zeilenumbrüche) wurden aus einem Textfeld entfernt. | Nichts. |
| `W-EXTF-TRUNCATED` | Ein Text wurde auf die Höchstlänge von DATEV gekürzt (Buchungstext 60 Zeichen, Belegfeld 1 36, Belegfeld 2 12, KOST1 und KOST2 36). | Nichts, außer der gekürzte Text ist wichtig. |

## Häufige Fragen nach dem ersten Live-Test

**„the amount 12.5210084 is not a whole number of cents“.** Bis Version 0.1.0 kam diese Meldung, weil apaleo Netto- und Steuerbeträge mit bis zu acht Nachkommastellen schickt. Seit 0.1.1 behält das Tool sie genau; nur der Bruttobetrag muss ganze Cent sein. Schau, welches Feld die Meldung vor dem Doppelpunkt nennt:

- `netAmount` oder `taxes[…].amount`: Du nutzt eine alte Version. Hol die aktuelle (`git pull`, `pnpm install --frozen-lockfile`, `pnpm build`).
- `grossAmount`: Das ist auch in der aktuellen Version ein echter Fehler, ein Update hilft nicht. Eröffne ein Issue, wie die Meldung sagt, und lass Gastnamen weg.

**Der Sammeldebitor 10000 bleibt offen, obwohl der Gast die Rechnung bezahlt hat.** Die Rechnung auf den Debitor bucht das Tool (`Forderung an Debitor`). Die Zahlung darauf über die Rechnungsaktionen von apaleo erzeugt aber keine Zeile im Buchungsjournal, solange die apaleo-Einstellung `performAccountingForOpenInvoiceActions` auf `false` steht. Das ist kein Fehler des Exports: Die Kanzlei bucht den Zahlungseingang vom Kontoauszug gegen den Debitor. Einzelheiten: [posting-rules.md](posting-rules.md#zahlung-auf-eine-rechnung-der-debitor-bleibt-offen).

**Ein Hotel in Österreich.** Der Kontenplan hat dann Sätze wie 10 %, 13 % und 20 %. `init-mapping` meldet `N-FOREIGN-VAT-RATES`, und der Export stoppt mit `E-UNMAPPED` für diese Konten. Das ist gewollt: Die Vorlagen und die Automatikkonten von DATEV sind deutsch, ein österreichisches Hotel braucht ein Ziel wie BMD.

**Die USt im Protokoll weicht um ein paar Cent von apaleo ab.** DATEV rundet die USt pro Buchung, apaleo rechnet genau und rundet die Summe. Das Protokoll zeigt beide Werte und die Differenz; sie ist kein Fehler. Siehe [export.md](export.md).
