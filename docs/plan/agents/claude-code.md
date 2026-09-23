# Agent: Claude Code

Integrationsmöglichkeiten und Phase 7A. Zusätzlich `../05-evaluation-und-abnahme.md` lesen.

> Teil des aufgeteilten Plans. Index, Status und Leseregeln: [`Plan.md`](../../../Plan.md). Abschnittsnummern (§) entsprechen dem ursprünglichen Gesamtplan.

## 8. Agent-Integrationen

### Claude Code

Claude Code bietet unter anderem:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse` / `PostToolUse`
- `PreCompact` / `PostCompact`
- `SessionEnd`
- Transcript-Pfade in Hook-Inputs

`UserPromptSubmit` kann zusätzlichen Context injizieren oder einen Prompt blockieren. Normale Hooks bieten jedoch keinen dokumentierten Weg, die bereits assemblierte Historie vor jedem Modellaufruf beliebig zu ersetzen.

Darum erfolgt die Integration in Stufen:

1. Beobachtung und Erfassung über native Hooks.
2. Smarter Context nach Sessionstart und Compaction.
3. Handoff/Rebuild in eine frische Session, wenn sich ein Neuaufbau lohnt.
4. Für vollständig transparente Rewrites gegebenenfalls ein Host auf Basis des Claude Agent SDK statt eines reinen CLI-Hooks.

Besonders nützlich: Aktuelle `SessionStart`-Hooks können beim Resume `context_tokens`, `prompt_cache_likely_expired` und `estimated_cache_write_usd` liefern. Diese Felder können die Reuse/Rebuild-Entscheidung direkt speisen.

Referenz: [Claude Code Hooks](https://code.claude.com/docs/en/hooks)

### Phase 7: Claude Code und Codex getrennt anbinden

Voraussetzung: Erst beginnen, wenn die Phasen 3 bis 6 in OpenCode abgeschlossen und abgenommen sind. Claude Code und Codex erhalten getrennte Entscheidungen; ein No-Go bei einem Agent blockiert den anderen nicht.

Für ihre späteren Live-Abnahmen dient das Protokoll in Abschnitt 15 als Mess- und Sicherheitsvorlage. Jeder Agent braucht seinen eigenen offiziell unterstützten Integrationspfad, eine passende Kontrollgruppe und ein eigenes Go/No-Go; OpenCode-spezifische Hooks und Grenzwerte werden nicht ungeprüft übernommen.

#### Phase 7A: Claude Code

1. Offizielle Hooks und Agent-SDK-Schnittstellen auf Beobachtung, Context-Injektion, per-request Rewrite, Resume und Compaction prüfen und die tatsächlich verfügbaren Fähigkeiten festhalten.
2. Mindestens drei vorhandene Claude-Code-Sessions offline durch den Compiler replayen. Tokenreduktion, Must-keep-Recall und potenzielle Kostenersparnis messen, ohne einen Adapter oder interne Dateien zu verändern.
3. Anhand der Schnittstellenprüfung den kleinsten tragfähigen Pfad wählen: CLI-Hooks für Beobachtung/Handoff oder Agent SDK für transparente Rewrites. Fehlende offizielle Fähigkeiten nicht durch interne Session-Manipulation ersetzen.
4. Einen dünnen Claude-Adapter ausschließlich mit dokumentierten Feldern bauen; agent-spezifische Transcript-Logik bleibt hinter einer isolierten Adaptergrenze.
5. Fixtures und Tests für Hook-Versionen, Tool-Transaktionen, Resume, Compaction, Redaction, Parserfehler und vollständigen Fail-safe ergänzen.
6. Mindestens drei reale Langzeitsessions mit je mindestens 30 Modellnachrichten prüfen und Qualität, Latenz, Reduktion, Kosten, Cache-Effekt und Fail-safe getrennt ausweisen.
7. Eigenständiges Go/No-Go für Claude Code treffen. Wenn kein offizieller sicherer Rewrite-Pfad existiert, endet 7A bewusst mit Messung, Beobachtung und Handoff.
