# Historie: Phase 0–2

Entwicklungsbasis, Context Lab und Replay-Evaluation mit allen Messwerten. Nur bei Bedarf lesen.

> Teil des aufgeteilten Plans. Index, Status und Leseregeln: [`Plan.md`](../../../Plan.md). Abschnittsnummern (§) entsprechen dem ursprünglichen Gesamtplan.

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
