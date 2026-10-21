# Quelle apaleo: Endpunkte, Berechtigungen und der Live-Test

Wie das Tool apaleo liest, was die Custom App braucht und wie du ein echtes Konto prüfst. Geprüft gegen die Swagger-Dokumente von apaleo [finance-v1](https://api.apaleo.com/swagger/finance-v1/swagger.json) und [inventory-v1](https://api.apaleo.com/swagger/inventory-v1/swagger.json), heruntergeladen am **2026-10-20**.

## Custom App und Berechtigungen

Leg in apaleo unter **Apps > Connected apps** mit **Add a new app** und **Add custom app** eine Custom App an (Seite **New simple client**, Client Credentials, fine-grained, personenbezogene Daten **Omit all**). Die Client-ID der App kommt in `apaleo.clientId` (oder `APALEO_CLIENT_ID`), das Secret in die Umgebungsvariable `APALEO_CLIENT_SECRET`. Das Secret kommt nie in die Konfigurationsdatei. Schritt für Schritt: [setup-apaleo.md](setup-apaleo.md).

| Berechtigung | Gebraucht für | |
|---|---|---|
| `core.subledger_schema.read` | Kontenplan | erforderlich |
| `core.subledger_export.create` | Buchungsexport | erforderlich |
| `core.properties.read` | Liste der Hotels | erforderlich (die Swagger-Dokumentation nennt sie für Clients mit fine-grained permissions) |
| `core.subledger_aggregate.create` | Tagessummen: `live-smoke` und die Vollständigkeitsprüfung des Exports bei `checks.aggregates: true` | optional |

Clients, die Scopes statt fine-grained permissions nutzen, brauchen `accounting.read`. Das Tool schreibt nie etwas nach apaleo.

## Endpunkte

| Aufruf | Wofür |
|---|---|
| `POST https://identity.apaleo.com/connect/token` | Token, `grant_type=client_credentials`, `client_secret_basic`; `apaleo.scopes` wird nur gesendet, wenn es gesetzt ist |
| `GET /inventory/v1/properties?pageNumber&pageSize=500` | Property-ID, Code, Name, Zeitzone, Währung; endet bei einer kurzen Seite oder 204 |
| `GET /finance/v1/accounts/schema?propertyId&depth=4&includeArchived=true` | Kontenplan, flach gemacht, mit der Liste der Buchungsjournale (global, guest, external, booking) jedes Kontos |
| `POST /finance/v1/accounts/export-gross-daily?propertyId&from&to` | ein Geschäftstag pro Anfrage (`to` ist ausgeschlossen), Header `Idempotency-Key: apaleo-datev-<property>-<from>-<to>-<run id>`; 204 heißt: keine Buchungen |
| `POST /finance/v1/accounts/aggregate-daily?propertyId&from&to` | die eigenen Tagessummen von apaleo, ein Geschäftstag pro Anfrage: globale Konten auf unterster Ebene (Zahlungsarten, Erlös- und USt-Unterkonten), von den Gast-, externen und Buchungskonten nur das oberste Elternkonto (`1200`, `3000`, `9999`) |

Bei Anfragelimits (429) wartet das Tool `Retry-After` ab, höchstens 60 s, und versucht es dann noch einmal; Server- und Netzwerkfehler wiederholt es bis zu viermal mit wachsenden Abständen. Anfragen brechen nach 60 s ab. Höchstens zwei Export-Anfragen laufen gleichzeitig; das hält Entwicklungskonten (5 Anfragen pro Sekunde) unter der Grenze.

Beträge kommen als Gleitkommazahlen. Netto- und Steuerbeträge (`netAmount`, `taxes[].amount`) schickt apaleo mit bis zu acht Nachkommastellen (`12.5210084`); das Tool behält sie genau als Dezimaltext und rundet sie für die Prüfungen pro Zeile kaufmännisch auf Cent. Nur der Bruttobetrag (`grossAmount`) muss ganze Cent sein: Weicht er mehr als 0,0001 von einem ganzen Cent ab, oder ist er nicht Netto plus Steuern (auf einen halben Cent genau), stoppt das Lesen mit dem Geschäftstag und der Buchungsnummer aus apaleo. Beträge der Tagessummen bleiben ebenfalls als genauer Dezimaltext erhalten. Genaue Beträge addiert das Tool exakt, nie als Gleitkommazahlen.

## Was der erste Live-Test gezeigt hat

Am 2026-10-21 lief das Tool gegen eine apaleo-DEV-Sandbox (Hotels BER und VIE, je 35 Buchungszeilen an einem Tag). Die aufgezeichneten Antworten liegen anonym in `test/fixtures/apaleo/live/`; die Tests lassen den ganzen Export darüber laufen. Die Antworten auf die offenen Fragen:

- **Konten pro Reservierung** (`EPEBVUIU-1_Liabilities/Reduced:7.00`, `ZAQSEFYC-1_Receivables`) haben eine `parentNumber` (`3000`, `1200`, `9999`) und stehen nicht im Kontenplan.
- **Zahlungen** kommen als Paar: `Zahlung → <Folio>_Receivables/Offset` und `<Folio>_Receivables → <Folio>_Receivables/Offset` mit dem negativen Betrag; ebenso die Umbuchung auf den Debitor mit `<Res>_AccountsReceivable/Offset`.
- **Anzahlungen**: Eingang als `PostPrepayment` auf `<Res>_Liabilities/<Satz>` mit `taxes[]`; Auflösung als `PostCharge` (Soll Gastforderung, Haben `<Res>_Liabilities`) mit **negativem** Betrag und negativen `taxes[]`; Erstattung als `PostPrepayment` mit negativem Betrag. Zeilen mit `PostPrepaymentVat` oder auf `VatOnLiabilities` gab es nicht.
- **Netto und Steuer** haben bis zu acht Nachkommastellen; `gross = net + Σ taxes` gilt auf jeder Zeile exakt.
- **Tagessummen** passen zum Buchungsjournal nur über den **Saldo** (Soll minus Haben) pro Konto: Erlöse und Anzahlungen netto, die USt-Konten mit den genauen Steuern der Erlös- und Anzahlungszeilen, alle anderen Konten brutto. Die Aufteilung in Soll und Haben folgt keiner einheitlichen Regel. So passten alle 18 Konten (BER) und 19 Konten (VIE) an beiden Tagen.

## Live-Test

```sh
APALEO_CLIENT_SECRET=... apaleo-datev live-smoke --property BER [--date 2026-10-18]
```

Der Befehl holt ein Token, das Hotel, den Kontenplan, einen Geschäftstag des Buchungsjournals (standardmäßig vorgestern in der Zeitzone des Hotels) und die Tagessummen, zeigt Anzahlen und Summen und schreibt keine Dateien. Er endet nur mit 0, wenn jeder erforderliche Schritt klappt; eine fehlende Berechtigung für die Tagessummen meldet er als `SKIP`, nicht als Fehler. Hat der Tag keine Buchungen, steht beim Buchungsjournal `WARN`, und das Ergebnis sagt, dass über die Buchungen nichts geprüft wurde: Starte ihn dann mit `--date` für einen Tag mit Buchungen.

Er vergleicht die Tagessummen mit dem Buchungsjournal über den Saldo, wie die Prüfung des Exports (`N of M accounts match`), und beantwortet die Fragen, die die Swagger-Dokumentation offen lässt: ob Konten pro Reservierung eine `parentNumber` haben, wie viele Anzahlungszeilen eingegangen, aufgelöst und davon erstattet sind (jeweils mit und ohne `taxes[]`), ob es `PostPrepaymentVat`- oder `VatOnLiabilities`-Zeilen gibt und wie viele Steuereinträge Satz 0 und Betrag 0 haben. Ein Produktivkonto kann anders aussehen als die Sandbox: Teile seine Ausgabe deshalb bitte (ohne Namen), wenn du ihn zum ersten Mal startest.

Die Tests rufen ihn nie gegen das Netz auf; sie nutzen die erfundenen Testdaten des „Hotel Beispiel“ in `test/fixtures/apaleo/` und die aufgezeichneten Sandbox-Antworten in `test/fixtures/apaleo/live/`. Weitere echte Antworten sind als neue Testdaten willkommen, sobald sie den Datenschutz-Scan (`node test/helpers/fixture-scan.ts <Ordner>`) bestehen und Namen, Reservierungsnummern und Beträge anonymisiert sind.
