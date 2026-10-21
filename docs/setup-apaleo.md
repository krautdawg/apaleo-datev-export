# Die apaleo Custom App einrichten

Das Tool liest dein apaleo-Konto über eine **Custom App**: einen kleinen API-Zugang, den ein Admin im eigenen apaleo-Konto anlegt. Du brauchst keinen Eintrag im apaleo Store, keine Zertifizierung und keinen Partnervertrag. Die App liest nur; das Tool schreibt nie etwas nach apaleo.

Du brauchst einen apaleo-Benutzer mit Admin-Rechten für das Konto. Es dauert etwa zehn Minuten.

Die Bezeichnungen unten folgen der apaleo-Dokumentation, Stand Oktober 2026. Sieht dein Bildschirm etwas anders aus: Entscheidend sind der Client-Typ und die Berechtigungen.

## 1. App anlegen

1. Melde dich bei apaleo an und öffne **Apps > Connected apps**.
2. Wähle **Add custom app**.
3. Client-Typ: **simple client** (Client Credentials). Wähle keinen Connect Client; der ist für Apps im apaleo Store.
4. Zugriff: Wähle **fine-grained permissions** (von apaleo empfohlen) statt Scopes. Damit kannst du auch die Hotels (Properties) auswählen.
5. Client-Code: 3 bis 30 Zeichen, Großbuchstaben, Ziffern und `_`, zum Beispiel `DATEV_EXPORT`.
6. Fragt apaleo nach dem Zugriff auf personenbezogene Daten (PII): Das Tool schreibt nie Gästenamen in die DATEV-Datei, wurde aber nicht mit ausgeschalteter Option getestet. Laut apaleo lässt sich die Wahl später nicht ändern; lass sie im Zweifel auf der Voreinstellung von apaleo.

## 2. Diese Berechtigungen vergeben

| Berechtigung | Was das Tool damit liest | |
|---|---|---|
| `core.subledger_schema.read` | den Kontenplan | erforderlich |
| `core.subledger_export.create` | den Buchungsexport, ein Geschäftstag pro Anfrage | erforderlich |
| `core.properties.read` | die Liste der Hotels (ID, Name, Zeitzone, Währung) | erforderlich |
| `core.subledger_aggregate.create` | die Tagessummen von apaleo, für `live-smoke` und die optionale Vollständigkeitsprüfung (`checks.aggregates: true`) | optional |

Die beiden „create“-Berechtigungen klingen nach Schreiben. apaleo nutzt sie aber für POST-Anfragen, die nur einen Export oder eine Summe berechnen. In deinem Konto werden keine Buchungen und keine Stammdaten angelegt. apaleo vermerkt nur jeden Export in seinem Export-Audit-Log.

Hast du stattdessen einen Scope-Client angelegt, braucht er den Scope `accounting.read`, und du trägst ihn in der Konfiguration unter `apaleo.scopes` ein.

## 3. Hotels auswählen

Wähle jedes Hotel aus, das du exportieren willst. Ein Hotel, das die App nicht sieht, meldet das Tool als `E-PROPERTY-UNKNOWN`.

## 4. Client-ID und Secret kopieren

apaleo zeigt eine **Client-ID** und ein **Client-Secret**. Das Secret wird nur einmal angezeigt, kopiere es also sofort.

- Die Client-ID kommt in die Konfigurationsdatei als `apaleo.clientId` (oder in die Umgebungsvariable `APALEO_CLIENT_ID`).
- Das Secret kommt in die Umgebungsvariable `APALEO_CLIENT_SECRET`, nie in die Konfigurationsdatei. Mit Docker schreibst du es in `.env`:

```sh
cp .env.example .env
# .env öffnen und APALEO_CLIENT_SECRET=... eintragen
```

Behandle das Secret wie ein Passwort: Es liest dein ganzes Buchungsjournal. Lege es nie in Git ab und kopiere es in kein Issue. Ist es nach außen gelangt, lösche das Secret der App in apaleo und lege ein neues an.

## 5. Verbindung prüfen

```sh
apaleo-datev doctor        # Konfigurationsdatei, Client-ID und Secret gefunden?
apaleo-datev properties    # listet die Hotels, die die App lesen darf
apaleo-datev live-smoke --property BSP
```

`live-smoke` liest einen Geschäftstag (standardmäßig vorgestern), zeigt Anzahlen und Summen und schreibt nichts. Der Befehl endet mit 0, wenn jeder erforderliche Schritt klappt. Fehlt die optionale Berechtigung, steht dort `SKIP`, kein Fehler. Antwortet apaleo mit 403, nennt die Meldung die Berechtigungen von oben.

Nächster Schritt: die Kontenzuordnung mit `init-mapping` anlegen (siehe [README](../README.md#schnellstart) und den [Leitfaden zur Kontenzuordnung](mapping-guide.md)).

Mehr zu Endpunkten, Wiederholungen und Anfragelimits: [apaleo-source.md](apaleo-source.md).
