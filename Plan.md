# Smart Context für Coding Agents

Stand: 24. September 2026

Status: Phase 6 abgeschlossen; Turn-Policy mit Platzhaltern live Go (D2 Must-keep 100 %, −41 % glm / −19 % luna inkl. Jev). Routing bleibt hinter `JEV_CACHE_ROUTING=1` + `JEV_CACHE_POLICY=turn`, standardmäßig aus. Phase 5 bleibt Go; `JEV_SUMMARY_LEVELS` bleibt standardmäßig aus

**Nächster Schritt: Phase 7A – Claude Code** ([`docs/plan/agents/claude-code.md`](docs/plan/agents/claude-code.md)). Phase 6 ist abgeschlossen (24. September 2026): Die Turn-Policy mit Platzhaltern hat den D2-Retest mit Must-keep in allen 8 Armen bestanden, ohne erfundene Tool-Arbeit, und spart −41 % bei glm und −19 % bei luna (inkl. Jev). A–C werden auf Entscheidung des Nutzers nicht erneut gemessen. Bekannte Einschränkung: Hook p95 0,9–1,6 s (Ziel < 700 ms, OpenRouter-Latenz). Keine OpenCode-Kompaktierungsgrenze setzen. Live-Läufe sind kostenpflichtig und starten erst nach ausdrücklicher Freigabe. Details unter „Phase 6“ in [`docs/plan/agents/opencode.md`](docs/plan/agents/opencode.md), Wiedereinstieg in [`docs/plan/restart.md`](docs/plan/restart.md).

Dieser Plan ist aufgeteilt, damit ein neuer Chat nur die relevanten Teile lesen muss. Der vollständige frühere Text steht wortgetreu in den Dateien unter [`docs/plan/`](docs/plan/). Die Abschnittsnummern (§) im Text beziehen sich auf den ursprünglichen Gesamtplan. Die Tabelle unten zeigt, in welcher Datei jeder Abschnitt jetzt steht.

## Leseregel für einen neuen Chat

1. **Immer:** diese Datei, [`01-ziel-und-projekt.md`](docs/plan/01-ziel-und-projekt.md), [`03-architektur.md`](docs/plan/03-architektur.md), [`04-sicherheit-und-risiken.md`](docs/plan/04-sicherheit-und-risiken.md)
2. **Arbeit an OpenCode (Phasen 3–6):** zusätzlich [`agents/opencode.md`](docs/plan/agents/opencode.md), vor Messungen [`05-evaluation-und-abnahme.md`](docs/plan/05-evaluation-und-abnahme.md)
3. **Arbeit an Claude Code:** zusätzlich [`agents/claude-code.md`](docs/plan/agents/claude-code.md) und [`05-evaluation-und-abnahme.md`](docs/plan/05-evaluation-und-abnahme.md)
4. **Arbeit an Codex:** zusätzlich [`agents/codex.md`](docs/plan/agents/codex.md) und [`05-evaluation-und-abnahme.md`](docs/plan/05-evaluation-und-abnahme.md)
5. **Nur bei Bedarf:** [`02-jev-modell.md`](docs/plan/02-jev-modell.md) für Fragen zu Jev-Primitiven und Schwellenwerten, [`06-roadmap.md`](docs/plan/06-roadmap.md) für Reihenfolge und Status, `history/*` für Messwerte, Begründungen und frühere Fehlerursachen

## Verbindliche Kurzregeln

- Vor Codeänderungen die relevanten Next.js-Dokumente unter `node_modules/next/dist/docs/` lesen (`AGENTS.md`).
- Den Arbeitsbaum nicht resetten und nicht pauschal wiederherstellen. Keine fremden Änderungen überschreiben.
- API-Schlüssel nie in State, Instructions, Logs, Metriken oder Plan-Ausgaben schreiben.
- Kostenpflichtige Live-Läufe und die Übertragung von Transcripts vorher ausdrücklich freigeben lassen.
- Die binäre Policy bleibt Default. `JEV_SUMMARY_LEVELS` bleibt aus, bis eine separate Produktentscheidung fällt.
- Jeder Agent bekommt ein eigenes Go/No-Go. Claude Code und Codex (Phase 7) folgen erst nach Phase 6.

## Dateien und ursprüngliche Abschnitte

| Datei | Inhalt | Ursprüngliche Abschnitte |
| --- | --- | --- |
| [`01-ziel-und-projekt.md`](docs/plan/01-ziel-und-projekt.md) | Ziel, Meta-Attention, Projektaufbau, Repository-Regel | §1, §2 |
| [`02-jev-modell.md`](docs/plan/02-jev-modell.md) | Jev-Primitive, Confidence, Stärken, Grenzen, Referenzen | §3 |
| [`03-architektur.md`](docs/plan/03-architektur.md) | Produktdefinition, Chunks, Pipeline A–F, Cache-Ökonomie, Reasoning, Summary-Rubrik | §4, §5, §6, §7, §8 (Reasoning), §10 |
| [`04-sicherheit-und-risiken.md`](docs/plan/04-sicherheit-und-risiken.md) | Sicherheit, Datenschutz, Risiken | §9, §14 |
| [`05-evaluation-und-abnahme.md`](docs/plan/05-evaluation-und-abnahme.md) | Replay-Korpus, Metriken, MVP-Kriterien, Abnahmeprotokoll und -kriterien | §11, §15 (Protokoll, Kriterien, Entscheidung, Sicherheitsgrenzen) |
| [`06-roadmap.md`](docs/plan/06-roadmap.md) | Phasenstatus, Reihenfolge, Vereinfachungen | §12 (Übersicht), §13 |
| [`agents/opencode.md`](docs/plan/agents/opencode.md) | OpenCode-Adapter, Phase 3–4, Summary-Baseline und -Policy, **Phase 6** | §8 (OpenCode), §12 Phase 3/4/6, §15 (Baseline, Policy) |
| [`agents/claude-code.md`](docs/plan/agents/claude-code.md) | Claude-Code-Hooks, Phase 7A | §8 (Claude Code), §12 Phase 7/7A |
| [`agents/codex.md`](docs/plan/agents/codex.md) | Codex-Hooks, Phase 7B | §8 (Codex), §12 Phase 7/7B |
| [`agents/cross-agent.md`](docs/plan/agents/cross-agent.md) | Konsolidierung der Agenten | §12 Phase 7C |
| [`history/phase-0-2-context-lab-replay.md`](docs/plan/history/phase-0-2-context-lab-replay.md) | Phase 0–2 mit Replay-Ergebnissen | §12 Phase 0/1/2 |
| [`history/phase-5-summary-stufen.md`](docs/plan/history/phase-5-summary-stufen.md) | Phase 5 vollständig, Abnahmen v1–v8, Ursachen, Fixes, Kosten | §12 Phase 5, §15 (Replay-Ausgangspunkt, reale Abnahme), §16 |
| [`history/phase-6-live-ab.md`](docs/plan/history/phase-6-live-ab.md) | Phase 6 Schritt 5: Live-A/B v1/F/v3, Turn-Policy (turn2, turn3, D2, Platzhalter-Retest D3), alle Messwerte, Befunde, Kosten | §12 Phase 6 |

## Pflege

- Neue Ergebnisse gehören in die Datei der betroffenen Phase beziehungsweise des betroffenen Agenten. Hier werden nur Status und nächster Schritt aktualisiert.
- Abgeschlossene Arbeitsprotokolle wandern nach `docs/plan/history/`.
