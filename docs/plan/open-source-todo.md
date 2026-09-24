# Offene Punkte: Open-Source-Bereitschaft (Stand 24. September 2026)

Das Repo [`guschi18/jev-smart-context`](https://github.com/guschi18/jev-smart-context) ist öffentlich (MIT). Diese Punkte machen es für andere leichter nutzbar und erweiterbar. Abhaken, wenn erledigt.

## Empfohlen

- [ ] **1. Tests in die CI.** `.github/workflows/ci.yml` prüft nur Lint, `tsc` und Build. Ein Schritt `npm run test:context` fehlt; PRs von außen laufen sonst nicht durch die 51 Context-Tests. Aufwand: eine Zeile. Hinweis: Die Tests nutzen `--experimental-strip-types`; in der CI läuft Node 22, lokal Node 24. Prüfen, ob Node 22 genügt, sonst `node-version` anheben.
- [ ] **2. Kampagnen-Skripte ins Repo.** Harness, Prompts und Auswertung für die Live-A/B-Messungen liegen nur lokal in `%TEMP%\jev-campaign-scripts\` (`setup.mjs`, `harness.mjs`, `prompts.mjs`, `evaluate.mjs`, `compact.mjs`, `d2check.mjs` u. a.). Ohne sie kann niemand die Ergebnisse in [`history/phase-6-live-ab.md`](history/phase-6-live-ab.md) nachvollziehen. Vorher feste Pfade (`D:\Tools\Jev-Explainend`, `C:\nvm4w\…\opencode.exe`) über Umgebungsvariablen konfigurierbar machen, z. B. nach `scripts/campaign/`, und eine kurze Anleitung ergänzen. Keine Secrets enthalten (Key kommt per `--env-file`), trotzdem vor dem Commit erneut prüfen.

## Optional

- [ ] **3. Englische Architekturübersicht.** Die Planungsdoku unter `docs/plan/` ist deutsch. Eine kurze englische Übersicht (z. B. `docs/architecture.md`: Compiler, Plugin, Turn-Policy, Sicherheitsmodell) hilft internationalen Mitwirkenden; der Plan kann deutsch bleiben.
- [ ] **4. Lizenz ergänzen.** `LICENSE` nennt nur „Copyright (c) 2026 Daniel Avila“ (Ursprung: Jev Explained). Diese Zeile muss bleiben; eine eigene Copyright-Zeile für die Erweiterungen kann dazukommen.
- [ ] **5. `Plan copy.md` aufräumen.** Versioniertes Duplikat des alten Gesamtplans. Laut Plan-Regel bisher erhalten; für das öffentliche Repo entfernen oder nach `docs/plan/history/` verschieben.
- [ ] **6. GitHub-Einstellungen.** Topics setzen (z. B. `opencode`, `context-engineering`, `llm`, `coding-agents`), Issues/Discussions aktivieren. Issue- und PR-Templates, `CONTRIBUTING.md`, `SECURITY.md` und `CODE_OF_CONDUCT.md` sind vorhanden.

## Lokal aufräumen (nicht im Repo)

- [ ] `Erkenntnisse.md` im Projektordner löschen (Inhalt steht in der Doku, nicht committet).
- [ ] Alte Messordner `%TEMP%\jev-*` löschen (Rohdaten der Kampagnen; die Ergebnisse sind dokumentiert). Die Sessions bleiben zusätzlich in `~/.local/share/opencode/opencode.db`.
