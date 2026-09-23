# Agentübergreifende Konsolidierung

Phase 7C: erst nach getrennten Abnahmen von Claude Code und Codex.

> Teil des aufgeteilten Plans. Index, Status und Leseregeln: [`Plan.md`](../../../Plan.md). Abschnittsnummern (§) entsprechen dem ursprünglichen Gesamtplan.

#### Phase 7C: Agentübergreifende Konsolidierung

1. Claude-, Codex- und OpenCode-Metriken auf dieselben Definitionen normalisieren und getrennte Ergebnisse vergleichbar darstellen.
2. Nur nachgewiesen gemeinsame Adapterlogik in den Core verschieben; agent-spezifische Parser und Policies getrennt lassen.
3. Abschließende Regressionstests für Must-keep, Tool-Transaktionen, Redaction und Fail-safe über alle freigegebenen Adapter ausführen.
4. Ein universelles Plugin-Paket nur bauen, wenn mindestens zwei Live-Adapter die jeweiligen Abnahmekriterien erfüllen.

Ergebnis: unabhängig geprüfte Claude-Code- und Codex-Pfade mit agent-spezifischem Go/No-Go und nur belastbar gemeinsamer Logik.
