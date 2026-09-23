# Architektur des Context Compilers

Produktdefinition, Chunk-Modell, Pipeline A–F, Cache-Ökonomie, Reasoning-Inhalte und mehrstufige Darstellung. Immer lesen.

> Teil des aufgeteilten Plans. Index, Status und Leseregeln: [`Plan.md`](../../Plan.md). Abschnittsnummern (§) entsprechen dem ursprünglichen Gesamtplan.

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

### Interne Reasoning-Inhalte

Interne Reasoning-Tokens sind kein erforderlicher Bestandteil des MVP:

- Sie sind je nach Agent und Modell nicht zugänglich oder nicht stabil exponiert.
- Das System muss mit sichtbaren Nachrichten, Tool-Transaktionen, Aufgabenstatus und Entscheidungen funktionieren.
- Falls ein Agent explizit gespeicherte Reasoning-Zusammenfassungen bereitstellt, können diese später als normale optionale Chunks behandelt werden.

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
