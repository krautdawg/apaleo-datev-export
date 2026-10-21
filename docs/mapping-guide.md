# Kontenzuordnung (Mapping): Leitfaden für Hotel und Steuerberater

Die DATEV-Datei ist nur so gut wie die Kontenzuordnung. Sie ist eine CSV-Datei pro Hotel (Property), die du in Excel öffnest und mit deiner Kanzlei durchgehst. **Keine Gewähr, keine Steuerberatung: Jede Zeile der Vorlage ist ein Vorschlag, den die Kanzlei bestätigt.**

Ein vollständiges Beispiel liegt in [examples/mapping-BSP.example.csv](examples/mapping-BSP.example.csv): die SKR03-Zuordnung des erfundenen „Hotel Beispiel“, aus der die Beispieldatei [examples/](examples/) entstanden ist. Die Kanzlei kann damit die Ausgabe beurteilen, bevor jemand eine apaleo-App anlegt.

## Ablauf

```sh
apaleo-datev init-mapping --property BSP --skr 04      # schreibt mapping-BSP.csv aus dem apaleo-Kontenplan
# Datei mit der Kanzlei prüfen, leere DATEV-Konten ausfüllen
apaleo-datev mapping check --property BSP              # prüft die Datei
apaleo-datev mapping check --property BSP --from 2026-09-01 --to 2026-09-30   # ist jedes gebuchte Konto zugeordnet?
apaleo-datev init-mapping --property BSP --skr 04 --update   # später: neue apaleo-Konten anhängen, bearbeitete Zeilen bleiben
```

`init-mapping` zählt am Ende die Zeilen: zugeordnet, nicht zugeordnet (die musst du entscheiden), historische Zeilen zu 16 % und 5 % (bleiben absichtlich leer, siehe unten) und Zeilen für die USt-Konten von apaleo (brauchen kein DATEV-Konto).

Der Pfad der Datei kann in der Konfiguration stehen (`properties[].mapping`), sonst heißt sie `mapping-<id>.csv` im Arbeitsverzeichnis. `mapping check --from --to` liest das Buchungsjournal des Zeitraums aus apaleo und meldet jedes gebuchte Konto ohne Zuordnung; die Kanzlei kann die Datei also an einem echten Monat prüfen, bevor ein Export läuft.

## Spalten

| Spalte | Bedeutung |
|---|---|
| `apaleo_account` | apaleo-Kontonummer, oder `*` für alle Konten eines Typs |
| `apaleo_type` | apaleo-Kontotyp (Revenues, Payments, Liabilities, Receivables, AccountsReceivable, CityTaxes, …) |
| `apaleo_name`, `apaleo_vat_percent` | zur Information, aus apaleo; bei `*`-Zeilen ist `apaleo_vat_percent` der USt-Satz, für den die Zeile gilt |
| `datev_account` | DATEV-Konto. Leer heißt: nicht zugeordnet, der Export bricht mit `E-UNMAPPED` ab |
| `bu_key` | BU-Schlüssel (1 bis 4 Ziffern). Auf Automatikkonten (z. B. 8300) leer lassen, siehe unten |
| `datev_vat_percent` | USt-Satz, den DATEV auf dieser Zeile anwendet. Automatikkonto und BU-Schlüssel gehen vor, denn DATEV bucht deren Satz; widerspricht die Spalte ihnen, meldet `mapping check` `E-VAT-CONFLICT`. Leer: aus Automatikkonto oder BU-Schlüssel abgeleitet, sonst 0 % |
| `kost1`, `kost2` | Kostenstellen (optional) |
| `comment` | Freitext, zum Beispiel die Begründung der Kanzlei |

### Kontonummern und Sachkontenlänge

Die Kontonummern haben genau die Sachkontenlänge der Kanzlei (`datev.sachkontenlaenge`), Debitoren eine Stelle mehr. Die Vorlage ist für Sachkontenlänge 4 geschrieben. Bei einer größeren Länge hängt `init-mapping` Nullen an (Hinweis `N-TEMPLATE-SCALED`): Bei Sachkontenlänge 5 wird aus 8300 also 83000 und aus dem Debitor 10000 der Debitor 100000. Prüfe mit der Kanzlei, dass das ihren Konten entspricht.

Excel entfernt führende Nullen: Formatiere die Spalte `datev_account` als Text. Fehlen bei Sachkontenlänge 4 nur führende Nullen eines Kontos der Klasse 0 (650 statt 0650), ergänzt das Tool sie mit der Warnung `W-PADDED`; jede andere falsche Länge ist ein Fehler (`E-ACCOUNT-LENGTH`).

## Welche Zeile gilt?

Für jedes gebuchte apaleo-Konto sucht das Tool in dieser Reihenfolge:

1. genau diese Nummer und dieser Typ;
2. diese Nummer mit beliebigem Typ (Zeilen aus einem Grman-Export);
3. das Elternkonto (und dessen Eltern) mit gleichem Typ; eine Elternzeile **ohne** DATEV-Konto beendet die Suche nicht, das Tool geht weiter zu den `*`-Zeilen;
4. für Typen mit USt eine `*`-Zeile mit dem USt-Satz der Buchung;
5. für andere Typen eine `*`-Zeile des Typs.

Eine Zeile genau für das Konto (Schritt 1 oder 2) mit leerem `datev_account` heißt dagegen weiter „nicht zugeordnet“: Du hast das Konto bewusst aufgeführt. Findet das Tool gar kein DATEV-Konto, nennt die Meldung `E-UNMAPPED` die leere Elternzeile und die `*`-Zeile, die du ergänzen kannst, zum Beispiel `*;Liabilities;;7;<DATEV-Konto>;;7` (Vorlage: 1711). Konten pro Reservierung oder Folio meldet sie einmal pro Elternkonto, Typ und Satz, mit bis zu drei Beispielen.

Bis Version 0.1.0 schrieb die Vorlage eine leere Zeile `3000;Liabilities`, die alle Anzahlungen blockierte. Sie blockiert seit 0.1.1 nicht mehr; du kannst sie löschen (`init-mapping --update` meldet sie als `N-PARENT-ROW-EMPTY`).

Erlöskonten (Revenues) werden nie per `*` zugeordnet: Ein neues Erlöskonto (Spa, Parken) ordnet ein Mensch zu.

### Konten pro Reservierung und `/Offset`-Konten

apaleo bucht auf Konten pro Reservierung oder Folio, zum Beispiel `EPEBVUIU-1_Liabilities/Reduced:7.00` (Anzahlung zu 7 %), `ZAQSEFYC-1_Receivables` (Gastforderung) oder `ZAQSEFYC-1_AccountsReceivable` (Debitor). Sie stehen nicht im Kontenplan, haben aber ein Elternkonto (`3000`, `1200`, `9999`). Du brauchst keine Zeile für jedes davon: Gastforderungen laufen über die Zeile für `1200`, Anzahlungen über die `*`-Zeilen pro USt-Satz, Debitoren über `*;AccountsReceivable;;;10000` auf den Sammeldebitor.

Jede Zahlung und jede Umbuchung auf den Debitor hat in apaleo eine zweite Zeile auf ein `/Offset`-Konto, zum Beispiel `<Folio>_Receivables → <Folio>_Receivables/Offset` mit dem negativen Betrag. Das `/Offset`-Konto hat dasselbe Elternkonto, landet also auf demselben DATEV-Konto; das Tool überspringt diese Zeile als `SAME_ACCOUNT` (im Protokoll unter „Skipped lines“).

## Die USt-Prüfung: DATEV-Satz gleich apaleo-Satz

Das Tool rechnet keine Umsatzsteuer. DATEV rechnet sie, aus dem Bruttobetrag und dem Automatikkonto oder BU-Schlüssel der Zeile. Damit DATEV genau die Steuer bucht, die apaleo dem Gast berechnet hat, prüft das Tool jede Buchung: Der Satz, den DATEV auf dem zugeordneten Konto anwendet, muss der Satz der apaleo-Buchung sein, und der Betrag darf höchstens einen Cent abweichen (`W-VAT-ROUNDING`). Alles andere stoppt den Export (`E-VAT-RATE`, `E-VAT-MISSING`, `E-VAT-UNEXPECTED`, …).

Das gilt auch über eine Zeile für ein Elternkonto: Landet ein Konto mit 7 % (Logis 5011, Speisen 5111) über `5000;Revenues;…;8400` auf 8400 (19 %), meldet `mapping check --from --to` `E-VAT-MISMATCH` und verlangt eine eigene Zeile für das Konto.

**Keine BU-Schlüssel auf Automatikkonten.** Auf einem Automatikkonto (SKR03 8300, 8400, 1711, 1718, …) rechnet DATEV die USt selbst und lehnt die meisten BU-Schlüssel ab (`E-BU-ON-AUTOMATIC`). Erlaubt sind dort nur `2x` (Generalumkehr) und `4x` (Aufhebung der Automatik, `40` = ohne USt). Das Tool kennt die Steuerschlüssel `2` (7 % USt), `3` (19 % USt), `8` (7 % Vorsteuer) und `9` (19 % Vorsteuer), auch nach Generalumkehr (`22`, `23`, `28`, `29`). Ein Vorsteuerschlüssel auf Erlösen, Anzahlungen, Abgaben oder Forderungsverlusten ist ein Fehler (`E-BU-INPUT-TAX`); bei anderen Schlüsseln warnt `mapping check` (`W-BU-KEY-UNCHECKED`) und verlässt sich auf `datev_vat_percent`.

## Steuersätze hängen vom Leistungsdatum ab

- **Logis**: 7 %.
- **Speisen**: 7 % für Leistungen ab 2026-01-01, 19 % davor.
- **Getränke**: 19 %.

Die Vorlage folgt den Sätzen ab 2026. Für einen Zeitraum aus 2025 passt sie nicht: Ein Speisenkonto mit 19 % in apaleo landet dann auf einem 7-%-Konto, und der Export stoppt mit `E-VAT-RATE`. Für 2025 brauchst du eine eigene Zuordnung mit den Sätzen von 2025, zum Beispiel in einer zweiten Konfigurationsdatei mit eigenem `properties[].mapping`, die du mit `--config` wählst.

## Kurtaxe, Beherbergungsteuer, Gästeabgaben

Die Zeilen für CityTaxes, SecondCityTax und GuestLevies bleiben in der Vorlage leer. Das ist Absicht: Die richtige Buchung hängt von der Gemeinde ab, und die Entscheidung trifft die Kanzlei.

- **Der Gast schuldet die Abgabe** (Kurtaxe, Kurbeitrag, Gästebeitrag): Das Hotel sammelt sie nur ein. Durchlaufende Posten, SKR03 1590 / SKR04 1370, 0 %.
- **Der Betrieb schuldet die Abgabe** (Übernachtungsteuer, Beherbergungsteuer, z. B. Berlin): Sie ist Teil des Entgelts und Erlös zu 7 %. Dann auch die USt-Einstellung des Kontos in apaleo prüfen, sonst stoppt die USt-Prüfung.

Bis eine Zeile ausgefüllt ist, blockieren `mapping check --from --to` und der Export mit `E-UNMAPPED`. Die Beispielzuordnung bucht die Kurtaxe als Durchlaufenden Posten 1590 und sagt das im Kommentar.

## Anzahlungen

Anzahlungen der Gäste (Liabilities) gehen auf die Automatikkonten für erhaltene, versteuerte Anzahlungen: SKR03 1711 (7 %) und 1718 (19 %), SKR04 3260 und 3272. So bucht DATEV die USt auf die Anzahlung und löst sie bei der Verrechnung mit der Rechnung wieder auf. Anzahlungen ohne USt gehen auf SKR03 1719 / SKR04 3280.

apaleo bucht die USt auf Anzahlungen zusätzlich auf eigenen Konten (Vat, VatOnLiabilities, Befehl `PostPrepaymentVat`). Diese Buchungen überspringt das Tool, denn DATEV rechnet die USt über die Automatikkonten; sie doppelt zu buchen würde die Steuer zweimal ausweisen. Diese Konten brauchen keine Zuordnung.

Wird eine Anzahlung verrechnet, ohne dass apaleo dabei einen USt-Betrag mitschickt, nimmt das Tool den Satz aus der `PostPrepaymentVat`-Buchung desselben Tages und derselben Reservierung, sonst aus dem Kontenplan (Warnung `W-VAT-INFERRED`), nie 0 %. Lässt sich kein Satz finden, stoppt es mit `E-VAT-RATE-UNKNOWN`. Mehr dazu in [posting-rules.md](posting-rules.md).

## Zahlungen, Forderungen, Debitoren

- **Bar**: Kasse (SKR03 1000 / SKR04 1600).
- **Karte, Überweisung und andere unbare Zahlungen**: Geldtransit (SKR03 1360 / SKR04 1460), nie direkt das Bankkonto. Die Kanzlei bucht den Kontoauszug oder die Abrechnung des Zahlungsdienstleisters gegen das Geldtransitkonto. Gebühren der Zahlungsdienstleister bucht dieses Tool nicht.
- **Gast-, externe und Buchungsfolios (Receivables)**: Forderungen aus LuL ohne Kontokorrent (SKR03 1410 / SKR04 1210) als Verrechnungskonto. Folios mit Gästenamen erscheinen nie mit Namen im Buchungstext.
- **Rechnungen an Firmen (AccountsReceivable, City Ledger)**: ein Sammeldebitor, 10000. Lege ihn im Mandanten an. Die Vorlage schreibt dafür die Zeile `*;AccountsReceivable;;;10000`, damit auch die Debitorenkonten pro Reservierung und ihre `/Offset`-Konten dort landen. Einzelne Debitoren pro Firma (mit Stammdaten) erzeugt das Tool nicht.

## Vorlagen SKR03 und SKR04

Die Vorlagen stehen in `templates/skr03-hotel.rules.csv` und `templates/skr04-hotel.rules.csv` (Version `skr03-hotel@2`, `skr04-hotel@2`, seit 0.1.1). Jedes Konto wurde am 2026-10-20 gegen die DATEV-Kontenrahmen „Gültig für 2026“ geprüft: SKR 03 Art.-Nr. 11174 und SKR 04 Art.-Nr. 11175, Stand 2026-01-01. Das DATEV-Hilfe-Center (Dok.-Nr. 0907817) ließ sich nicht automatisch abrufen; geprüft wurde deshalb gegen die unveränderten DATEV-PDFs, die unter https://www.collmex.de/skr03.pdf und https://www.collmex.de/skr04.pdf veröffentlicht sind. Jede Vorlagenzeile mit Konto nennt diese Quelle im Kommentar.

| Fall | SKR03 | SKR04 |
|---|---|---|
| No-Show- und Stornoerlöse, die apaleo mit 7 % bucht | 8300 Erlöse 7 % USt (AM) | 4300 |
| Logis 7 % | 8300 Erlöse 7 % USt (AM) | 4300 |
| Speisen 7 % (ab 2026-01-01) | 8300 | 4300 |
| Getränke und sonstige Erlöse 19 % | 8400 Erlöse 19 % USt (AM) | 4400 |
| Erlöse ohne USt (z. B. Stornogebühren) | 8200 Erlöse | 4200 |
| Barzahlung | 1000 Kasse | 1600 |
| Karte, Überweisung, andere unbare Zahlungen | 1360 Geldtransit | 1460 |
| Gast-, externe und Buchungsfolios (Receivables) | 1410 Forderungen aus LuL ohne Kontokorrent | 1210 |
| Rechnungen an Firmen (AccountsReceivable), auch per `*` | 10000 Sammeldebitor | 10000 |
| Anzahlungen 7 % / 19 % | 1711 / 1718 erhaltene, versteuerte Anzahlungen (AM) | 3260 / 3272 |
| Anzahlungen ohne USt | 1719 Erhaltene Anzahlungen | 3280 |
| Forderungsverluste 7 % / 19 %, auch per `*` | 2401 / 2406 (AM) | 6931 / 6936 |
| Erlöse und Anzahlungen zu 16 % / 5 % (2020) | leer | leer |

Für ein Containerkonto außerhalb der globalen Konten, das nur per `*` sinnvoll zugeordnet wird (`3000` Liabilities, `CollectiveDebitor_LossOfAccountsReceivable`), schreibt die Vorlage keine Zeile mehr: Die `*`-Zeilen decken seine Konten pro Reservierung ab, und ein einziges DATEV-Konto könnte nicht jeden Satz abdecken.

### Zeilen mit „Vorschlag (ungeprüft)“

In Version 2 der Vorlagen ist keine Zeile mit `Vorschlag (ungeprüft)` markiert: Jedes vorgeschlagene Konto wurde gegen die Quelle oben geprüft. Ein Test hält diese Liste aktuell; kommt in einer späteren Version eine ungeprüfte Zeile dazu, steht sie hier.

### Was die Kanzlei entscheiden muss

Diese Vorlagenzeilen lassen das DATEV-Konto leer oder verlangen eine Entscheidung:

- **Kurtaxe, Beherbergungsteuer, Gästeabgaben** (CityTaxes, SecondCityTax, GuestLevies): bleiben leer, siehe oben.
- **Speisen**: Logis und Speisen landen in der Vorlage beide auf 8300 / 4300. Ein eigenes 7-%-Erlöskonto für Speisen hält sie getrennt.
- **Erlöse zu 7 % ohne erkennbaren Namen** bleiben leer („Logis oder Speisen?“).
- **No-Show- und Stornoerlöse zu 7 %**: Die Vorlage schlägt 8300 / 4300 vor, weil apaleo sie mit 7 % bucht (als Teil der Übernachtung) und das DATEV-Konto den Satz von apaleo anwenden muss. Ob die Gebühr überhaupt steuerbar ist oder Schadenersatz, entscheidet die Kanzlei; dann gehört auch die USt-Einstellung in apaleo geändert.
- **Stornogebühren** und andere Erlöse ohne USt: steuerbar oder Schadenersatz?
- **Historische Sätze 16 % und 5 %** (1. Juli bis 31. Dezember 2020): apaleo legt diese Erlös- und Anzahlungskonten in jedem Kontenplan an. Die Vorlage lässt sie absichtlich leer: Bucht apaleo darauf, stoppt der Export mit `E-UNMAPPED`, was für Leistungen nach 2020 richtig ist. Exporte für 2020 klärst du mit der Kanzlei.
- **Hauskonten (House)** und **Durchlaufende Posten aus apaleo (TransitoryItems)** haben keine Vorlage.
- **Vat, VatOnLiabilities**: brauchen kein Konto; diese Buchungen werden übersprungen.

### Hotels in Österreich

Die Vorlagen und die Automatikkonten von DATEV kennen nur die deutschen Sätze (7 %, 19 % und 2020 16 % / 5 %). Hat der Kontenplan andere Sätze, etwa 10 %, 13 % und 20 % in Österreich, meldet `init-mapping` `N-FOREIGN-VAT-RATES` und lässt diese Zeilen leer; ein Export mit Buchungen darauf stoppt mit `E-UNMAPPED`. Für ein österreichisches Hotel ist dieser DATEV-Export nicht gedacht; es braucht ein österreichisches Ziel wie BMD.

### Eine ältere Datei aktualisieren

`init-mapping --update` ändert keine bestehende Zeile und keinen Kommentar am Anfang der Datei. Es hängt Zeilen für neue apaleo-Konten und neue `*`-Zeilen der Vorlage an (seit Version 2 zum Beispiel `*;AccountsReceivable;;;10000`) und meldet, was du prüfen solltest:

- `N-PARENT-ROW-EMPTY`: eine leere Zeile für ein Elternkonto, etwa `3000;Liabilities` aus Version 1. Sie blockiert nichts mehr; du kannst sie löschen.
- `N-TEMPLATE-SUGGESTION`: eine Zeile mit leerem DATEV-Konto, für die die Vorlage jetzt einen Vorschlag hat, etwa No-Show- und Stornoerlöse zu 7 % auf 8300. Trag ihn ein, wenn die Kanzlei zustimmt.

## Umstieg von einem anderen DATEV-Connector

Eine Export-Datei im Grman-Format mit den Spalten `ApaleoAccountNumber;DatevAccountNumber;CostCenter;CostCenter2` wird direkt gelesen; ihre Zeilen gelten für die Kontonummer unabhängig vom Typ. `mapping check` warnt, dass BU-Schlüssel und USt-Sätze fehlen (`W-GRMAN-LAYOUT`). `init-mapping --update` wandelt die Datei in das Format dieses Tools um, übernimmt DATEV-Konten und Kostenstellen, hängt neue apaleo-Konten an und legt das Original als `<name>.grman.csv` ab. Gibt es diese Datei schon, bricht der Befehl ab und ändert nichts.

```sh
apaleo-datev init-mapping --property BSP --skr 03 --update
apaleo-datev mapping check --property BSP --from 2026-09-01 --to 2026-09-30
```

## Checkliste zur Freigabe durch die Kanzlei

Bevor die erste Datei in DATEV importiert wird:

- [ ] Beraternummer, Mandantennummer, Sachkontenlänge, Wirtschaftsjahresbeginn und SKR in der Konfiguration stimmen (`datev.beraternummer`, `datev.mandantennummer`, `datev.sachkontenlaenge`, `datev.wjBeginn`, `datev.skr`).
- [ ] Jede Zeile mit DATEV-Konto ist geprüft; jede leere Zeile ist ausgefüllt oder bewusst leer (ein solches Konto darf dann nicht gebucht werden).
- [ ] Die Erlöskonten haben den Satz, den apaleo bucht (Logis 7 %, Speisen 7 % ab 2026, Getränke 19 %), und der Zeitraum passt zu diesen Sätzen.
- [ ] Kurtaxe und Beherbergungsteuer sind für die Gemeinde des Hotels entschieden.
- [ ] Anzahlungen gehen auf die versteuerten Anzahlungen (Automatikkonten), Zahlungen außer bar auf Geldtransit, Firmenrechnungen auf den Sammeldebitor, der im Mandanten angelegt ist.
- [ ] Auf Automatikkonten steht kein BU-Schlüssel.
- [ ] `apaleo-datev mapping check --property <id> --from <Monatsanfang> --to <Monatsende>` endet ohne Fehler für einen echten Monat.
- [ ] Ein Probelauf `apaleo-datev export --month <YYYY-MM> --dry-run` ist ohne `E-` Befund; die Summen pro Konto und USt-Satz stimmen mit den Berichten in apaleo überein.
- [ ] Der erste Import läuft mit Festschreibung 0, und das Importprotokoll wurde geprüft ([datev-import.md](datev-import.md)).

Datum, Name der Kanzlei und die geprüfte Version der Datei (SHA-256 aus dem Protokoll) kannst du in die Spalte `comment` oder in eure Unterlagen schreiben.
