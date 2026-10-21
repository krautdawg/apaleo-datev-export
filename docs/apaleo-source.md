# Quelle apaleo: Endpunkte, Berechtigungen und der Live-Test

Wie das Tool apaleo liest, was die Custom App braucht und wie du ein echtes Konto prüfst. Geprüft gegen die Swagger-Dokumente von apaleo [finance-v1](https://api.apaleo.com/swagger/finance-v1/swagger.json) und [inventory-v1](https://api.apaleo.com/swagger/inventory-v1/swagger.json), heruntergeladen am **2026-10-20**.

## Custom App und Berechtigungen

Leg in apaleo unter **Apps > Connected apps** eine Custom App an (Client-Typ „simple“, Client Credentials). Die Client-ID der App kommt in `apaleo.clientId` (oder `APALEO_CLIENT_ID`), das Secret in die Umgebungsvariable `APALEO_CLIENT_SECRET`. Das Secret kommt nie in die Konfigurationsdatei. Schritt für Schritt: [setup-apaleo.md](setup-apaleo.md).

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
| `POST /finance/v1/accounts/aggregate-daily?propertyId&from&to` | die eigenen Summen von apaleo pro Hauptkonto, ein Geschäftstag pro Anfrage |

Bei Anfragelimits (429) wartet das Tool `Retry-After` ab, höchstens 60 s, und versucht es dann noch einmal; Server- und Netzwerkfehler wiederholt es bis zu viermal mit wachsenden Abständen. Anfragen brechen nach 60 s ab. Höchstens zwei Export-Anfragen laufen gleichzeitig; das hält Entwicklungskonten (5 Anfragen pro Sekunde) unter der Grenze.

Beträge im Buchungsjournal kommen als Gleitkommazahlen und werden in ganze Cent umgerechnet; ein Betrag, der mehr als 0,0001 von einem ganzen Cent abweicht, stoppt den Export mit der Buchungsnummer aus apaleo. Beträge der Tagessummen können mehr Nachkommastellen haben und bleiben als genauer Dezimaltext erhalten.

## Live-Test

```sh
APALEO_CLIENT_SECRET=... apaleo-datev live-smoke --property BER [--date 2026-10-18]
```

Der Befehl holt ein Token, das Hotel, den Kontenplan, einen Geschäftstag des Buchungsjournals (standardmäßig vorgestern in der Zeitzone des Hotels) und die Tagessummen, zeigt Anzahlen und Summen und schreibt keine Dateien. Er endet nur mit 0, wenn jeder erforderliche Schritt klappt; eine fehlende Berechtigung für die Tagessummen meldet er als `SKIP`, nicht als Fehler. Er beantwortet auch Fragen, die die Swagger-Dokumentation offen lässt. Teile seine Ausgabe deshalb bitte (ohne Namen), wenn du ihn zum ersten Mal startest:

- Haben Konten pro Reservierung eine `parentNumber`?
- Haben Zeilen zur Auflösung einer Anzahlung (Soll Liabilities, Haben Receivables) `taxes[]`, und gibt es Zeilen mit `PostPrepaymentVat` oder `VatOnLiabilities`?
- Wie viele Steuereinträge haben Satz 0 und Betrag 0?
- Passen die Tagessummen zu den Brutto- oder zu den Nettobeträgen des Buchungsjournals?

Die Tests rufen ihn nie gegen das Netz auf; sie nutzen die erfundenen Testdaten des „Hotel Beispiel“ in `test/fixtures/apaleo/`. Echte Antworten sind als neue Testdaten willkommen, sobald Namen, Reservierungsnummern und Beträge anonymisiert sind.
