# Ziel und bestehendes Projekt

Wofür der Context Compiler gebaut wird und wie das Repository aufgebaut ist. Immer lesen.

> Teil des aufgeteilten Plans. Index, Status und Leseregeln: [`Plan.md`](../../Plan.md). Abschnittsnummern (§) entsprechen dem ursprünglichen Gesamtplan.

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
