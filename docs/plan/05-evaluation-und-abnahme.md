# Evaluation und Abnahmeprotokoll

Metriken, MVP-Kriterien und das agentneutrale Abnahmeprotokoll (Vorlage für OpenCode, Claude Code und Codex). Lesen vor jeder Messung oder Live-Abnahme.

> Teil des aufgeteilten Plans. Index, Status und Leseregeln: [`Plan.md`](../../Plan.md). Abschnittsnummern (§) entsprechen dem ursprünglichen Gesamtplan.

## 11. Evaluation

### Replay-Korpus

Wir erstellen kleine, anonymisierte Fixtures aus realistischen Coding-Sessions:

- Bugfix mit früher gefundener Root Cause
- Refactor mit weiterhin gültigen Constraints
- Taskwechsel innerhalb derselben Session
- große Testausgabe
- wiederholte Dateiinspektionen
- fehlerhafter Tool-Aufruf mit späterem Fix
- Sicherheitsregel, die viele Turns zurückliegt
- User-Korrektur, die eine frühere Anforderung ersetzt
- Subagent-Ergebnis
- Session Resume mit warmem und kaltem Cache

Jedes Fixture enthält manuell markierte Must-keep- und Safe-to-drop-Chunks.

### Vergleich

Für jedes Fixture werden mindestens verglichen:

1. vollständiger Context
2. nur deterministischer Vorfilter
3. Vorfilter plus Jev

Später zusätzlich:

4. mehrstufige Summary-Varianten
5. Cache wiederverwenden gegen Context neu bauen

### Metriken

- Input-Tokens vor und nach Auswahl
- prozentuale Tokenreduktion
- Kosten des Coding-Modells
- Kosten des Selectors
- Nettoersparnis
- Selector-Latenz
- Recall der Must-keep-Chunks
- Precision der behaltenen Chunks
- verlorene Sicherheits- oder Projektregeln
- Task-Erfolg
- Test-Ergebnis
- Qualität beziehungsweise Gleichwertigkeit des resultierenden Patches

### Abnahmekriterien für den MVP

- mindestens 40 % mediane Reduktion der Agent-Input-Tokens
- keine verlorenen Sicherheits- oder Repository-Regeln im kuratierten Korpus
- keine relevante Verschlechterung der Task-Erfolgsrate gegenüber vollem Context
- positive Nettoersparnis nach Jev-Kosten
- Context-Auswahl im Normalfall unter 700 ms p95; 500 ms bleibt Stretch-Ziel
- bei Jev-, Netzwerk- oder Parserfehlern konservativer Fallback auf den vorhandenen Context

Die 40-%- und 500-ms-Werte sind Produktziele, keine bereits gemessenen Eigenschaften.

## 15. Abnahmeprotokoll als Vorlage für weitere Agenten

Dieser Abschnitt hält den OpenCode-Testaufbau und seine Sicherheitsgrenzen fest. Für Claude Code und Codex werden die gleichen Arten von Evidenz, Fehlerprüfungen und Go/No-Go-Entscheidungen verlangt, sobald ihre Phase beginnt. Die konkrete Hook-/Host-Schnittstelle, der mögliche Rewrite-Umfang und die Kontrollgruppe müssen pro Agent geprüft und angepasst werden.

### OpenCode-Testprotokoll als Referenz

1. Arbeitsbaum unverändert übernehmen; nichts resetten oder pauschal wiederherstellen.
2. Next.js lokal starten und OpenCode ausschließlich für den Testprozess mit `JEV_SUMMARY_LEVELS=1` sowie dem bestehenden lokalen `/api/context`-Endpunkt ausführen. Das Flag nicht dauerhaft oder global aktivieren.
3. Zuerst einen kurzen OpenCode-Smoke-Test mit nicht sensiblen Testinhalten durchführen. Bestätigen, dass mindestens ein Summary-Dispatch entsteht, die Message-Sequenz gültig bleibt und Metriken keine Transcript-Inhalte enthalten; die lokalen Summary-Varianten enthalten beabsichtigt Original und Extrakte.
4. Danach drei voneinander unabhängige reale OpenCode-Sessions mit jeweils mindestens 30 Modellnachrichten durchführen:
   - Session A: Codebase- und Refactor-Aufgaben mit einer frühen Canary- und Repository-Regel.
   - Session B: Security- und Konfigurationsaufgaben mit einer frühen Canary und einem bindenden Sicherheitsconstraint.
   - Session C: Test-, Retrieval- und Root-Cause-Aufgaben mit einer frühen Canary und einer später benötigten alten Tool-Information.
5. In jeder Session regelmäßig die frühen Canary-, Sicherheits-, Repository-, offenen Task- und Root-Cause-Fakten abfragen. Antworten und Task-Erfolg ohne geheime Transcript-Inhalte dokumentieren.
6. Separat und kontrolliert folgende Fehlerfälle provozieren: nicht erreichbarer Compiler beziehungsweise Netzwerkfehler, Timeout, ungültiges JSON oder unvollständige Choice-Antwort, Storage-Fehler und inkonsistente Summary-Auswahl. In jedem Fall muss der vollständige ursprüngliche Context versendet werden.
7. Aus den inhaltsfreien Metriken je Session und kumuliert ausweisen:
   - Zahl der Modellnachrichten sowie erfolgreichen Summary-Dispatches und Fallbacks
   - Inputtokens vor und tatsächlich nach der Auswahl
   - mediane Reduktion
   - Selector-Latenz p50 und p95
   - Selector-Kosten, geschätzte Agent-Ersparnis und Nettoeffekt
   - raw und effektive Stufenverteilung
   - Canary-/Must-keep-Treffer, Task-Erfolg und beobachtete Message-/Tool-Fehler
8. Abschließend ein eigenständiges Go/No-Go für Phase 5 treffen und die Messergebnisse direkt in Phase 5 dokumentieren.

### Abnahmekriterien für Phase 5, Punkt 5

Für spätere Agenten dienen diese Kriterien als Mindestvorlage; ein Agent ohne offiziellen sicheren Rewrite-Pfad endet gemäß Phase 7 mit Beobachtung/Handoff und eigenem No-Go statt mit einem erzwungenen Live-Rewrite.

- `100 %` Erhalt aller Canary-, Sicherheits-, Repository-, offenen Task- und Root-Cause-Fakten.
- Keine verwaisten Tool-Calls oder Tool-Results und keine ungültigen Provider-Message-Sequenzen.
- Keine relevante Verschlechterung von Task-Erfolg oder Patch-Qualität gegenüber der binären Policy.
- Bei Netzwerk-, Timeout-, Parser-, Storage- oder Validierungsfehlern immer vollständiger Context.
- Mindestens `40 %` mediane Reduktion der tatsächlich versendeten Inputtokens über die erfolgreichen Summary-Dispatches.
- Positive geschätzte Nettoersparnis nach Selector-Kosten; lokale extraktive Summary-Erzeugung hat weiterhin `0 USD` Providerkosten.
- p95 der Auswahl unter `700 ms`; `< 500 ms` bleibt Stretch-Ziel.
- Mindestens drei unabhängige reale Sessions mit je mindestens 30 Modellnachrichten und dokumentierten Ergebnissen.

### Abschlussentscheidung

- **Go:** Alle Kriterien erfüllen, die Ergebnisse in Phase 5 eintragen und ausschließlich die Checkbox `5. Die Stufen vollständig in realen OpenCode-Sessions testen` auf `[x]` setzen. Das Experimentflag bleibt trotzdem standardmäßig aus, bis eine separate Produktentscheidung es aktiviert.
- **No-Go:** Die Checkbox offen lassen, Summary-Stufen deaktiviert lassen und die verletzten Kriterien mit Messwerten dokumentieren.
- Erst nach einem dokumentierten Go darf Phase 6 beginnen.

Aktueller Beschluss: **Go** für Phase 5, Punkt 5 (Abnahme v7/v8, siehe Phase 5 und Abschnitt 16). Die binäre Policy bleibt Default, bis eine separate Produktentscheidung das Experimentflag aktiviert.

### Arbeitsbaum und Sicherheitsgrenzen

- Der Arbeitsbaum enthält die bisherigen Phasen als vorhandene Änderungen und neue Dateien. Nicht resetten, nicht pauschal wiederherstellen und keine fremden Änderungen überschreiben.
- API-Schlüssel bleiben im Browser beziehungsweise in Umgebungsvariablen und dürfen nie in State, Instructions, Logs, Metriken oder Plan-Ausgaben erscheinen.
- Reale Transcript-Inhalte verlassen über OpenRouter die lokale Vertrauensgrenze. Kostenpflichtige Live-Läufe und Datenübertragung vor dem Start ausdrücklich bestätigen lassen.
- Die binäre Policy bleibt Default und Fallback, bis alle obigen Kriterien erfüllt und in diesem Dokument festgehalten sind.

Für die aktive Arbeit im nächsten Chat gilt Abschnitt 16. Dieses Protokoll bleibt als Referenz für die spätere erneute OpenCode-Abnahme und die getrennten Abnahmen von Claude Code und Codex erhalten.
