# Die apaleo Custom App einrichten

Das Tool liest dein apaleo-Konto über eine **Custom App**: einen kleinen API-Zugang, den ein Admin im eigenen apaleo-Konto anlegt. Du brauchst keinen Eintrag im apaleo Store, keine Zertifizierung und keinen Partnervertrag. Die App liest nur; das Tool schreibt nie etwas nach apaleo.

Du brauchst einen apaleo-Benutzer mit Admin-Rechten für das Konto. Es dauert etwa zehn Minuten.

Die Bezeichnungen unten folgen den Bildschirmen von apaleo, wie sie beim ersten Live-Test im Oktober 2026 aussahen (apaleo zeigt sie auf Englisch). Sieht dein Bildschirm etwas anders aus: Entscheidend sind der Client-Typ, die Berechtigungen und die Hotels.

## 1. App anlegen

1. Melde dich bei apaleo an und öffne **Apps > Connected apps**.
2. Klick auf **Add a new app** und dann auf **Add custom app**. Wähle keinen Connect Client; der ist für Apps im apaleo Store.
3. Es öffnet sich die Seite **New simple client** (Client Credentials). Trag einen Namen ein, zum Beispiel `DATEV Export`.
4. Das Feld **Secret description** ist Pflicht: Beschreib, wofür das Secret ist, zum Beispiel `apaleo-datev-export, Buchungsexport für die Kanzlei`.
5. Wähle einen **fine-grained** Client (feingranulare Berechtigungen, von apaleo empfohlen) statt Scopes. Damit wählst du die Hotels und jede Berechtigung einzeln.

## 2. Hotels auswählen

Beim Zugriff auf die Hotels (Properties) wählst du **All properties** oder **Only selected properties**. Mit **Only selected properties** hakst du jedes Hotel an, das du exportieren willst. Ein Hotel, das die App nicht sieht, meldet das Tool als `E-PROPERTY-UNKNOWN`.

## 3. Diese Berechtigungen vergeben

Such jede Berechtigung über das Feld **Search permission** und füge sie hinzu:

| Berechtigung | Was das Tool damit liest | |
|---|---|---|
| `core.subledger_schema.read` | den Kontenplan | erforderlich |
| `core.subledger_export.create` | den Buchungsexport, ein Geschäftstag pro Anfrage | erforderlich |
| `core.properties.read` | die Liste der Hotels (ID, Name, Zeitzone, Währung) | erforderlich |
| `core.subledger_aggregate.create` | die Tagessummen von apaleo, für `live-smoke` und die optionale Vollständigkeitsprüfung (`checks.aggregates: true`) | optional |

Die beiden „create“-Berechtigungen klingen nach Schreiben. apaleo nutzt sie aber für POST-Anfragen, die nur einen Export oder eine Summe berechnen. In deinem Konto werden keine Buchungen und keine Stammdaten angelegt. apaleo vermerkt nur jeden Export in seinem Export-Audit-Log.

Hast du stattdessen einen Scope-Client angelegt, braucht er den Scope `accounting.read`, und du trägst ihn in der Konfiguration unter `apaleo.scopes` ein.

### Personenbezogene Daten (PII)

apaleo fragt, ob die App personenbezogene Daten bekommt: **Retrieve** (alles), **Omit linked** (verknüpfte Personendaten weglassen) oder **Omit all** (alle weglassen). Wähle **Omit all**. Der Export braucht keine personenbezogenen Daten; das ist live getestet: Kontenplan, Buchungsexport und Tagessummen kommen vollständig, und das Tool schreibt ohnehin nie Gästenamen in die DATEV-Datei. Laut apaleo lässt sich die Wahl später nicht ändern.

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
