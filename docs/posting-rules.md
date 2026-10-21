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

Zuerst werden die `taxes[]` der Zeile bereinigt: Einträge mit Satz 0 und Betrag 0 (zum Beispiel `Without` bei der Kurtaxe) fallen weg. Dann wird die USt von DATEV als `round(|gross| × rate / (100 + rate))` berechnet, kaufmännisch gerundet (bei ,5 weg von null), und ohne Vorzeichen mit dem Steuerbetrag von apaleo verglichen. apaleo schickt den Steuerbetrag genau, mit bis zu acht Nachkommastellen (`7.45794393`); verglichen wird er kaufmännisch auf Cent gerundet (7.46). Die Nachkommastellen unter einem Cent lösen nie einen Befund aus. Auf den echten Daten des ersten Live-Tests war die USt von DATEV auf jeder Zeile gleich der gerundeten Steuer von apaleo.

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

### So bucht apaleo Anzahlungen wirklich

Der erste Live-Test (Sandbox, 2026-10-21) zeigte diese Formen, jeweils auf einem Konto pro Reservierung und Satz wie `EPEBVUIU-1_Liabilities/Reduced:7.00` (Elternkonto `3000`):

| Vorgang | apaleo-Zeile | DATEV (SKR03) |
|---|---|---|
| Anzahlung erhalten | `PostPrepayment`, Soll Zahlungsart, Haben `<Res>_Liabilities/<Satz>`, positiv, mit `taxes[]` | 1360 an 1711, `S` |
| Anzahlung aufgelöst (mit der Rechnung verrechnet) | `PostCharge`, Soll `<Res>_Receivables`, Haben `<Res>_Liabilities/<Satz>`, **negativ**, mit negativen `taxes[]` | 1410 an 1711, `H` |
| Anzahlung erstattet | `PostPrepayment` mit **negativem** Betrag, Soll Zahlungsart, Haben `<Res>_Liabilities/Null:0.00` | 1360 an 1719, `H` |
| Überzahlung als Anzahlung geparkt | `PostCharge`, Soll `<Res>_Receivables`, Haben `<Res>_Liabilities/Null:0.00`, positiv, ohne USt | 1410 an 1719, `S` |

`PostPrepaymentVat`-Zeilen gab es dabei nicht.

### Eingang oder Auflösung: nach Seite und Vorzeichen

Ob eine Zeile eine Anzahlung erhöht oder verringert, folgt aus Seite **und** Vorzeichen, nie aus der Seite allein: Die Anzahlung steigt, wenn das Konto `Liabilities` mit einem positiven Betrag im Haben oder mit einem negativen im Soll steht, sonst sinkt sie. Sinkt sie und ist die andere Seite eine Zahlungsart, ist es eine Erstattung. Die Übersicht zeigt erhaltene, aufgelöste und davon erstattete Anzahlungen ohne Vorzeichen; am Live-Tag BER: erhalten 590.00, aufgelöst 352.00, davon erstattet 10.00.

### Auflösung ohne USt-Betrag

Die Auflösung muss den Satz der Anzahlung tragen. Schickt apaleo sie mit `taxes[]` (so wie im Live-Test), gilt die normale Prüfung. Kommt eine Auflösung (Soll `Liabilities`, Haben `Receivables`) ohne `taxes[]`, wird der Satz ermittelt, nie mit 0 % angenommen:

1. aus der oder den `PostPrepaymentVat`-Zeilen desselben Geschäftstags und derselben Referenz, die die USt der Anzahlung vom apaleo-Konto für USt auf Anzahlungen nehmen (ihr Steuersatz, oder der bekannte Satz, dessen USt auf der Auflösung ihrem Betrag entspricht). Die USt von DATEV auf der Auflösung muss dann bis auf einen Cent der USt auf diesen Zeilen entsprechen;
2. sonst aus dem USt-Satz des Kontos `Liabilities` oder seines Elternkontos im Kontenplan von apaleo, mit der Warnung `W-VAT-INFERRED` (immer, auch wenn dieser Satz 0 % ist und die Auflösung auf das Anzahlungskonto ohne USt geht);
3. sonst stoppt der Export mit `E-VAT-RATE-UNKNOWN`, statt die Auflösung ohne USt zu buchen.

Eine erhaltene oder erstattete Anzahlung ohne `taxes[]` nimmt den Satz einer `PostPrepaymentVat`-Zeile desselben Geschäftstags und derselben Referenz, die USt in ihrer Richtung bucht (Eingang) oder zurückbucht (Erstattung), mit derselben Prüfung des Betrags. So wird die USt, die apaleo bewegt hat, auch in DATEV angemeldet oder zurückgenommen. Ohne eine solche Zeile bleibt es bei 0 % (ohne Rückgriff auf den Kontenplan).

`mapping check --from --to` nutzt dieselbe Ermittlung und löst Auflösungen ohne USt also mit dem Satz auf, den auch der Export verwenden wird.

## Zahlung auf eine Rechnung: der Debitor bleibt offen

Stellt das Hotel eine Rechnung auf den Debitor (`PostToAccountsReceivables`, in DATEV zum Beispiel 10000 an 1410) und zahlt der Gast sie später über die Rechnungsaktionen von apaleo, entsteht im Buchungsjournal **keine** Zeile, solange die apaleo-Einstellung `performAccountingForOpenInvoiceActions` auf `false` steht (die Voreinstellung). Der Export kann diese Zahlung also nicht buchen, und der Sammeldebitor bleibt in DATEV offen. Das ist kein Fehler des Exports: Die Kanzlei bucht den Zahlungseingang vom Kontoauszug gegen den Debitor, wie bei jeder Ausgangsrechnung. Ob apaleo mit `performAccountingForOpenInvoiceActions: true` eine Zahlungszeile gegen `AccountsReceivable` schreibt, ist noch nicht mit echten Daten geprüft; das Tool ändert diese Einstellung nicht.

## Übersprungene Zeilen

| Grund | Zeilen |
|---|---|
| `VAT_ACCOUNT_LINE` | Jede Zeile, die ein apaleo-Konto `Vat` oder `VatOnLiabilities` berührt, auch `PostPrepaymentVat`. DATEV rechnet die USt selbst über die Automatikkonten; würden die USt-Zeilen von apaleo zusätzlich gebucht, stünde der Steuerbetrag ohne seine Bemessungsgrundlage (Kz 81/86) in der Voranmeldung, und die USt würde doppelt gezählt. Diese Konten brauchen keine Zeile in der Kontenzuordnung. |
| `ZERO_AMOUNT` | Bruttobetrag 0. |
| `SAME_ACCOUNT` | Beide Seiten sind demselben DATEV-Konto zugeordnet, zum Beispiel eine Umbuchung zwischen zwei Gastfolios auf 1410, oder die zweite Zeile jeder Zahlung und jeder Umbuchung auf den Debitor auf ein `/Offset`-Konto (`<Folio>_Receivables → <Folio>_Receivables/Offset`). |

Übersprungene Zeilen behalten ihre Anzahl und ihre Bruttosumme ohne Vorzeichen (die Summe der Beträge ohne Vorzeichen, wie bei `E-CONSERVATION`) in der Übersicht, es verschwindet also nichts. Am Live-Tag BER: 6 Zeilen, 331.60.

## Felder

- **Belegfeld 1**: die Belegnummer aus apaleo (Rechnung, Referenz des Zahlungsdienstleisters, …), wenn `posting.belegfeld1` auf `receipt` steht (Standard) und es eine gibt, sonst die Reservierungsreferenz. Der DATEV-Writer bereinigt sie.
- **Buchungstext**: deutsch, gekürzt auf 60 Zeichen, aus Vorgang und deutscher Kontobezeichnung:
  - Erlöse: `Erlös` (Haben, positiv) oder `Erlösminderung` (negativ oder im Soll) und die Bezeichnung des Erlöskontos. Die Standardgruppen von apaleo heißen deutsch mit Satz: `Logis`, `Speisen und Getränke`, `No-Show`, `Stornogebühr`, `Sonstige Erlöse`, zum Beispiel `Erlös Logis 7 %`. Andere Erlöskonten behalten ihren Namen, ohne das englische Präfix `Revenues ` von apaleo.
  - Anzahlungen, nach Seite und Vorzeichen: `Anzahlung` (Eingang über eine Zahlungsart), `Umbuchung Anzahlung` (Eingang von einem Folio), `Auflösung Anzahlung` (Verrechnung mit dem Folio), `Erstattung Anzahlung` (Rückzahlung über eine Zahlungsart), jeweils mit dem Satz: `Auflösung Anzahlung 7 %`.
  - Zahlungen: `Zahlung` oder `Erstattung` (negativ) und die Zahlungsart. Kartenmarken bleiben (`Visa`, `Visa Debit`, `Amex`, `Mastercard`, `Girocard`), englische Namen werden übersetzt (`Bar`, `Überweisung`, `Lastschrift`, `Gutschein`, `Sonstige`), Endungen wie `Credit Card Payment` fallen weg.
  - `Forderung an Debitor` für die Umbuchung einer Gastforderung auf den Debitor, `Forderungsverlust` mit Satz.
  - Sonst die Bezeichnung des Vorgangs (`Umbuchung`, `USt Anzahlung`, sonst `Buchung`) und der Name des Kontos der USt-Seite, sonst des entlasteten Kontos. Konten vom Typ Receivables, AccountsReceivable und Liabilities außerhalb des globalen Buchungsjournals (Gast-, Buchungs- und Reservierungsfolios) nutzen dabei den Namen ihres globalen Elternkontos oder die feste Bezeichnung `Gastforderung`, `Debitor` oder `Anzahlung Gast`, nie ihren eigenen Namen, denn der kann der eines Gastes sein.

  Ein Gästename steht nie im Buchungstext.
- **KOST1, KOST2**: jeweils der erste nicht leere Wert aus der Zeile der USt-Seite, der Zeile des Kontos und der Zeile des Gegenkontos.

## Übersicht

Soll, Haben und Saldo pro DATEV-Konto; Erlöse pro USt-Satz mit der USt, die DATEV Buchung für Buchung rechnen wird, der genauen USt von apaleo und der Differenz; dasselbe für die Anzahlungen (Eingänge minus Auflösungen); Kurtaxe und Gästeabgaben; Zahlungen pro Geldtransitkonto; erhaltene, aufgelöste und davon erstattete Anzahlungen nach Seite und Vorzeichen; die Bewegung auf dem Sammeldebitor; übersprungene Zeilen pro Grund mit Summe ohne Vorzeichen; die Rundungssumme; Befunde pro Code.

DATEV rundet die USt pro Buchung, apaleo rechnet sie genau. Über einen Tag weichen die beiden Summen deshalb um ein paar Cent ab, ohne dass etwas falsch ist: am Live-Tag BER bei den Erlösen zu 7 % zum Beispiel DATEV 37.38 gegen apaleo 37.37 (genau 37.3695327). Die Übersicht zeigt beide Werte und die Differenz; siehe [export.md](export.md).
