# Buchungsregeln: von apaleo-Zeilen zu DATEV-Buchungen

`buildBookings(lines, mapping, chart, options)` in `src/posting` macht aus den Zeilen von `export-gross-daily` in apaleo die Buchungen eines DATEV-Buchungsstapels. Die Funktion ist rein: Dieselben Zeilen und dieselbe Kontenzuordnung ergeben immer dasselbe Ergebnis. Jede apaleo-Zeile landet an genau einer von drei Stellen: in einer Buchung, in der Liste der übersprungenen Zeilen (mit Grund und Betrag) oder in einem Befund mit `E-`, der den Export blockiert.

Keine Gewähr, keine Steuerberatung: Die steuerlichen Entscheidungen stecken in der Kontenzuordnung, und die muss deine Steuerberatung freigeben. Die Regeln unten stellen nur sicher, dass DATEV die USt rechnet, die apaleo berechnet hat.

## Eine Buchung pro Zeile

In dieser Version wird nichts verdichtet: Jede apaleo-Zeile wird eine Buchung mit dem Bruttobetrag ohne Vorzeichen, dem Geschäftstag als Belegdatum und der `sourceEntryNumber` aus apaleo, damit sich jede Buchung zurückverfolgen lässt. Ein Hotel mit 40 Zimmern erzeugt ein paar tausend Buchungen im Monat; DATEV importiert das ohne Probleme, und die USt-Prüfung bleibt pro Zeile genau.

## Richtung: die USt-Seite kommt ins Gegenkonto

DATEV rechnet die USt aus dem Bruttobetrag auf dem Gegenkonto, über ein Automatikkonto (SKR03 8300, 8400, 1711, 1718 …) oder einen BU-Schlüssel. Beide Seiten der Zeile werden über die Kontenzuordnung aufgelöst (siehe [mapping-guide.md](mapping-guide.md)); die Seite, deren Zeile DATEV USt anwenden lässt (ein Satz über 0 % oder ein BU-Schlüssel), ist die USt-Seite.

| Fall | Konto | Gegenkonto | Soll/Haben |
|---|---|---|---|
| keine USt-Seite (Zahlungen, Umbuchungen zwischen Folios, Kurtaxe mit 0 %) | belastetes Konto | entlastetes Konto | `S` |
| USt-Seite im Haben (Leistung, Anzahlung) | belastetes Konto | USt-Seite | `S` |
| USt-Seite im Soll (Nachlass auf Erlöse, Auflösung einer Anzahlung) | entlastetes Konto | USt-Seite | `H` |
| beide Seiten mit USt (Umbuchung zwischen zwei Erlöskonten) | Fehler `E-TWO-VAT-SIDES`, keine Buchung | | |

Ein negativer Bruttobetrag (ein Nachlass, der als negative Leistung gebucht ist) bucht seinen Betrag ohne Vorzeichen mit getauschter Seite. Der BU-Schlüssel kommt aus der Zeile der USt-Seite.

## USt-Prüfung pro Zeile

Zuerst werden die `taxes[]` der Zeile bereinigt: Einträge mit Satz 0 und Betrag 0 (zum Beispiel `Without` bei der Kurtaxe) fallen weg. Dann wird die USt von DATEV als `round(|gross| × rate / (100 + rate))` berechnet, kaufmännisch gerundet (bei ,5 weg von null), und ohne Vorzeichen mit dem Steuerbetrag von apaleo verglichen.

| Code | Bedeutung |
|---|---|
| `W-VAT-ROUNDING` | Die USt von DATEV weicht um einen Cent von der von apaleo ab. Gebucht; die Differenz geht in die Rundungssumme der Übersicht. |
| `E-VAT-AMOUNT` | Die Abweichung ist größer als ein Cent. |
| `E-VAT-RATE` | Der Satz von apaleo weicht von dem Satz ab, den DATEV auf dem zugeordneten Konto anwendet (auch bei einem Zeitraum aus 2025, der mit einer Kontenzuordnung für 2026 exportiert wird). |
| `E-VAT-MISSING` | apaleo hat USt berechnet, aber keines der beiden zugeordneten Konten lässt DATEV USt rechnen. |
| `E-VAT-UNEXPECTED` | apaleo hat keine USt berechnet, aber DATEV würde welche rechnen. |
| `E-VAT-MIXED` | Eine Zeile hat mehr als einen USt-Satz. |
| `E-VAT-SIGN` | USt und Bruttobetrag haben verschiedene Vorzeichen. |
| `E-DATEV-RATE-UNKNOWN` | Der Satz, den DATEV auf einer Zeile der Kontenzuordnung anwendet, ist nicht bekannt (unbekannter BU-Schlüssel, leeres `datev_vat_percent`). |
| `E-UNMAPPED` | Ein Konto hat keine Zeile mit DATEV-Konto; einmal pro Konto, wie bei `mapping check --from --to`. |

Die Meldungen nennen die Buchungsnummer aus apaleo, beide Konten mit Nummer und Typ (nie mit Namen, weil Gastfolios Gästenamen tragen) und die Zeile der Kontenzuordnung, die du ändern musst.

## Anzahlungen

Anzahlungen werden auf das zugeordnete Anzahlungskonto gebucht, normalerweise die Automatikkonten für erhaltene, versteuerte Anzahlungen (SKR03 1711 / 1718, SKR04 3260 / 3272). So bucht DATEV die USt auf die Anzahlung und löst sie wieder auf, wenn die Anzahlung verrechnet wird.

Die Auflösung (Soll auf dem Konto `Liabilities` des Gastes, Haben auf seinem Konto `Receivables`) muss den Satz der Anzahlung tragen. Schickt apaleo sie mit `taxes[]`, gilt die normale Prüfung. Sonst wird der Satz ermittelt, nie mit 0 % angenommen:

1. aus der oder den `PostPrepaymentVat`-Zeilen desselben Geschäftstags und derselben Referenz, die die USt der Anzahlung vom apaleo-Konto für USt auf Anzahlungen nehmen (ihr Steuersatz, oder der bekannte Satz, dessen USt auf der Auflösung ihrem Betrag entspricht). Die USt von DATEV auf der Auflösung muss dann bis auf einen Cent der USt auf diesen Zeilen entsprechen;
2. sonst aus dem USt-Satz des Kontos `Liabilities` oder seines Elternkontos im Kontenplan von apaleo, mit der Warnung `W-VAT-INFERRED` (immer, auch wenn dieser Satz 0 % ist und die Auflösung auf das Anzahlungskonto ohne USt geht);
3. sonst stoppt der Export mit `E-VAT-RATE-UNKNOWN`, statt die Auflösung ohne USt zu buchen.

Eine erhaltene oder erstattete Anzahlung ohne `taxes[]` nimmt den Satz einer `PostPrepaymentVat`-Zeile desselben Geschäftstags und derselben Referenz, die USt in ihrer Richtung bucht (Eingang) oder zurückbucht (Erstattung), mit derselben Prüfung des Betrags. So wird die USt, die apaleo bewegt hat, auch in DATEV angemeldet oder zurückgenommen. Ohne eine solche Zeile bleibt es bei 0 % (ohne Rückgriff auf den Kontenplan).

`mapping check --from --to` nutzt dieselbe Ermittlung und löst Auflösungen ohne USt also mit dem Satz auf, den auch der Export verwenden wird.

## Übersprungene Zeilen

| Grund | Zeilen |
|---|---|
| `VAT_ACCOUNT_LINE` | Jede Zeile, die ein apaleo-Konto `Vat` oder `VatOnLiabilities` berührt, auch `PostPrepaymentVat`. DATEV rechnet die USt selbst über die Automatikkonten; würden die USt-Zeilen von apaleo zusätzlich gebucht, stünde der Steuerbetrag ohne seine Bemessungsgrundlage (Kz 81/86) in der Voranmeldung, und die USt würde doppelt gezählt. Diese Konten brauchen keine Zeile in der Kontenzuordnung. |
| `ZERO_AMOUNT` | Bruttobetrag 0. |
| `SAME_ACCOUNT` | Beide Seiten sind demselben DATEV-Konto zugeordnet, zum Beispiel eine Umbuchung zwischen zwei Gastfolios auf 1410. |

Übersprungene Zeilen behalten ihre Anzahl und ihre Bruttosumme in der Übersicht, es verschwindet also nichts.

## Felder

- **Belegfeld 1**: die Belegnummer aus apaleo (Rechnung, Referenz des Zahlungsdienstleisters, …), wenn `posting.belegfeld1` auf `receipt` steht (Standard) und es eine gibt, sonst die Reservierungsreferenz. Der DATEV-Writer bereinigt sie.
- **Buchungstext**: eine deutsche Bezeichnung des Vorgangs (`Erlös`, `Zahlung`, `Anzahlung`, `Umbuchung`, `Forderung`, `Forderungsverlust`, `USt Anzahlung`, sonst `Buchung`) und der Name des Kontos der USt-Seite, sonst des entlasteten Kontos, gekürzt auf 60 Zeichen. Konten vom Typ Receivables, AccountsReceivable und Liabilities außerhalb des globalen Buchungsjournals (Gast-, Buchungs- und Reservierungsfolios) nutzen den Namen ihres globalen Elternkontos oder die feste Bezeichnung `Gastforderung`, `Debitor` oder `Anzahlung Gast`, nie ihren eigenen Namen, denn der kann der eines Gastes sein. Beginnt die Kontobezeichnung schon mit der Bezeichnung des Vorgangs, steht sie allein (`Anzahlung Gast`, nicht `Anzahlung Anzahlung Gast`).
- **KOST1, KOST2**: jeweils der erste nicht leere Wert aus der Zeile der USt-Seite, der Zeile des Kontos und der Zeile des Gegenkontos.

## Übersicht

Alles in Cent: Soll, Haben und Saldo pro DATEV-Konto; Erlöse pro USt-Satz mit der USt, die DATEV rechnen wird; Kurtaxe und Gästeabgaben; Zahlungen pro Geldtransitkonto; erhaltene und aufgelöste Anzahlungen; übersprungene Zeilen pro Grund; die Rundungssumme; Befunde pro Code.
