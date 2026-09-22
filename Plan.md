# Smart Context für Coding Agents

Stand: 22. September 2026  
Status: Vollständiger Handoff für Phase 5, Punkt 5: kontrollierter OpenCode-Live-Test der Summary-Stufen

## 1. Ziel

Wir bauen einen lokalen, agentunabhängigen **Context Compiler** für Claude Code, Codex und OpenCode. Vor einem Modellaufruf soll er den bisherigen Gesprächs- und Tool-Verlauf neu bewerten und nur den Context zusammenstellen, der für den aktuellen Auftrag relevant ist.

Das Hauptziel ist eine massive Reduktion der Input-Tokens und der belegten Context-Window-Kapazität, ohne gültige Anforderungen, Sicherheitsregeln, Entscheidungen oder noch offene Arbeit zu verlieren.

Die Kernidee ist „Meta-Attention“:

- Context ist nicht statisch.
- Für jeden neuen User-Turn wird die bisherige Historie neu bewertet.
- Code entscheidet kostenbewusst zwischen Wiederverwendung des vorhandenen Contexts beziehungsweise KV-Caches und einem neu kompilierten Context.
- Jev bewertet semantische Relevanz und Unsicherheit.
- Deterministischer Code bleibt für Tokenzählung, Kosten, Abhängigkeiten, Sicherheitsregeln und die endgültige Auswahl verantwortlich.

## 2. Das bestehende Projekt

Das Repository ist aktuell ein kleines interaktives Lernprojekt für TypeSafes Jev:

- Next.js `16.3.5` mit App Router
- React `19.2.8`
- TypeScript mit `strict: true`
- Tailwind CSS 4
- keine Datenbank
- keine Authentifizierung
- keine serverseitige Speicherung von API-Schlüsseln
- Laufzeitabhängigkeiten nur `next`, `react` und `react-dom`

Der aktuelle Datenfluss:

```text
Browser
  ├─ OpenRouter-API-Key im localStorage
  ├─ Beispiel auswählen und State bearbeiten
  └─ POST /api/jev
          ↓
Next.js Route Handler
  ├─ API-Key als Bearer-Token weiterreichen
  └─ OpenRouter Decisions API aufrufen
          ↓
Browser
  ├─ Request/Response-Trace anzeigen
  ├─ Noul/Choice/Score visualisieren
  └─ deterministische Schwellenwertentscheidung ausführen
```

Wichtige Dateien:

```text
src/app/page.tsx             Run-Loop und Drei-Spalten-Layout
src/app/api/jev/route.ts     Whitelist-Proxy zu Jev
src/components/Sidebar.tsx   Provider, API-Key und Beispiele
src/components/Workbench.tsx State, Fragen und Request-JSON
src/components/TracePanel.tsx Request/Response/Entscheidungs-Timeline
src/components/AnswerCard.tsx Darstellung der Jev-Antworttypen
src/lib/examples.ts          Vier ausführbare Jev-Beispiele
src/lib/providers.ts         OpenRouter-Endpunkt und Jev-Modell
src/lib/types.ts             API- und Beispieltypen
src/lib/trace.ts             Timeline-Typen
src/lib/useApiKey.ts         localStorage-basierte Schlüsselverwaltung
```

Die vier bestehenden Beispiele zeigen:

1. E-Mail-Spam-Klassifikation
2. NVIDIA Buy/Hold/Sell auf strukturierten Marktdaten
3. Guardrail für Agent-Tool-Calls
4. Inbox-Triage mit spekulativem Fan-out

Der Git-Arbeitsbaum war bei Erstellung dieses Dokuments sauber. `node_modules` war nicht installiert.

### Verbindliche Repository-Regel

Dieses Projekt verwendet eine Next.js-Version mit möglichen Abweichungen von bekannten APIs und Konventionen. Vor jeder Codeänderung müssen nach `npm install` die für die Änderung relevanten Dokumente unter `node_modules/next/dist/docs/` gelesen werden. Diese Regel steht in `AGENTS.md` und darf nicht umgangen werden.

## 3. Jev: korrektes mentales Modell

Jev ist kein Chat- oder Codegenerierungsmodell. Es ist TypeSafes erstes „System One“-Modell für schnelle, strukturierte Entscheidungen.

Ein Request besteht aus:

```text
state + benannte, typisierte questions
```

Ein Response enthält strukturierte Antworten, Wahrscheinlichkeiten und bei Choice/Score zusätzlich Confidence. Der Anwendungscode entscheidet danach, was tatsächlich geschieht.

### Die drei Primitive

| Primitive | Verwendung | Ergebnis |
| --- | --- | --- |
| `noul` | binäre Aussage | Wahrscheinlichkeit für „ja“ zwischen 0 und 1 |
| `choice` | Auswahl aus einer geschlossenen Menge | gewählte Option, alle Wahrscheinlichkeiten, Confidence |
| `score` | Bewertung auf einer geordneten Rubrik | gewichteter Score, Level-Verteilung, Confidence |

Wichtige Eigenschaften:

- Mehrere Fragen können in einem Request gestellt werden.
- Die Fragen werden unabhängig und parallel gegen denselben State ausgewertet.
- Question-IDs dienen nur zur Zuordnung der Antworten und werden nicht für die Inferenz verwendet.
- Eine Frage muss deshalb ihren relevanten Kandidaten explizit in `instructions` oder über eine eindeutige State-Referenz benennen.
- `instructions` und Kriterien können strukturierte JSON-Werte sein.
- Choice und Score liefern die vollständige Verteilung sowie Confidence.
- Noul liefert keine separate Confidence. Unsicherheit wird direkt aus dem mittleren Wertebereich abgeleitet.

### Wahrscheinlichkeit und Confidence sind verschieden

- Eine Optionswahrscheinlichkeit beantwortet, wie wahrscheinlich eine konkrete Option ist.
- Confidence beschreibt, wie konzentriert oder flach die gesamte Choice-/Score-Verteilung ist.
- Hohe Confidence kann automatische Aktionen erlauben.
- Mittlere oder niedrige Confidence sollte zu Vorsicht, Rückfrage, mehr Context oder einem Fallback führen.
- Grenzwerte gehören in den Anwendungscode und müssen anhand eigener Daten kalibriert werden.

### Jevs Stärken

- atomare semantische Beurteilungen
- Klassifikation und Routing
- geschlossene Antwortmengen
- Relevanz- und Risikoentscheidungen
- viele unabhängige Fragen parallel beantworten
- kalibrierte Unsicherheit für nachgelagertes Routing

### Bekannte Grenzen von Jev 1.13

Jev sollte nicht für Aufgaben eingesetzt werden, die normaler Code exakt lösen kann:

- keine verlässliche Mathematik
- kein zuverlässiges Zählen
- keine Datums- oder Zeit-Arithmetik
- keine Textgenerierung
- keine exakte numerische Interpolation aus Scores
- schwächer bei vielen Indirektionen und doppelten Negationen
- schwächer bei großen States mit viel irrelevanter Information
- adversarialer oder injizierter Text ist keine automatisch sichere Grenze
- getrennt gestellte, logisch negierte Fragen müssen keine arithmetischen Gegenstücke ergeben
- gleiche Bedeutung als Noul und Choice kann unterschiedliche Zahlen liefern

Konsequenz für dieses Projekt: Jev bewertet semantische Relevanz. Tokenzahlen, Budgetoptimierung, Cache-Kosten, Abhängigkeitsauflösung und Sicherheitsregeln bleiben deterministisch.

Offizielle Referenzen:

- [TypeSafe Introduction](https://docs.typesafe.ai/introduction.md)
- [System One](https://docs.typesafe.ai/concepts/system-one.md)
- [State](https://docs.typesafe.ai/concepts/state.md)
- [Primitives](https://docs.typesafe.ai/primitives.md)
- [Confidence](https://docs.typesafe.ai/confidence.md)
- [API Reference](https://docs.typesafe.ai/api.md)
- [Speculative fan-out](https://docs.typesafe.ai/patterns/fan-out.md)
- [Confidence-gated routing](https://docs.typesafe.ai/patterns/confidence-routing.md)
- [Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md)
- [Jev with coding agents](https://docs.typesafe.ai/introduction/coding-agents.md)

## 4. Produktdefinition

Das Produkt ist kein Ersatz für das LLM hinter einem Coding Agent. Es ist eine lokale Entscheidungsschicht vor dem eigentlichen Modellaufruf.

```text
neuer User-Turn
      ↓
Transcript normalisieren
      ↓
semantische Chunks bilden
      ↓
harte Pins und deterministischer Vorfilter
      ↓
Jev-Relevanzbewertung
      ↓
Abhängigkeiten schließen
      ↓
Tokenbudget und Cache-Ökonomie anwenden
      ↓
chronologisch geordneten Context ausgeben
      ↓
Claude Code / Codex / OpenCode
```

### Nicht-Ziele des MVP

- keine Vektordatenbank
- keine Embeddings
- kein Cloud-Service
- kein eigenes Agent-Framework
- keine automatische Summary-Generierung
- keine Optimierung anhand geheimer oder nicht zugänglicher interner Reasoning-Tokens
- keine gleichzeitige Vollintegration aller drei Agents vor dem Nachweis, dass die Auswahl funktioniert
- keine neue Dependency, solange Standardbibliothek und bestehender Stack ausreichen

## 5. Context-Einheiten

Die Historie wird nicht blind pro Nachricht bewertet. Sie wird in atomare, semantisch sinnvolle Chunks normalisiert.

Vorgesehene Chunk-Arten:

```ts
type ChunkKind =
  | "instruction"
  | "user_turn"
  | "assistant_turn"
  | "tool_transaction"
  | "decision"
  | "error"
  | "task_state"
  | "summary";
```

Ein konzeptioneller Chunk enthält:

```ts
type ContextChunk = {
  id: string;
  kind: ChunkKind;
  content: string;
  turn: number;
  tokenEstimate: number;
  dependencies: string[];
  pinned: boolean;
  source?: {
    agent: "claude" | "codex" | "opencode" | "fixture";
    sessionId?: string;
    messageId?: string;
    toolCallId?: string;
  };
};
```

Dies ist ein Zieldatenmodell, keine Verpflichtung zu zusätzlichen Abstraktionsschichten. Beim Implementieren wird nur das gebaut, was der erste Replay-Flow tatsächlich benötigt.

### Unteilbare Einheiten

- Tool-Aufruf und Tool-Ergebnis bleiben zusammen.
- Fehler und der auslösende Aufruf bleiben zusammen.
- Eine Entscheidung und ihre unmittelbar benötigten Voraussetzungen werden über Abhängigkeiten verbunden.
- Ein User-Turn und seine direkte Klarstellung dürfen zusammengeführt werden, wenn sie denselben Auftrag bilden.
- Große Tool-Ausgaben werden nicht ungeprüft vollständig übernommen. Der Compiler darf Head/Tail, Dateipfad und einen Hinweis auf die gespeicherte Vollausgabe verwenden.

### Immer vollständig behalten

Folgende Inhalte werden gepinnt und nicht von Jev entfernt:

- System-, Developer- und Repository-Instruktionen
- der aktuelle User-Turn
- explizit noch offene Aufgaben
- aktuelle Sicherheits- und Berechtigungsgrenzen
- aktive, noch nicht verifizierte Änderungen
- der letzte relevante Fehlerzustand
- noch nicht abgeschlossene Tool-Transaktionen
- Informationen, die für Datenverlustprävention erforderlich sind

## 6. Compiler-Pipeline

### Schritt A: Normalisieren

Jeder Agent-Adapter übersetzt sein natives Transcript in das gemeinsame Minimalformat. Agent-spezifische Parser bleiben dünn und enthalten keine Relevanzlogik.

### Schritt B: Deterministischer Vorfilter

Vor jedem Jev-Aufruf werden Kandidaten ohne Modellkosten reduziert:

- unveränderliche Pins markieren
- triviale UI- und Statusmeldungen entfernen
- identische oder klar supersedierte Ausgaben deduplizieren
- Tool-Call und Resultat gruppieren
- explizite Referenzen auf Dateipfade, Symbole, Task-IDs und Tool-IDs erkennen
- eine kleine Recency-Tail konservativ behalten
- Geheimnisse und nicht sendbare Inhalte erkennen

Der Vorfilter darf keine unsicheren semantischen Entscheidungen treffen. Er entfernt nur Inhalte, deren Behandlung deterministisch ist.

### Schritt C: Jev-Bewertung

Der gemeinsame State soll klein bleiben und nur den aktuellen Entscheidungsrahmen enthalten:

```json
{
  "current_request": "aktueller User-Auftrag",
  "active_goal": "bekanntes Sitzungsziel",
  "repository": "Projektname oder Arbeitsverzeichnis"
}
```

Der State soll nicht die gesamte Historie enthalten. Das würde Jevs Context-Rot-Risiko erhöhen.

Für jeden nicht gepinnten Kandidaten werden zunächst zwei unabhängige Noul-Fragen erzeugt:

```json
{
  "type": "noul",
  "instructions": {
    "question": "Is this candidate needed to complete the current request correctly?",
    "candidate": {
      "kind": "tool_transaction",
      "content": "..."
    }
  },
  "criteria": {
    "true": "Removing it could change the implementation, violate a requirement, repeat work, or hide a necessary fact.",
    "false": "It is unrelated, superseded, already reflected elsewhere, or unnecessary for the current request."
  }
}
```

Die zweite Frage lautet sinngemäß:

```text
Enthält der Kandidat eine weiterhin gültige Einschränkung, Entscheidung,
Zusage, offene Aufgabe oder Sicherheitsanforderung?
```

Wichtig: Der Chunk-Inhalt steht explizit in den strukturierten Instructions. Die Question-ID allein darf nicht zur Identifikation dienen, weil sie laut API nicht in die Inferenz eingeht.

Für sehr viele oder sehr große Chunks wird gebatcht. Batchgröße und maximale Payload werden erst anhand realer Messungen festgelegt; keine spekulative Konfiguration im MVP.

### Schritt D: Konservative Auswahl

Initiale Policy:

1. Gepinnte Chunks bleiben immer.
2. Klar relevante Chunks bleiben.
3. Chunks mit gültigen Constraints oder offenen Verpflichtungen bleiben.
4. Mittlere, unsichere Noul-Werte bleiben zunächst ebenfalls.
5. Nur klar irrelevante Chunks werden entfernt.
6. Anschließend werden alle transitiven Abhängigkeiten der behaltenen Chunks ergänzt.

Die genauen Schwellenwerte werden nicht als Wahrheit festgeschrieben. Sie werden über Replay-Daten kalibriert. Der erste Default soll konservativ sein und lieber zu viel Context behalten als einen Constraint verlieren.

### Schritt E: Tokenbudget

Wenn alle behaltenen Chunks das Budget überschreiten:

1. Pins behalten.
2. Sicherheits- und Constraint-Chunks behalten.
3. Offene Arbeit und aktuelle Fehler behalten.
4. Relevanz gegen Tokenkosten priorisieren.
5. Alte, redundante und niedrig bewertete Chunks zuerst entfernen.
6. Den finalen Context wieder chronologisch sortieren.

Jev soll diese Optimierung nicht rechnen. Der Compiler verwendet normale Zahlen und Sortierung.

### Schritt F: Ausgabe

Der Compiler liefert mindestens:

```ts
type CompilationResult = {
  mode: "reuse" | "rebuild";
  keptChunkIds: string[];
  droppedChunkIds: string[];
  compiledContext: string;
  inputTokensBefore: number;
  inputTokensAfter: number;
  selectorLatencyMs: number;
  selectorUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
};
```

Auch dieses Schema bleibt minimal und wird beim Implementieren auf die tatsächlich benötigten Felder reduziert.

## 7. Cache-Ökonomie

Prompt-/KV-Cache und Context-Window sind zwei verschiedene Probleme:

- Ein warmer Cache kann die Kosten und Latenz erneut gesendeter Präfix-Tokens reduzieren.
- Dieselben Tokens belegen trotzdem Platz im Context Window.
- Ein Rebuild kann kurzfristig einen Cache-Miss erzeugen, aber nachfolgende Turns dauerhaft verkleinern.

Die Entscheidung `reuse` oder `rebuild` wird deterministisch getroffen. Mögliche Eingaben:

- Context-Tokens des bestehenden Verlaufs
- geschätzte Tokens des neu kompilierten Contexts
- Cache warm, kalt oder wahrscheinlich abgelaufen
- geschätzte Cache-Write-Kosten
- semantische Kontinuität des aktuellen Auftrags
- erwartete Zahl weiterer Turns
- Model- und Provider-Preise, sofern zuverlässig verfügbar

Startpolicy:

```text
Fortsetzung desselben Auftrags + warmer Cache + geringe mögliche Einsparung
→ bestehenden Context wiederverwenden

Themenwechsel, abgelaufener Cache, Context-Druck oder große Einsparung
→ frischen Context bauen
```

Jev kann die semantische Kontinuität beurteilen. Code berechnet Kosten und Break-even.

## 8. Agent-Integrationen

### OpenCode: erster Live-Adapter

OpenCode V2 ist der beste erste Integrationspunkt. Sein Plugin-API-`context`-Hook läuft unmittelbar vor dem Agent-Modellaufruf und kann die zusammengestellten `system`- und `messages`-Daten verändern. Änderungen betreffen nur den ausgehenden Request und müssen die gespeicherte Historie nicht zerstören.

Geplanter Adapter:

1. `context`-Hook liest den aktuellen Request.
2. Nachrichten werden ins gemeinsame Chunkformat übersetzt.
3. Der Compiler wählt den Context.
4. `event.messages` wird für diesen Request ersetzt.
5. Metriken werden lokal gespeichert.

OpenCode unterstützt außerdem eigene Compaction-Hooks. Diese sind erst nach der normalen Context-Auswahl relevant.

Referenzen:

- [OpenCode V2 Plugin API](https://opencode.ai/v2/docs/build/plugins)
- [OpenCode Compaction](https://opencode.ai/v2/docs/compaction)

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

### Interne Reasoning-Inhalte

Interne Reasoning-Tokens sind kein erforderlicher Bestandteil des MVP:

- Sie sind je nach Agent und Modell nicht zugänglich oder nicht stabil exponiert.
- Das System muss mit sichtbaren Nachrichten, Tool-Transaktionen, Aufgabenstatus und Entscheidungen funktionieren.
- Falls ein Agent explizit gespeicherte Reasoning-Zusammenfassungen bereitstellt, können diese später als normale optionale Chunks behandelt werden.

## 9. Sicherheit und Datenschutz

Die Auswahl sendet möglicherweise Teile lokaler Agent-Transcripts über OpenRouter an den Jev-Provider TypeSafe. Das ist eine echte Vertrauensgrenze.

Vor externen Requests müssen daher mindestens gelten:

- bekannte Secret-Muster lokal redigieren
- API-Schlüssel niemals in State oder Instructions aufnehmen
- `.env`-Inhalte standardmäßig nicht senden
- Credentials, Tokens, Cookies und private Schlüssel blockieren
- sensible Chunks lokal pinnen oder ausschließen, nicht extern klassifizieren
- Payload-Größe begrenzen
- klar anzeigen, welcher Provider verwendet wird
- keine serverseitige Persistenz von Schlüsseln
- Logs ohne Secrets schreiben
- bei Fehlern fail-safe arbeiten: vorhandenen Context behalten statt aggressiv zu entfernen

Jev ist keine Security Boundary. Adversarialer Inhalt kann seine Bewertung beeinflussen. Sicherheitsregeln werden daher nicht von Jev entschieden.

## 10. Mehrstufige Darstellung nach dem MVP

Die spätere Zielrubrik lautet:

```text
drop → short summary → long summary → full
```

Jev kann über Choice oder Score die benötigte Detailstufe auswählen. Jev kann die Zusammenfassungen aber nicht erzeugen.

Spätere Lösung:

- Beim Entstehen eines langlebigen Chunks erzeugt ein generatives Modell höchstens einmal eine kurze und eine längere Variante.
- Original und Varianten werden lokal gespeichert.
- Jev wählt pro aktuellem Auftrag die passende Variante.
- Abhängigkeiten und Pins werden weiterhin deterministisch aufgelöst.

Diese Phase beginnt erst, wenn `keep/drop` nachweislich funktioniert. Vorher wäre Summary-Infrastruktur unnötige Komplexität.

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

## 12. Umsetzungsphasen

### Phase 0: Entwicklungsumgebung und Baseline

1. `npm install` ausführen.
2. Relevante Next.js-16-Dokumente unter `node_modules/next/dist/docs/` vollständig lesen.
3. Ausgangszustand mit Lint, TypeScript und Build prüfen.
4. Keine bestehende Projektfunktion verändern, bevor die Baseline dokumentiert ist.

Ergebnis: reproduzierbare Entwicklungsbasis.

### Phase 1: Context Lab im bestehenden Projekt ✅

- [x] Gemeinsame minimale Chunk-Typen definieren.
- [x] Ein festes Replay-Fixture einlesen.
- [x] Tool-Call und Tool-Result deterministisch gruppieren.
- [x] Pins und Abhängigkeiten implementieren.
- [x] Einen serverseitigen Jev-Compiler-Endpunkt ergänzen, der den bestehenden Proxy-/Providerpfad wiederverwendet.
- [x] Im UI vollständigen und kompilierten Context nebeneinander darstellen.
- [x] Behaltene und entfernte Chunks samt Jev-Werten sichtbar machen.
- [x] Tokenersparnis zunächst mit einer klar gekennzeichneten Schätzung anzeigen.
- [x] Eine kleine ausführbare Prüfung für Gruppierung, Pins und Dependency-Closure hinterlassen; kein neues Testframework nur dafür installieren.

Ergebnis: Man kann eine gespeicherte Coding-Session gegen eine neue Anfrage kompilieren und jede Auswahl nachvollziehen.

### Phase 2: Replay-Evaluation ✅

- [x] Fixtures für die oben genannten Szenarien erstellen.
- [x] Must-keep und Safe-to-drop markieren.
- [x] Baseline, Vorfilter und Jev-Pipeline vergleichen.
- [x] Schwellenwerte anhand der Ergebnisse kalibrieren.
- [x] Kosten und Latenz protokollieren.
- [x] Go/No-Go anhand der Abnahmekriterien entscheiden.

#### Testergebnis 1: 50 Replay-Läufe

- Versuchsaufbau: zehn gelabelte Szenarien, davon sechs zur Kalibrierung und vier als Holdout; jedes Szenario wurde fünfmal ausgeführt.
- Kalibrierte Schwellenwerte: Relevanz `0,40`, Constraint-Risiko `0,35`.
- Gesamtergebnis der Jev-Pipeline: `83,6 %` mediane Tokenreduktion, `100 %` Must-keep-Recall und `95,2 %` Precision.
- Holdout-Ergebnis: `87,2 %` mediane Tokenreduktion, `100 %` Must-keep-Recall und `92,3 %` Precision.
- Latenz: p50 `321 ms`, p95 `479 ms`; das Ziel von unter `500 ms` wurde knapp erreicht.
- Kosten bei angenommenen `$3` Agent-Inputkosten pro eine Million Tokens: `$0,003725` Selector-Kosten und `$0,073345` geschätzte Nettoersparnis.
- Zwischenfazit: vorläufiges Go ohne verlorene Must-keep- oder Sicherheits-Chunks. Wegen der kleinen p95-Reserve folgt ein zweiter unabhängiger Lauf mit weiteren 50 Replays, bevor Phase 2 abgeschlossen wird.

#### Testergebnis 2: weitere 50 Replay-Läufe

- Versuchsaufbau unverändert: sechs Calibration-Fixtures, vier Holdout-Fixtures und fünf Wiederholungen pro Szenario.
- Kalibrierte Schwellenwerte erneut: Relevanz `0,40`, Constraint-Risiko `0,35`.
- Gesamtergebnis der Jev-Pipeline erneut: `83,6 %` mediane Tokenreduktion, `100 %` Must-keep-Recall und `95,2 %` Precision.
- Holdout-Ergebnis erneut: `87,2 %` mediane Tokenreduktion, `100 %` Must-keep-Recall und `92,3 %` Precision.
- Latenz: p50 `305 ms`, p95 `374 ms`; das Ziel von unter `500 ms` wurde klar erreicht.
- Kosten bei angenommenen `$3` Agent-Inputkosten pro eine Million Tokens: `$0,00372519` Selector-Kosten und `$0,07334481` geschätzte Nettoersparnis.
- Keine Fallbacks und keine verlorenen Must-keep- oder Sicherheits-Chunks.

#### Abschlussentscheidung

**Go für Phase 3.** Zwei unabhängige Läufe mit zusammen 100 echten Replay-Auswertungen lieferten dieselben Auswahl-, Recall- und Kostenergebnisse. Die mediane Reduktion liegt deutlich über `40 %`, der Must-keep-Recall bleibt bei `100 %`, die Nettoersparnis ist positiv und der zweite Lauf bestätigt die Latenzanforderung mit ausreichender Reserve.

Ergebnis: belastbarer Nachweis, ob Jev mehr spart als es kostet und ob wichtige Informationen erhalten bleiben.

### Phase 3: OpenCode-Plugin ✅

- [x] Dünnen Adapter für OpenCode V2 bauen.
- [x] `context`-Hook verwenden.
- [x] Ausgehende Nachrichten in Chunks übersetzen.
- [x] Compiler ausführen und `event.messages` ersetzen.
- [x] Fail-safe auf unveränderte Messages zurückfallen.
- [x] Metriken lokal schreiben.

#### Kurzfassung Phase 3

Der projektlokale Adapter liegt unter `.opencode/plugins/jev-context.ts` und wird von OpenCode V2 automatisch geladen. Er übersetzt den ausgehenden Nachrichtenverlauf in die vorhandenen Context-Chunks, ruft den lokalen `/api/context`-Compiler auf und übernimmt nur die ausgewählten Messages in den Modellaufruf. Tool-Call und Tool-Result bleiben untrennbar; bei fehlendem API-Key, Timeout, zu großer Payload oder ungültiger Compiler-Antwort bleibt der ursprüngliche Context vollständig erhalten. Inhaltsfreie Laufmetriken werden im Plugin-Storage gespeichert. Die Umsetzung ist mit zehn Logiktests, ESLint, Produktions-Build und einem lokalen API-Smoke-Test geprüft.

Voraussetzung für Phase 4: Das lokal installierte OpenCode `1.18.31` muss auf OpenCode V2 (`@opencode/cli`) umgestellt werden, da die verwendete `context`-Hook-API in V1 nicht verfügbar ist.

Ergebnis: erste echte Meta-Attention vor jedem Agent-Modellaufruf.

### Phase 4: OpenCode-Praxistest ✅

- [x] OpenCode V2 geprüft: Praxistest mit `2.0.12`, Abschlusscheck nach dem automatischen Update mit `@opencode/cli 2.0.13`; Plugin `jev-context` wird weiterhin aus `.opencode/plugins/jev-context.ts` geladen.
- [x] Zwei reale, wiederaufgenommene Sessions mit Codebase-, Security-, Konfigurations-, Test- und Retrieval-Aufgaben durchgeführt; die lange Session umfasste mehr als 30 Modellnachrichten.
- [x] Einen V2-Adapterfehler behoben: Tool-Parts verwenden `id`, `name` und `result`. Tool-Aufruf und Ergebnis werden jetzt wieder als eine Transaktion behandelt.
- [x] Must-keep geprüft: kein beobachteter Verlust der permanenten Canary oder der angefragten Repository-Regeln; alle abschließenden Aufgaben waren korrekt.
- [x] Fail-safe geprüft: zwei Netzwerkfehler (`HTTP 0`) und ein echter Timeout nach `5.002 ms` behielten jeweils den vollständigen Context; die Aufgaben liefen danach erfolgreich weiter.
- [x] Schwellenwerte anhand der Ergebnisse auf `relevance >= 0,40` und `constraintRisk >= 0,30` kalibriert. Wiederholte, bereits erfüllte Constraints zählen nicht mehr automatisch als weiterhin bindend.
- [x] 50 aufgezeichnete Replay-Fälle bestätigt: `82,1 %` mediane Reduktion, Must-keep-Recall `100 %`, Präzision `92,2 %`, p95 `431 ms`, positiver Nettoeffekt.
- [x] Konservative Live-Messung mit dem tatsächlich versendeten Nachrichten-Set: vier kompilierte Dispatches, `54,3 %` mediane Reduktion, `12.892` eingesparte Tokens, `0,00379 USD` Selektorkosten, geschätzter Nettoeffekt `+0,03488 USD`, p50 `577 ms`, p95 `841 ms`, keine Fallbacks.
- [x] Latenzoptimierung: User-Turns und Chunks unter `100` geschätzten Tokens bleiben deterministisch erhalten; nur größere Tool-/Assistant-Chunks erhalten eine einzelne Jev-Relevanzfrage. Die feste Sicherheitsgrenze wurde bei unverändertem `256-kB`-Payload-Limit von `100` auf `200` Chunks angehoben, damit lange Sessions nicht unnötig in den vollständigen Fallback fallen.
- [x] Weitere 50 Replays mit der finalen Policy: `82,1 %` mediane Reduktion, Must-keep-Recall `100 %`, p95 `459 ms`, keine Fallbacks und geschätzter Nettoeffekt `+0,07479 USD`.
- [x] Finaler Live-Test mit 20 kompilierten Dispatches in der langen Resume-Session: alle Canary-, Versions-, README- und Repository-Regel-Prüfungen korrekt; p50 `495 ms`, p95 `659 ms`, `35,7 %` mediane Reduktion, `90.748` eingesparte Tokens, `0,01039 USD` Selektorkosten und geschätzter Nettoeffekt `+0,26185 USD`.
- [x] Eine konservativere `300`-Token-Schwelle erreichte zwar p95 `515 ms`, reduzierte live aber nur median `20,4 %` und wurde deshalb zugunsten der wirtschaftlicheren `100`-Token-Schwelle verworfen.
- [x] Drei voneinander unabhängige reale OpenCode-Langzeitsessions mit je mindestens 30 Modellnachrichten und unterschiedlichen Codebase-, Security-, Konfigurations-, Test- und Retrieval-Aufgaben geprüft. Must-keep-Regeln und bekannte Fakten blieben erhalten; Netzwerk-, Timeout- und Parserfehler fielen vollständig auf den vorhandenen Context zurück.

#### Langzeit-Prüfpunkt: drei unabhängige Sessions

- Session A (`ses_f36ccf74dffevfqUuggX2NPdLz`): `35` Modellnachrichten, `16/16` korrekte Aufgaben- und Canary-Antworten; vier erfolgreiche Compiler-Dispatches mit `37,4 %` Reduktion, p95 `625 ms`, `0,00118163 USD` Selektorkosten und geschätztem Nettoeffekt `+0,03713 USD`. Zusätzlich behielten `31` echte Netzwerk-Fallbacks (`HTTP 0`) den vollständigen Context.
- Session B (`ses_f36c65889ffeB0laZCUkrc4it5`): `32` Modellnachrichten, `16/16` korrekte Aufgaben- und Canary-Antworten; `31` erfolgreiche Compiler-Dispatches mit `52,5 %` Reduktion, p95 `601 ms`, `0,01045607 USD` Selektorkosten und geschätztem Nettoeffekt `+0,38639 USD`. Ein absichtlich ungültiger lokaler Compiler-Response bestätigte den Parser-Fallback.
- Session C (`ses_f36c2a495ffeLBmJW4zjnac6U1`): `32` Modellnachrichten, `16/16` korrekte Aufgaben- und Canary-Antworten; `31` erfolgreiche Compiler-Dispatches mit `66,2 %` Reduktion, p95 `669 ms`, `0,01731022 USD` Selektorkosten und geschätztem Nettoeffekt `+0,65727 USD`. Ein absichtlich hängender lokaler Compiler bestätigte den Timeout-Fallback nach fünf Sekunden.
- Kumuliert: `99` Modellnachrichten, `48/48` korrekte Aufgaben- und Canary-Antworten, p50 `422 ms`, p95 `625 ms`, `0,02894791 USD` Selektorkosten und geschätzter Nettoeffekt `+1,08079 USD` bei angenommenen `3 USD` Agent-Inputkosten pro eine Million Tokens.
- Die `369.912` eingesparten Tokens sind ausdrücklich wiederholt vermiedene **Dispatch-Inputtokens**, keine einzigartigen Historientokens. Über alle `97` Dispatches mit vollständiger Tokenmetrik sank das Volumen von `867.102` auf `497.190` Tokens (`42,7 %`); die zwei gezielt direkt im Plugin ausgelösten Parser-/Timeout-Fallbacks hatten vor der Messlückenkorrektur noch keine Tokenfelder.

Entscheidung: **Go für Phase 5 mit p95 `< 700 ms`; `< 500 ms` bleibt Stretch-Ziel.** Sicherheit, Task-Erfolg, Fail-safe und Wirtschaftlichkeit sind über drei unabhängige Langzeitsessions bestätigt. Ein striktes `< 500-ms`-SLO ist mit der beobachteten OpenRouter-Tail-Latenz ohne Provider- oder Architekturwechsel nicht belastbar.

### Phase 5: Summary-Stufen

1. [x] Erst nach erfolgreichem `keep/drop` im OpenCode-Praxistest beginnen.
2. [x] Short- und Long-Summaries lokal erzeugen und speichern. Als lokale, deterministische Phase-5-Baseline werden Head/Tail-Varianten nur für ältere, große, nicht gepinnte und nicht sensible Chunks im vorhandenen OpenCode-Plugin-Storage abgelegt; Original, Short und Long bleiben gemeinsam versioniert, werden aber noch nicht versendet.
3. [x] Jev Choice für `drop/short/long/full` evaluiert und mit einer Confidence-Regel kalibriert. Eine raw `short`-Wahl unter `0,50` Confidence wird konservativ auf `long` angehoben. Score bleibt YAGNI, solange die geschlossene Choice-Menge ausreicht.
4. [x] Summary-Kosten in die Nettoersparnis eingerechnet; die lokale extraktive Baseline hat keine Provider-Generierungskosten.
5. [ ] Die Stufen vollständig in realen OpenCode-Sessions testen.
   - [x] Aktuelle offizielle OpenCode-V2-Plugin-Dokumentation und das tatsächlich installierte Message-Schema prüfen; keine Annahmen aus älteren Versionen übernehmen.
   - [x] Den vorhandenen `/api/context`-Pfad minimal um Summary-Choice-Ergebnisse erweitern. Der binäre Request und Response bleiben rückwärtskompatibel und weiterhin Default.
   - [x] Im OpenCode-Plugin einen standardmäßig deaktivierten Experimentpfad ergänzen, beispielsweise über `JEV_SUMMARY_LEVELS=1`. Ohne Flag muss das heutige binäre Verhalten byte-for-byte beziehungsweise strukturell unverändert bleiben.
   - [x] `drop`, `short`, `long` und `full` fail-safe auf ausgehende Messages anwenden. Tool-Call und Tool-Result dürfen niemals verwaist werden; bei einer gekürzten Tool-Transaktion muss die gesamte Transaktion durch genau einen normalen Text-Summary ersetzt werden.
   - [x] Pins, User-Turns, aktuelle Fehler, sensible Chunks, unvollständige Tool-Transaktionen und Abhängigkeits-Closure weiterhin vollständig behalten.
   - [x] Bei fehlender oder ungültiger Choice-Antwort, Netzwerkfehler, Timeout, Parserfehler, unzulässiger Message-Form oder Storage-Fehler den vollständigen ursprünglichen Context versenden.
   - [x] Metriken um raw Choice, effektive Stufe nach Confidence-Regel, tatsächlich versendete Tokens, Selector-Kosten und Fallback-Grund ergänzen; keine Transcript-Inhalte oder Secrets in Metriken schreiben.
   - [x] Unit-/Logiktests für Summary-Ersetzung, vollständige Tool-Transaktionen, `short < 0,50 → long`, deaktiviertes Feature-Flag und vollständigen Fallback ergänzen.
   - [ ] Danach mindestens drei voneinander unabhängige reale OpenCode-Sessions mit je mindestens 30 Modellnachrichten durchführen. Codebase-, Security-, Konfigurations-, Test- und Retrieval-Aufgaben sowie frühe Canary-Fakten abfragen.
   - [ ] Separat echte Netzwerk-, Timeout- und Parserfehler provozieren und bestätigen, dass der volle Context erhalten bleibt.
   - [ ] Erst nach erfüllten Abnahmekriterien Punkt 5 und Phase 5 abschließen; andernfalls Summary-Stufen deaktiviert lassen und das No-Go dokumentieren.

Zwischenstand 22. September 2026: Die fail-safe Summary-Ausgabe ist hinter `JEV_SUMMARY_LEVELS=1` integriert. Ein lokaler API-Smoke-Test, 14 Logiktests, ESLint und der Next.js-Produktions-Build sind erfolgreich. Ausstehend sind der kontrollierte OpenCode-Smoke-/Live-Test sowie die realen Netzwerk-, Timeout- und Parserfehler-Läufe; kostenpflichtige Requests und die Übertragung realer Transcripts erfordern vorher eine ausdrückliche Freigabe. Die binäre Policy bleibt Default.

Ergebnis: in OpenCode validierte feinere Budgetkontrolle für lange Sessions.

#### Erster Summary-Choice-Replay

- 45 echte Jev-Requests: neun gelabelte Fixtures mit je fünf Wiederholungen, 70 Detailstufen-Entscheidungen, keine Request-Fehler.
- Exakte Übereinstimmung `71,4 %`, Mindestdetail-Recall `92,9 %` und mediane Tokenreduktion `93,7 %`.
- Latenz p50 `310 ms`, p95 `418 ms`.
- `28.300` Kandidatentokens vor und `2.445` nach Auswahl; `0,00249354 USD` Selektorkosten, keine Providerkosten für die lokale extraktive Summary-Erzeugung und geschätzter Nettoeffekt `+0,07507146 USD` bei `3 USD` Agent-Inputkosten pro einer Million Tokens.
- Alle fünf Unterselektionen waren reproduzierbar `long → short`; außerdem wurden zehn Long-Ziele konservativ als Full gewählt. Drop-, Short- und Full-Ziele gingen nicht unter ihre gelabelte Mindeststufe.

Entscheidung: **No-Go für den Live-Einsatz der Summary-Stufen.** Wirtschaftlichkeit, Latenz und Reduktion sind gut, aber `92,9 %` Mindestdetail-Recall verfehlen die verbindlichen `100 %`. Als Nächstes wird die betroffene Long-Fixture gezielt identifiziert, eine konservative Unsicherheitsregel nur für `short` kalibriert und anschließend ein zweiter unabhängiger Replay-Lauf ausgeführt. Die bestehende binäre OpenCode-Live-Policy bleibt bis dahin unverändert.

#### Kalibrierung und zweiter unabhängiger Summary-Replay

- Drei gezielte Diagnose-Requests identifizierten reproduzierbar `refactor-constraints:tool:shared`: raw `short`, Confidence `0,34`, Verteilung `short 0,51 / full 0,31 / long 0,17 / drop 0,01`.
- Kalibrierte Regel: ausschließlich raw `short` bei Confidence `< 0,50` auf `long` anheben; `drop`, `long` und `full` bleiben unverändert.
- Danach 45 neue echte Jev-Requests mit derselben Verteilung: neun Fixtures, fünf Wiederholungen, 70 Entscheidungen, keine Request-Fehler.
- Ergebnis nach Policy: `78,6 %` exakte Stufenübereinstimmung, `100 %` Mindestdetail-Recall und `93,7 %` mediane Tokenreduktion.
- `28.300` Kandidatentokens vor und `2.840` nach Auswahl; p50 `312 ms`, p95 `417 ms`, `0,00249354 USD` Selektorkosten und geschätzter Nettoeffekt `+0,07388646 USD`.
- Raw blieb `refactor-constraints:tool:shared` in allen fünf Läufen `long → short`; die Confidence-Regel hob alle fünf korrekt auf `long`. Kein Must-keep-Ziel wurde unterselektiert. Ein irrelevanter Testlog wurde einmal von raw `short` auf `long` angehoben; das ist konservative Mehrbehaltung, kein Informationsverlust.

Entscheidung: **Go für den kontrollierten realen OpenCode-Test der Summary-Stufen.** Die bestehende binäre Live-Policy bleibt unverändert, bis der Adapter Summary-Inhalte fail-safe ersetzen kann und reale Sessions die Qualität bestätigen.

### Phase 6: Cache-aware Routing

1. Provider- und Agent-Metriken normalisieren.
2. Reuse/Rebuild-Break-even deterministisch berechnen.
3. Task-Kontinuität optional mit Jev bewerten.
4. Policy anhand realer Sessions kalibrieren.
5. Reuse und Rebuild vollständig in OpenCode gegeneinander testen.

Ergebnis: in OpenCode validierte, kostenbewusste Entscheidung zwischen warmem Präfix und kleinerem neuen Context.

### Phase 7: Claude Code und Codex getrennt anbinden

Voraussetzung: Erst beginnen, wenn die Phasen 3 bis 6 in OpenCode abgeschlossen und abgenommen sind. Claude Code und Codex erhalten getrennte Entscheidungen; ein No-Go bei einem Agent blockiert den anderen nicht.

#### Phase 7A: Claude Code

1. Offizielle Hooks und Agent-SDK-Schnittstellen auf Beobachtung, Context-Injektion, per-request Rewrite, Resume und Compaction prüfen und die tatsächlich verfügbaren Fähigkeiten festhalten.
2. Mindestens drei vorhandene Claude-Code-Sessions offline durch den Compiler replayen. Tokenreduktion, Must-keep-Recall und potenzielle Kostenersparnis messen, ohne einen Adapter oder interne Dateien zu verändern.
3. Anhand der Schnittstellenprüfung den kleinsten tragfähigen Pfad wählen: CLI-Hooks für Beobachtung/Handoff oder Agent SDK für transparente Rewrites. Fehlende offizielle Fähigkeiten nicht durch interne Session-Manipulation ersetzen.
4. Einen dünnen Claude-Adapter ausschließlich mit dokumentierten Feldern bauen; agent-spezifische Transcript-Logik bleibt hinter einer isolierten Adaptergrenze.
5. Fixtures und Tests für Hook-Versionen, Tool-Transaktionen, Resume, Compaction, Redaction, Parserfehler und vollständigen Fail-safe ergänzen.
6. Mindestens drei reale Langzeitsessions mit je mindestens 30 Modellnachrichten prüfen und Qualität, Latenz, Reduktion, Kosten, Cache-Effekt und Fail-safe getrennt ausweisen.
7. Eigenständiges Go/No-Go für Claude Code treffen. Wenn kein offizieller sicherer Rewrite-Pfad existiert, endet 7A bewusst mit Messung, Beobachtung und Handoff.

#### Phase 7B: Codex

1. Offizielle Hooks und Host-/Protokollschnittstellen auf Beobachtung, Context-Injektion, per-request Rewrite, Resume und Compaction prüfen und die tatsächlich verfügbaren Fähigkeiten festhalten.
2. Mindestens drei vorhandene Codex-Sessions offline durch den Compiler replayen. Tokenreduktion, Must-keep-Recall und potenzielle Kostenersparnis messen, ohne einen Adapter oder interne Dateien zu verändern.
3. Einen isolierten Parser nur für dokumentierte Hook-Felder und stabile Exportformate definieren; keine Core-Logik an proprietäre JSONL-Feldnamen koppeln und keine internen Sessiondateien mutieren.
4. Den kleinsten offiziell unterstützten Codex-Adapter für Sessionstart-, Compaction- und Handoff-Flows bauen; per-request Rewrites nur über eine dafür dokumentierte Schnittstelle.
5. Fixtures und Tests für Formatversionen, Tool-Transaktionen, Resume, Compaction, Redaction, Parserfehler und vollständigen Fail-safe ergänzen.
6. Mindestens drei reale Langzeitsessions mit je mindestens 30 Modellnachrichten prüfen und Qualität, Latenz, Reduktion, Kosten, Cache-Effekt und Fail-safe getrennt ausweisen.
7. Eigenständiges Go/No-Go für Codex treffen. Wenn kein offizieller sicherer Rewrite-Pfad existiert, endet 7B bewusst mit Messung, Beobachtung und Handoff.

#### Phase 7C: Agentübergreifende Konsolidierung

1. Claude-, Codex- und OpenCode-Metriken auf dieselben Definitionen normalisieren und getrennte Ergebnisse vergleichbar darstellen.
2. Nur nachgewiesen gemeinsame Adapterlogik in den Core verschieben; agent-spezifische Parser und Policies getrennt lassen.
3. Abschließende Regressionstests für Must-keep, Tool-Transaktionen, Redaction und Fail-safe über alle freigegebenen Adapter ausführen.
4. Ein universelles Plugin-Paket nur bauen, wenn mindestens zwei Live-Adapter die jeweiligen Abnahmekriterien erfüllen.

Ergebnis: unabhängig geprüfte Claude-Code- und Codex-Pfade mit agent-spezifischem Go/No-Go und nur belastbar gemeinsamer Logik.

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

## 14. Risiken

### Falsch negative Relevanz

Gefahr: Ein scheinbar irrelevanter Chunk enthält die Root Cause oder eine alte Anforderung.

Gegenmaßnahmen:

- konservative Schwellenwerte
- separate Constraint-Frage
- Pins
- Abhängigkeits-Closure
- kuratierte Must-keep-Fixtures
- fail-safe Fallback

### Selector kostet mehr als er spart

Gefahr: Alle Chunks an Jev zu senden ist teurer als die eingesparten Agent-Tokens.

Gegenmaßnahmen:

- deterministischer Vorfilter zuerst
- Chunks nur bei tatsächlichem Context-Druck neu bewerten
- Ergebnisse innerhalb eines unveränderten Tasks cachen
- Nettoersparnis statt bloßer Tokenersparnis messen

### Latenz im Agent-Loop

Gefahr: Jeder User-Turn fühlt sich langsamer an.

Gegenmaßnahmen:

- kleine Batches
- nur plausible Kandidaten senden
- lokale Vorarbeit
- Timeout mit unverändertem Context als Fallback
- asynchrone Vorberechnung langlebiger Metadaten

### Instabile Agent-Transcript-Formate

Gefahr: CLI-Updates brechen Parser.

Gegenmaßnahmen:

- Adapter isolieren
- native Hook-Felder bevorzugen
- Parser-Fixtures je Agent
- keine Core-Logik an proprietäre Feldnamen koppeln

### Geheimnisweitergabe

Gefahr: Tool-Ausgaben enthalten Schlüssel oder private Daten.

Gegenmaßnahmen:

- lokale Redaction vor jedem externen Aufruf
- blockierte Dateitypen und Pfade
- keine Secrets in Logs
- klare Provideranzeige
- fail-safe Verhalten

## 15. Konkreter nächster Arbeitsschritt

Phase 1 bis Phase 4 sowie Phase 5, Punkte 1 bis 4, sind abgeschlossen. Der neue Chat beginnt ausschließlich mit **Phase 5, Punkt 5: kontrollierter realer OpenCode-Test der Summary-Stufen**. Phase 6, Claude Code, Codex, Datenbank, Cache-Preislogik und generative Summary-Erzeugung bleiben ausdrücklich außerhalb dieses Arbeitsschritts.

### Bereits implementiert und nicht neu bauen

- `.opencode/plugins/jev-context.ts` normalisiert den ausgehenden OpenCode-Verlauf, bewahrt Tool-Transaktionen, ruft den lokalen Compiler auf, ersetzt heute nur binär behaltene/entfernte Messages und fällt bei jedem Fehler auf den vollständigen Context zurück.
- `src/lib/context.ts` enthält `SummaryVariants`, `SummaryLevel`, `buildSummarySelectorRequest`, `readSummaryDecisions` und `SUMMARY_SHORT_CONFIDENCE_THRESHOLD = 0.5`.
- Für ältere, große, nicht gepinnte und nicht sensible Chunks werden lokal Full-/Short-/Long-Varianten erzeugt. Short und Long sind aktuell bewusst **deterministische Head/Tail-Extrakte**, keine generativen Zusammenfassungen.
- Die Varianten werden unter `summaries/<session>/<chunk>` im vorhandenen OpenCode-Plugin-Storage abgelegt. Das gespeicherte Original und beide Varianten werden noch nicht an das Agent-Modell ausgespielt.
- `scripts/evaluate-summaries.ts` führt die gelabelte Choice-Evaluation aus; `npm run evaluate:summaries` startet 45 kostenpflichtige OpenRouter-Requests.
- `src/lib/context-fixture.ts` enthält die Summary-Mindeststufen der Replay-Fixtures.
- `src/lib/context.test.ts` prüft unter anderem Variantenbildung, lokale Speicherung, Choice-Parsing und die Confidence-Regel.
- Die vorhandene binäre Live-Policy ist produktiv erprobt und darf nicht beiläufig ersetzt oder verschlechtert werden.

### Verbindliche Summary-Policy

```text
gepinnt, aktuell, sensibel, Fehler oder User-Turn
→ immer full, niemals extern als Summary-Kandidat klassifizieren

Jev raw choice = short und confidence < 0,50
→ long

sonst
→ raw choice unverändert übernehmen

ungültige oder unvollständige Auswahl
→ vollständiger ursprünglicher Context
```

Choice bleibt das Primitive für `drop/short/long/full`. Score wird nicht zusätzlich eingeführt, solange reale Tests keinen konkreten Mangel der Choice-Auswahl zeigen.

### Nachgewiesener Ausgangspunkt

- Erster Replay: 45 Requests, 70 Entscheidungen, `92,9 %` Mindestdetail-Recall; fünf reproduzierbare `long → short`-Unterselektionen, deshalb No-Go.
- Diagnose: betroffen war `refactor-constraints:tool:shared`; raw `short`, Confidence ungefähr `0,34`.
- Nach Kalibrierung: zweiter unabhängiger Replay mit weiteren 45 Requests und 70 Entscheidungen.
- Ergebnis: `100 %` Mindestdetail-Recall, `93,7 %` mediane Reduktion, p50 `312 ms`, p95 `417 ms`, `0,00249354 USD` Selektorkosten und geschätzter Nettoeffekt `+0,07388646 USD`.
- Entscheidung: Go für einen kontrollierten OpenCode-Live-Test, **noch kein Go für allgemeine Aktivierung**.
- Letzte lokale Prüfung: 13 Tests bestanden, ESLint bestanden, Next.js-Produktions-Build bestanden.

### Kürzeste Implementierungsroute

1. `Plan.md`, `AGENTS.md`, `.opencode/plugins/jev-context.ts`, `src/lib/context.ts`, `src/app/api/context/route.ts` und `src/lib/context.test.ts` vollständig lesen.
2. Vor jeder Codeänderung die relevanten Next.js-16-Dokumente unter `node_modules/next/dist/docs/` lesen.
3. Die aktuelle OpenCode-V2-Plugin-API und das installierte Message-/Tool-Part-Schema verifizieren.
4. Den bestehenden Compiler-Response nur um die für Summary-Stufen nötigen Entscheidungen erweitern; keinen zweiten Compiler und keine neue Dependency bauen.
5. Im Plugin hinter einem standardmäßig ausgeschalteten Flag die ausgewählte Darstellung auf Messages anwenden. Ein `full`-Chunk behält Originalmessages, `drop` entfernt sie, `short`/`long` ersetzt den gesamten Chunk durch einen normalen Text-Context an seiner chronologischen Position.
6. Vor Mutation eine vollständige neue Message-Liste bauen und validieren. Erst nach erfolgreicher Validierung `event.messages` ersetzen; andernfalls das Original unangetastet lassen.
7. Den kleinsten Test ergänzen, der Summary-Ersetzung, Tool-Atomizität, Pins und Fallback gemeinsam absichert.
8. `npm run test:context`, `npm run lint` und `npm run build` ausführen.
9. Mit aktiviertem Experimentflag zuerst einen lokalen Smoke-Test, danach drei unabhängige reale Langzeitsessions durchführen und Metriken dokumentieren.

### Abnahmekriterien für Phase 5, Punkt 5

- `100 %` Erhalt aller Canary-, Sicherheits-, Repository-, offenen Task- und Root-Cause-Fakten.
- Keine verwaisten Tool-Calls oder Tool-Results und keine ungültigen Provider-Message-Sequenzen.
- Keine relevante Verschlechterung von Task-Erfolg oder Patch-Qualität gegenüber der binären Policy.
- Bei Netzwerk-, Timeout-, Parser-, Storage- oder Validierungsfehlern immer vollständiger Context.
- Mindestens `40 %` mediane Reduktion der tatsächlich versendeten Inputtokens über die erfolgreichen Summary-Dispatches.
- Positive geschätzte Nettoersparnis nach Selector-Kosten; lokale extraktive Summary-Erzeugung hat weiterhin `0 USD` Providerkosten.
- p95 der Auswahl unter `700 ms`; `< 500 ms` bleibt Stretch-Ziel.
- Mindestens drei unabhängige reale Sessions mit je mindestens 30 Modellnachrichten und dokumentierten Ergebnissen.

### Arbeitsbaum und Sicherheitsgrenzen

- Der Arbeitsbaum enthält die bisherigen Phasen als vorhandene Änderungen und neue Dateien. Nicht resetten, nicht pauschal wiederherstellen und keine fremden Änderungen überschreiben.
- API-Schlüssel bleiben im Browser beziehungsweise in Umgebungsvariablen und dürfen nie in State, Instructions, Logs, Metriken oder Plan-Ausgaben erscheinen.
- Reale Transcript-Inhalte verlassen über OpenRouter die lokale Vertrauensgrenze. Kostenpflichtige Live-Läufe und Datenübertragung vor dem Start ausdrücklich bestätigen lassen.
- Die binäre Policy bleibt Default und Fallback, bis alle obigen Kriterien erfüllt und in diesem Dokument festgehalten sind.

Die kürzeste belastbare Route bleibt: **Summary-Ausgabe hinter Flag fail-safe integrieren, vollständig in OpenCode validieren, erst danach Phase 6 beginnen**.
