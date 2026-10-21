# Hinweise für Maintainer

## Das Repository ist vorerst privat

Das Repository ist privat. README, Beschreibung und Themen sind für Menschen geschrieben, die auf GitHub nach „apaleo DATEV Export“ suchen, aber **niemand außerhalb kann sie sehen, bis der Maintainer das Repository öffentlich macht**. Bis dahin bringen sie für die Auffindbarkeit nichts.

Beschreibung und Themen wurden so gesetzt:

```sh
gh repo edit krautdawg/apaleo-datev-export \
  --description "Free open-source apaleo → DATEV export (EXTF Buchungsstapel, SKR03/SKR04) for hotels. Kostenloser apaleo DATEV Export." \
  --add-topic apaleo,datev,datev-export,buchungsstapel,extf,hotel,hospitality,pms,accounting,buchhaltung,steuerberater,skr03,skr04,typescript,cli
gh repo view krautdawg/apaleo-datev-export --json description,repositoryTopics,visibility
```

Die Beschreibung bleibt zweisprachig, damit auch englische Suchen das Projekt finden. Die Übersetzung der Dokumentation hat sie nicht geändert.

Keiner der Schritte unten ist bisher erledigt. Jeder einzelne ist die Entscheidung des Maintainers.

## Zusammenführen

Solange das Repository privat ist, gibt es keinen Schutz für Branches (nicht im kostenlosen Tarif), GitHub blockiert also keinen roten Pull Request. Führe nur zusammen, wenn die CI grün ist:

```sh
gh pr checks <number> --watch --fail-fast && gh pr merge <number> --squash
```

## Vor der Veröffentlichung

In dieser Reihenfolge:

1. [ ] Lies das README in einem frischen Klon und führe den Schnellstart und `export --month 2026-09 --demo --dry-run` noch einmal aus.
2. [ ] Starte `pnpm test` (mit dem Docs-Test) und prüfe, dass die CI auf `main` grün ist.
3. [ ] Durchsuche die Historie nach allem, was nicht öffentlich werden darf: `git log -p | grep -iE 'secret|password|token'` darf nur Code und Dokumentation zeigen, nie einen Wert. Keine echten Gästedaten in den Testdaten.
4. [ ] Stelle die Sichtbarkeit um: `gh repo edit krautdawg/apaleo-datev-export --visibility public --accept-visibility-change-consequences`.
5. [ ] Lade ein Vorschaubild (Social Preview) hoch (Settings > General > Social preview).
6. [ ] Entscheide, ob es GitHub Discussions für Fragen geben soll. Schaltest du sie ein, leg eine `config.yml` in `.github/ISSUE_TEMPLATE/` an, die auf die Discussions verweist; bis dahin sind die Vorlagen für Issues der einzige Weg.
7. [ ] Schalte die private Meldung von Sicherheitslücken ein (Settings > Code security), auf die `SECURITY.md` verweist.
8. [ ] Schalte den Schutz für den Branch `main` mit den erforderlichen CI-Prüfungen ein (für öffentliche Repositories kostenlos), damit sich ein roter Pull Request nicht zusammenführen lässt.
9. [ ] Markiere die erste Version mit dem Tag `v0.1.0`: Verschiebe die Einträge unter `## [Unveröffentlicht]` in `CHANGELOG.md` nach `## [0.1.0] - <Datum>`, committe, dann `git tag v0.1.0 && git push origin v0.1.0`. Ein Tag ist nur eine Version des Quellcodes; nichts wird auf npm oder in einer Container-Registry veröffentlicht.
10. [ ] Prüfe, dass das deutsche README auf github.com richtig angezeigt wird (Tabellen, der Link auf `README.en.md` in der zweiten Zeile, die Anker der Überschriften, die Badges) und dass das CI-Badge den Stand von `main` zeigt.

## Später geplant

Nicht Teil von Version 1, in keiner bestimmten Reihenfolge. Jeder Punkt braucht eine eigene OpenSpec-Änderung.

- **E-Mail-Versand**: die Dateien per SMTP an die Kanzlei schicken statt über einen gemeinsamen Ordner.
- **Verdichtung pro Tag**: eine Buchung pro Konto und Tag statt einer pro Zeile des Buchungsjournals, für sehr große Hotels.
- **Dauerprozess mit eigenem Zeitplan**: ein Modus, der dauerhaft läuft und eine eigene Uhr hat, statt `schedule --once` aus Cron oder der Compose-Schleife.
- **Überwachung und Alarme**: eine Zustandsprüfung und ein Alarm (Mail oder Webhook), wenn ein geplanter Lauf fehlschlägt.
- **Dependabot**: automatische Updates der Abhängigkeiten für npm-Pakete, GitHub Actions und das Docker-Basis-Image.
- **Veröffentlichung auf npm oder in einer Registry**: das Kommandozeilenprogramm auf npm und ein Container-Image in einer Registry veröffentlichen. Heute ist das Paket mit Absicht `"private": true`, und das Image wird lokal gebaut.
- Weitere Quellen (Mews, Smoobu, Stripe) und Zielformate (BMD für Österreich, lexoffice): siehe [architecture.md](architecture.md).
- Übertragung an DATEV online (braucht eine Freigabe von DATEV), Debitoren-Stammdaten, Buchung der Gebühren von Zahlungsdienstleistern und Buchungsportalen.
