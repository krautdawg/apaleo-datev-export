# Sicherheitsrichtlinie

## Eine Sicherheitslücke melden

Melde Sicherheitsprobleme bitte **vertraulich**, nicht in einem öffentlichen Issue, Pull Request oder einer Diskussion.

Nutze die private Meldung von Sicherheitslücken auf GitHub: Öffne auf der Seite des Repositorys **Security > Advisories > Report a vulnerability** (ein privates Security Advisory auf GitHub). Nur die Maintainer sehen es.

Beschreib, was du gefunden hast, wie es sich nachstellen lässt und was ein Angreifer damit anfangen könnte. Füge nie ein echtes apaleo-Client-Secret, ein Zugriffstoken, eine Beraternummer oder Gästedaten ein; beschreib sie, oder nimm erfundene Werte.

Du bekommst eine Antwort, sobald ein Maintainer sich die Meldung ansehen kann. Das ist ein Projekt von Freiwilligen, eine feste Antwortzeit gibt es also nicht.

## Was dazugehört

Zum Beispiel:

- Das Client-Secret oder ein Zugriffstoken landet in der Ausgabe, einem Log, einer Protokolldatei oder einer Fehlermeldung.
- Gästenamen oder andere personenbezogene Daten landen in einer DATEV-Datei oder einem Protokoll.
- Eine Konfiguration, eine Kontenzuordnung oder eine Antwort von apaleo bringt das Tool dazu, Dateien außerhalb des Ausgabeordners zu schreiben oder Code auszuführen.
- Schwächen im Dockerfile oder im Compose-Beispiel (zum Beispiel ein Lauf als root oder ein Secret, das im Image steckt).

Nicht dazu gehören: Probleme in apaleo, DATEV, Node.js oder den Abhängigkeiten selbst (melde sie dort) und falsche Buchungen, die kein Sicherheitsproblem sind (eröffne dafür ein normales Issue).

## Unterstützte Versionen

Unterstützt wird nur der neueste Commit auf `main`. Es gibt keine Branches für ältere Versionen. Korrekturen landen auf `main`; aktualisiere mit `git pull` und baue neu.

## Keine Belohnung

Das ist ein kostenloses Open-Source-Projekt ohne Budget. Es gibt kein Bug-Bounty-Programm und keine Bezahlung für Meldungen. Mit deinem Einverständnis nennen wir dich bei der Korrektur und in `CHANGELOG.md`.
