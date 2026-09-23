# Jev: mentales Modell

Was Jev kann und nicht kann. Lesen, wenn Jev-Fragen, Schwellenwerte oder Primitive betroffen sind.

> Teil des aufgeteilten Plans. Index, Status und Leseregeln: [`Plan.md`](../../Plan.md). Abschnittsnummern (§) entsprechen dem ursprünglichen Gesamtplan.

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
