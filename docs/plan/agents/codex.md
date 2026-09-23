# Agent: Codex

Integrationsmöglichkeiten und Phase 7B. Zusätzlich `../05-evaluation-und-abnahme.md` lesen.

> Teil des aufgeteilten Plans. Index, Status und Leseregeln: [`Plan.md`](../../../Plan.md). Abschnittsnummern (§) entsprechen dem ursprünglichen Gesamtplan.

## 8. Agent-Integrationen

### Codex

Codex bietet laut offizieller OpenAI-Dokumentation unter anderem:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse` / `PostToolUse`
- `PreCompact` / `PostCompact`
- `SubagentStart` / `SubagentStop`
- `Stop`, `Interrupt` und `SessionEnd`
- `transcript_path` in den gemeinsamen Hook-Feldern
- Plugin-gebündelte Hooks

Hooks können zusätzlichen Context liefern und Compaction begleiten. Ein dokumentierter, allgemeiner Message-Rewrite wie bei OpenCode ist nicht vorausgesetzt. Außerdem bezeichnet die OpenAI-Dokumentation das Transcript-Format ausdrücklich nicht als stabile Hook-Schnittstelle.

Darum gilt:

- Parser hinter eine kleine Adaptergrenze setzen.
- Keine Core-Logik an Codex-JSONL-Feldnamen koppeln.
- Zunächst Sessionstart-, Compaction- und Handoff-Flows unterstützen.
- Eine vollständig dynamische Integration nur über eine offiziell geeignete Host-/Protokollschnittstelle bauen, nicht durch Patchen interner Dateien.

Referenz: [OpenAI Docs: Codex Hooks](https://learn.chatgpt.com/docs/hooks)

### Phase 7: Claude Code und Codex getrennt anbinden

Voraussetzung: Erst beginnen, wenn die Phasen 3 bis 6 in OpenCode abgeschlossen und abgenommen sind. Claude Code und Codex erhalten getrennte Entscheidungen; ein No-Go bei einem Agent blockiert den anderen nicht.

Für ihre späteren Live-Abnahmen dient das Protokoll in Abschnitt 15 als Mess- und Sicherheitsvorlage. Jeder Agent braucht seinen eigenen offiziell unterstützten Integrationspfad, eine passende Kontrollgruppe und ein eigenes Go/No-Go; OpenCode-spezifische Hooks und Grenzwerte werden nicht ungeprüft übernommen.

#### Phase 7B: Codex

1. Offizielle Hooks und Host-/Protokollschnittstellen auf Beobachtung, Context-Injektion, per-request Rewrite, Resume und Compaction prüfen und die tatsächlich verfügbaren Fähigkeiten festhalten.
2. Mindestens drei vorhandene Codex-Sessions offline durch den Compiler replayen. Tokenreduktion, Must-keep-Recall und potenzielle Kostenersparnis messen, ohne einen Adapter oder interne Dateien zu verändern.
3. Einen isolierten Parser nur für dokumentierte Hook-Felder und stabile Exportformate definieren; keine Core-Logik an proprietäre JSONL-Feldnamen koppeln und keine internen Sessiondateien mutieren.
4. Den kleinsten offiziell unterstützten Codex-Adapter für Sessionstart-, Compaction- und Handoff-Flows bauen; per-request Rewrites nur über eine dafür dokumentierte Schnittstelle.
5. Fixtures und Tests für Formatversionen, Tool-Transaktionen, Resume, Compaction, Redaction, Parserfehler und vollständigen Fail-safe ergänzen.
6. Mindestens drei reale Langzeitsessions mit je mindestens 30 Modellnachrichten prüfen und Qualität, Latenz, Reduktion, Kosten, Cache-Effekt und Fail-safe getrennt ausweisen.
7. Eigenständiges Go/No-Go für Codex treffen. Wenn kein offizieller sicherer Rewrite-Pfad existiert, endet 7B bewusst mit Messung, Beobachtung und Handoff.
