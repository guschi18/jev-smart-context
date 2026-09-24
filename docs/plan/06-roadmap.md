# Roadmap und Reihenfolge

Phasenübersicht mit Status sowie verbindliche Reihenfolge und bewusste Vereinfachungen.

> Teil des aufgeteilten Plans. Index, Status und Leseregeln: [`Plan.md`](../../Plan.md). Abschnittsnummern (§) entsprechen dem ursprünglichen Gesamtplan.

## 12. Umsetzungsphasen

Statusübersicht (Details in den verlinkten Dateien):

| Phase | Inhalt | Status | Details |
| --- | --- | --- | --- |
| 0 | Entwicklungsumgebung und Baseline | ✅ | [history/phase-0-2-context-lab-replay.md](history/phase-0-2-context-lab-replay.md) |
| 1 | Context Lab im bestehenden Projekt | ✅ | [history/phase-0-2-context-lab-replay.md](history/phase-0-2-context-lab-replay.md) |
| 2 | Replay-Evaluation | ✅ Go | [history/phase-0-2-context-lab-replay.md](history/phase-0-2-context-lab-replay.md) |
| 3 | OpenCode-Plugin | ✅ | [agents/opencode.md](agents/opencode.md) |
| 4 | OpenCode-Praxistest | ✅ Go | [agents/opencode.md](agents/opencode.md) |
| 5 | Summary-Stufen | ✅ Go (v7/v8), Flag bleibt aus | [history/phase-5-summary-stufen.md](history/phase-5-summary-stufen.md) |
| 6 | Cache-aware Routing (OpenCode) | ✅ Go – Turn-Policy mit Platzhaltern (D2 Must-keep 100 %, −41 % glm / −19 % luna); Hook p95 0,9–1,6 s als bekannte Einschränkung; Flag bleibt aus | [agents/opencode.md](agents/opencode.md) |
| 7A | Claude Code | ▶ nächster Schritt | [agents/claude-code.md](agents/claude-code.md) |
| 7B | Codex | offen | [agents/codex.md](agents/codex.md) |
| 7C | Agentübergreifende Konsolidierung | offen | [agents/cross-agent.md](agents/cross-agent.md) |

## 13. Reihenfolge und bewusste Vereinfachungen

Verbindliche Reihenfolge:

```text
Context Lab
→ Replay-Messung
→ OpenCode Live-Adapter
→ OpenCode-Praxistest
→ Summary-Stufen in OpenCode
→ Cache-Optimierung in OpenCode
→ Claude Code: Machbarkeit → Offline-Replay → Adaptertests → Live-Abnahme
→ Codex: Machbarkeit → Offline-Replay → Adaptertests → Live-Abnahme
→ agentübergreifende Konsolidierung
```

Bewusst verschoben:

- Vektor-Retrieval erst, wenn deterministischer Vorfilter plus Jev messbar nicht reichen.
- Datenbank erst, wenn lokale Dateien nicht mehr genügen.
- Summary-Generierung erst nach erfolgreichem binären Selector.
- Claude-Code- und Codex-Pfade erst nach vollständiger Erprobung aller vorgesehenen Funktionen in OpenCode und danach getrennt mit eigenem Go/No-Go.
- universelles Plugin-Paket erst, wenn mindestens zwei Live-Adapter ihre jeweiligen Abnahmekriterien erfüllen.
- exakte Provider-Preislogik erst, wenn die benötigten Werte zuverlässig verfügbar sind.
