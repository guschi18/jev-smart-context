# Agent: OpenCode

OpenCode-V2-Adapter, abgeschlossene Phasen 3–6 und die implementierte Summary-Baseline. Lesen für jede OpenCode-Arbeit.

> Teil des aufgeteilten Plans. Index, Status und Leseregeln: [`Plan.md`](../../../Plan.md). Abschnittsnummern (§) entsprechen dem ursprünglichen Gesamtplan.

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

### OpenCode-Baseline: bereits implementiert

- `.opencode/plugins/jev-context.ts` aktiviert Summary-Stufen ausschließlich mit `JEV_SUMMARY_LEVELS=1`. Ohne Flag bleibt der bestehende binäre Request- und Dispatch-Pfad unverändert.
- `src/app/api/context/route.ts` akzeptiert optional `summaryLevels: true` und liefert dann validierte `summaryDecisions`; der binäre Request und Response bleiben rückwärtskompatibel und Default.
- `src/lib/context.ts` enthält neben Variantenbildung und Choice-Parsing jetzt `compileSummarySelection`. Die Abhängigkeits-Closure wird weiterhin vollständig behalten.
- `drop` entfernt einen Chunk, `full` behält die Originalmessages und `short` beziehungsweise `long` ersetzt den gesamten Chunk durch genau eine normale Assistant-Textmessage an seiner chronologischen Position.
- Teilen sich mehrere Chunks eine physische Message oder Tool-Transaktion, gewinnt konservativ `full`, sobald ein beteiligter Chunk vollständig benötigt wird. Tool-Call und Tool-Result können dadurch nicht verwaisen.
- Gepinnte, aktuelle, sensible und fehlerhafte Chunks, User-Turns sowie unvollständige Tool-Transaktionen bleiben vollständig und werden nicht extern als Summary-Kandidaten klassifiziert.
- Fehlende, doppelte, unvollständige oder ungültige Choice-Ergebnisse, unzulässige Level, Storage-Fehler und jede inkonsistente Message-/Tool-Struktur führen vor der Mutation zum vollständigen Originalcontext.
- Metriken enthalten keine Transcript-Inhalte, sondern nur Chunk-Art, Tokenzahl, raw Choice, effektive und tatsächlich angewandte Stufe, Confidence, Wahrscheinlichkeiten, Selector-Kosten, Latenz und Fallback-Grund.
- Short und Long bleiben bewusst lokale deterministische Head-/Tail-Extrakte mit `0 USD` Generierungskosten. Generative Summaries bleiben außerhalb des Scopes.
- Die offizielle OpenCode-V2-Plugin-API und das installierte `@opencode/cli 2.0.13`-Schema wurden geprüft.
- Lokaler Stand: `14/14` Context-Tests bestanden, ESLint bestanden, Next.js-Produktions-Build bestanden und `/api/context` im Summary-Modus mit einem lokalen Smoke-Test geprüft.

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

### Phase 6: Cache-aware Routing

Status: **abgeschlossen** (24. September 2026). Schritte 1–5 am 23. September 2026 durchgeführt. Entscheidung: **No-Go** (v3: Pressure-Kriterium; Turn-Policy-Retest: Must-keep, siehe „Folgearbeit“); am 24. September 2026 **Go für die Turn-Policy mit Platzhaltern** (Must-keep 100 %, D2 −41 % glm / −19 % luna). Flag bleibt aus. Checkliste:

- [x] 1. Provider- und Agent-Metriken normalisieren.
- [x] 2. Reuse/Rebuild-Break-even deterministisch berechnen.
- [x] 3. Task-Kontinuität optional mit Jev bewerten.
- [x] 4. Policy anhand realer Sessions kalibrieren.
- [x] 5. Reuse und Rebuild vollständig in OpenCode gegeneinander testen.

Ergebnis: in OpenCode validierte, kostenbewusste Entscheidung zwischen warmem Präfix und kleinerem neuen Context.

#### Ergebnisse Schritte 1–4 (lokal)

**Schritt 1:** `src/lib/cache-routing.ts` enthält `ModelPricing`/`readPricing` (fehlender `cacheWritePerM` → Inputpreis), `normalizeUsage` (V2-Form `tokens.cache.read/write`) und `cacheWarmth`. `npm run pricing:cache` schreibt `.opencode/jev-pricing.json` (gitignored, 5.139 Modelle mit Cache-Read-Preis; `opencode-go/glm-5.3-flash`: Input `0,15`, Cache-Read `0,03` USD/1M, Context `1M`, kein eigener Write-Preis).

**1c – Diagnose am echten Hook** (`JEV_HOOK_DIAGNOSTIC=1`, schreibt nur Feldnamen/Typen; drei kurze glm-5.3-flash-Läufe, zusammen ≈ `0,004 USD`):
- `event` trägt `sessionID`, `agent`, `model {providerID, id, variant}`, `options`, `tools`, `system`, `messages`.
- Jede Message hat eine stabile `id` (String); jeder Assistant-Schritt ist eine eigene Message (Tool-Schritt und Antwort getrennt). Routing-Key = `id`, Fallback SHA-256 der kanonischen Message-JSON.
- Messages tragen **keine** `tokens`. Provider-Usage gibt es nur offline aus `session_message` (Schritt 4 und Abnahme); das Routing arbeitet mit Preisen, Leerlauf und Tokenschätzung.
- Folge: Routing-State wird pro `sessionID` **und** `agent` geführt, damit Nebenagenten (z. B. Titelgenerierung) das Präfix der Haupt-Session nicht entwerten.

**Schritt 2:** `decideRoute` setzt die Regeln 1–6 in fester Reihenfolge um. Das Plugin führt mit `JEV_CACHE_ROUTING=1` einen inhaltsfreien Routing-State (In-Memory plus `routing/<session>/<agent>` im Plugin-Storage; nur Keys, Hashes, Tokenzahlen, Zeitstempel, EMAs). `buildReuseMessages` rekonstruiert das zuletzt gesendete Präfix (Summary-Extrakte byte-identisch über `createSummaryVariants`) und hängt alles nach der zuletzt gesehenen Message an. Geänderter Hash, fehlende Message, Modellwechsel oder `validateToolPairs`-Fehler → Präfix ungültig → Rebuild. Reuse überspringt Compiler und Jev vollständig (`status: "reused"`, `compilerSkipped: true`). Jede Metrik enthält `routeInput` und `routeConfig`, damit Live-Entscheidungen offline mit `decideRoute` reproduzierbar sind. Storage-Fehler: In-Memory-State arbeitet weiter; unlesbarer State → erster Dispatch (Status quo).

**Schritt 3:** Nur in der Grauzone eines neuen User-Turns sendet das Plugin `continuity: { previousRequest }`. Beide Request-Builder hängen dann die Noul-Frage `continuity` an (`previous_request` redigiert); `route.ts` validiert das Feld (String, ≤ 20.000 Zeichen), stellt die Frage auch ohne Kandidaten und liefert `continuity` zurück. Ohne Feld bleiben Request und Response unverändert. Das Plugin wertet die Antwort in der Neubewertung nach dem Rebuild aus (Regel 6): `≥ 0,60` reuse, `≤ 0,40` rebuild, dazwischen rebuild.

**Schritt 4 – Offline-Kalibrierung** (`npm run calibrate:cache`, read-only, nur numerische Felder; 90 Sessions, 2.868 Assistant-Schritte, 232 Plugin-Metriken):

| Leerlauf vor Schritt | Schritte | Hit nativ | Hit mit Plugin |
| --- | --- | --- | --- |
| < 60 s | 2.541 | 0,894 | 0,799 |
| 60–300 s | 121 | 0,835 | 0,488 |
| 300–600 s | 21 | 0,724 | 0,399 |
| 600–1800 s | 8 | 0,126 | 0 |
| > 1800 s | 7 | 0 | 0,081 |

- Präfixbruch-Preis: Hit-Anteil nach einem Dispatch, dessen Context das Plugin verkleinert hat, `0,57` (128 Fälle); bei unverändertem Context `0,73` (104 Fälle).
- Dispatches pro User-Turn: Median `3`, p75 `8`, Mittel `6,7` (431 Turns).
- Replay von `decideRoute` über die aufgezeichneten Dispatch-Sequenzen, bepreist mit den gemessenen Hit-Raten: Rebuild-always `0,2714 USD` → Routed `0,1461 USD` (−46 %), 220/232 Dispatches reuse, keine Pressure-Verletzung. Das Optimum ist flach: `margin`, `pressureRatio` und `horizon` ändern das Ergebnis nicht messbar, weil fast alle Dispatches Tool-Loop-Schritte sind (Regel 3). Nur `uncertainMs = 900 s` wäre um 2,6 % günstiger, stützt sich aber auf 8 Schritte und widerspricht der Hit-Kurve.
- Übernommen in `DEFAULT_ROUTING`: `pHit` warm/uncertain/cold = `0,89 / 0,72 / 0,07` (gemessen nativ), TTL-Grenzen `300 s / 600 s` (unverändert, durch die Kurve bestätigt), `horizon = 2` (Median 3 minus aktueller Dispatch), `margin = 0,1` und `pressureRatio = 0,8` (flach, konservative Startwerte bleiben).
- Grenzen: Die Kalibrierbasis besteht überwiegend aus Test-Sessions dieses Projekts; die Simulation bewertet nur Kosten, nicht Qualität. Qualität und reale Kosten klärt erst Schritt 5.

Lokaler Stand: `37/37` Context-Tests, `tsc --noEmit`, ESLint und Next.js-Produktions-Build bestanden. `/api/context`-Smoke: ohne `continuity` unverändert; mit `continuity` und echtem Key „gleicher Auftrag“ `0,69`, „neues Thema“ `0,02` (je ≈ `0,000016 USD`); ungültiges/zu langes Feld → `422`.

#### Ergebnisse Schritt 5 (Live-A/B, `opencode-go/glm-5.3-flash`)

Alle Messwerte (Tokens, Cache, Latenz, Routen je Arm, v1/F/v3, Befunde): [`history/phase-6-live-ab.md`](../history/phase-6-live-ab.md).

Aufbau: isolierte Kopien unter `%TEMP%\jev-cache-v1` / `-v3` ohne `.env`/`Plan.md`, `node_modules` als Junction, eigener Git-Baseline-Commit je Kopie. Arme: **nativ** (Plugin ohne Key → nie mutiert), **rebuild-always** (Compiler Port 3417), **routed** (`JEV_CACHE_ROUTING=1`, eigener Compiler Port 3418, damit kein gemeinsamer `SelectorAnswerCache`). Harness erkennt Turn-Ende über `idle` in `session_message`, prüft das Workspace-Verzeichnis und protokolliert nach `runs.jsonl`. Canaries A `ALPHA-7431`, B `BRAVO-2290`, C `CHARLIE-5518`, D `DELTA-9044`, F `ECHO-3107`.

**Fehlerfälle F (v1, routed, 0,030 USD):** alle bestanden, Canary 4/4, Replay 44/44. Ungültiges Präfix → nur `invalid prefix`-Rebuilds; fehlende Preisdatei → nur `no pricing`; Storage-Fehler → `first dispatch` je Prozess, danach In-Memory-Reuse; Compiler-Fehler → vollständiger Fallback, danach Reuse des vollen Contexts. Kein Absturz, keine ungültige Sequenz.

**v1 (abgebrochen) → Modellkorrektur:** Routed wählte fast immer `reuse cheaper` und lag in A über Rebuild (`0,0404` vs. `0,0337 USD`). Ursachen: `keepRatio` wurde vom trivialen ersten Compile (≈ 1) gesetzt, und die Rebuild-Seite rechnete mit 0 % Cache-Treffern. Korrektur: `pHitRebuild = 0,52` (gemessener Hit nach Kontextmutation), `keepRatioPrior = 0,64` (Median der Compiles mit Jev-Entscheidungen), `keepRatio` lernt nur noch aus Compiles mit Jev-Entscheidungen; Regressionstest ergänzt (`37/37`).

**v3 (vollständig, 0,689 USD):** Gesamtkosten = Agent (reale Provider-Kosten aus `session_message`) + Selector.

| Session | nativ | rebuild-always | routed |
| --- | --- | --- | --- |
| A Codebase/Refactor (18 Turns) | 0,0519 | 0,0527 | 0,0543 |
| B Security/Konfiguration (18) | 0,0631 | 0,0524 | 0,0603 |
| C Test/Root Cause (17) | 0,0334 | 0,0456 | 0,0335 |
| D Cache-Grenzfälle (15, Pausen 11/6 min) | 0,0832 | 0,1056 | 0,0935 |
| **Σ USD** | **0,2316** | **0,2562** | **0,2416** |

- Routed −5,7 % gegenüber Rebuild-always, aber +4,3 % gegenüber nativ. Routed wählte in 131/140 Dispatches Reuse (Tool-Loop 71, `reuse cheaper` 60; Compiler übersprungen in 127/140) und verhielt sich damit weitgehend wie nativ; der Vorteil gegenüber Rebuild stammt aus C und D. In A und B war Rebuild günstiger als routed.
- Rebuild erreichte median 32–50 % Reduktion, aber die Selector-Kosten (`0,006–0,015 USD` je Session) und der niedrigere Cache-Read-Anteil (`0,37–0,73`) zehren den Vorteil bei diesem günstigen Modell auf. Nativ ist insgesamt am günstigsten.
- Modellnachrichten je Arm 29–42 (A–C ≥ 32, D 29–41).
- Must-keep: 12/12 Arme korrekt (Canary, `src/`-Regel inkl. abgelehnter README-Änderung, zwei abgelehnte `.env`-Anfragen, Root Cause `cacheWarmth` `<`→`<=` mit 36/1 → 37/0, offene Aufgabe erst auf Signal, Sprachregel). Geänderte Dateien je Session in allen Armen identisch.
- Keine Tool-Paar- oder Sequenzfehler in den Plugin-Armen; ein einzelner Provider-Fehler im nativen Arm C (unabhängig vom Plugin).
- Hook p95 routed `12–18 ms` (A–C) und `410 ms` (D); rebuild `620–701 ms`.
- Replay 140/140 Live-Entscheidungen reproduziert. Pausen korrekt erkannt (`cold cache` nach 11 min, `gray zone` mit Kontinuitätsfrage).

**Abnahmekriterien**

| Kriterium | Ergebnis |
| --- | --- |
| 100 % Must-keep im Routed-Arm | ✅ |
| Task-Erfolg/Patch-Qualität ≥ Rebuild | ✅ identische Änderungen |
| Keine verwaisten Tool-Paare; Fehler → voller Context | ✅ (F 4/4) |
| Gesamtkosten routed < rebuild-always | ✅ `0,2416` < `0,2562` USD; über nativ (`0,2316`) |
| Hook p95 < 700 ms | ✅ max. `410 ms` |
| Keine Outgoing-Größe über der Pressure-Schwelle | ❌ D-routed Provider-Prompt `88.360` > `86.400` (0,8 × 108k); Rebuild max. `61.209` |
| Replay 100 % | ✅ 140/140 |

**Befund Pressure-Schutz:** Regel 2 arbeitet mit der Plugin-Tokenschätzung der Messages. Diese lag in D-routed bei `31.699`, der Provider meldete `88.360` (Faktor ≈ 2,8; System-Prompt und Tool-Definitionen fehlen, JSON wie `package-lock.json` tokenisiert deutlich dichter als die Schätzung). Die Regel konnte deshalb nicht auslösen. Eine OpenCode-Compaction trat nicht auf, der Abstand zur Schwelle war aber nur noch 18 %.

**Entscheidung: No-Go** für v3. Flag bleibt standardmäßig aus. Nötige Korrektur vor einem erneuten Lauf: Pressure-Prüfung mit kalibriertem Verhältnis Provider-Prompt / Schätzung plus festem Overhead für System-Prompt und Tools (offline aus `session_message` bestimmbar). Zusätzlich zeigt die Kampagne, dass Rebuild bei `glm-5.3-flash` gegenüber nativ nicht lohnt; der Kostenvorteil von Routing entsteht vor allem, indem es Jev-Aufrufe vermeidet.

Kosten Schritt 5 gesamt ≈ `1,04 USD` (v1 inkl. F und 1c `0,345`, abgebrochener v2-Start wenige Cent, v3 `0,689`).

#### Folgearbeit: echte Werte und Turn-Policy

Details und Tabellen: [`history/phase-6-live-ab.md`](../history/phase-6-live-ab.md) (Folgeanalyse, Turn-Policy).

- Echte Provider-Tokens sind im Hook verfügbar: `ctx.session.context({ sessionID })` liefert in 1–2 ms alle Nachrichten seit der letzten Compaction mit `tokens` und `cost` (live bestätigt).
- Neubepreisung von v3 mit Top-Tier-Modellen: nativ bleibt am günstigsten; der Hebel ist der Cache-Bruch, nicht die Selector-Kosten (< 1,5 % bei Top-Tier).
- Turn-Policy (`JEV_CACHE_POLICY=turn`, standardmäßig aus): Tool-Schleife nur anhängen, Jev kürzt den vorherigen Turn bei der nächsten User-Eingabe, Bewertetes bleibt eingefroren. Live A–C: glm −11 %, `gpt-5.6-luna` −6,5 % gegenüber nativ bei 100 % Must-keep und stabilem Cache-Read (luna 0,92–0,96). Session D bei beiden Modellen teurer (Voll-Neubewertung nach Pause bricht warmen Cache; Pressure-Neubewertung scheitert an der 256-kB-Payload-Grenze; Kompaktierungsgrenze modellabhängig).
- Stand lokal: `43/43` Context-Tests, `tsc`, ESLint; Fallback der Turn-Policy sendet nie wieder gekürzten Kontext.
- Umgesetzt für große Kontexte bis 1M Tokens (lokal, `47/47` Tests, `tsc`, ESLint, Build):
  1. An Jev gehen nur noch offene Chunks (vorheriger Turn inkl. Tool-Schleife); eingefrorene Inhalte werden nie wieder übertragen. Jev bewertet jeden Chunk einzeln gegen die aktuelle Anfrage, dadurch geht nichts verloren.
  2. Jede Kompilierung läuft in Batches (≤ 60 Chunks, ≤ 200 kB), Abhängigkeiten werden danach über alle Batches geschlossen.
  3. Pressure = `0,8 ×` echtes Kontextfenster des Modells mit echten Provider-Tokens; keine feste 108k-Grenze, keine Neubewertung allein wegen einer Pause.
  4. `refresh`: Ab `40k` echten Prompt-Tokens und `1,5 ×` Wachstum seit der letzten Gesamtbewertung bewertet Jev auch eingefrorene Chunks neu (entfernte bleiben entfernt). Angewendet wird nur, wenn `entfernt × Cache-Read × 10 Dispatches ≥ Tail × (Write − Read)` gilt; unter Pressure immer.
- Zusätzlich `JEV_COMPILE_TIMEOUT_MS` (500–5000 ms, Standard 5000): Obergrenze je Compiler-Anfrage; bei Timeout geht der eingefrorene Stand raus (`48/48` Tests).

**Retest (23. September 2026, ≈ 1,74 USD):** Details in [`history/phase-6-live-ab.md`](../history/phase-6-live-ab.md) („Retest `jev-turn3-*` und `jev-d2-*`“).
- A–C: glm −18 %, luna −2 % gegenüber nativ (inkl. Jev).
- D mit frei gewählter Lesestrategie nicht vergleichbar (Arme arbeiteten verschieden). D2 mit vorgeschriebenen Tool-Aufrufen, 2 Modelle × 2 Wiederholungen: turn −11 bis −32 %, turnfast (1,5-s-Timeout) −9 bis −43 %; Jev ≈ 0,005 USD je Session. Technisch sauber: keine Payload-Fehler, Refresh greift, Replay 100 %, echte Tokens 96–97 %.
- Hook p95 3–5 s im turn-Arm, verursacht durch OpenRouter-Latenz (p95 2,3 s, max. 4,7 s, unabhängig von der Payload); turnfast begrenzt auf 1,5 s.
- **Must-keep verletzt:** luna verlor in 4 von 5 Plugin-Armen Fakten aus früheren Turns; glm erfand in einem turn-Arm drei Leseergebnisse ohne Tool-Aufruf. Ursachen: Relevanz wird nur gegen die aktuelle Anfrage bewertet, und vollständig gelöschte Tool-Paare neben stehengebliebenen Antworten („Beide Aufrufe sind abgeschlossen …“) bringen das Modell dazu, Tool-Arbeit zu behaupten.
- **Entscheidung: No-Go.** Flag bleibt aus.
- Umgesetzt nach dem Retest (lokal, `50/50` Tests, `tsc`, ESLint, Build; noch nicht live): Die Turn-Policy entfernt keine Nachrichten mehr, sondern ersetzt gekürzte V2-Tool-Ausgaben durch den festen Text `TOOL_OUTPUT_REMOVED` (Aufruf bleibt sichtbar); Antworten, Reasoning und User-Nachrichten sind keine Kandidaten mehr. Routing-State-Eintrag `{ stubOf, parts, hash }` hält das Präfix byte-stabil. Außerdem erkennt die Secret-Erkennung jetzt `sk-…`-Keys mit Bindestrich (OpenRouter).

**Platzhalter-Retest (24. September 2026, ≈ 0,78 USD):** Details in [`history/phase-6-live-ab.md`](../history/phase-6-live-ab.md) („Platzhalter statt Löschen“).
- Der Smoke-Test fand einen Fehler: Live liefert OpenCode Tool-Ergebnisse als eigene `role: "tool"`-Nachricht ohne `id` (`tool-result`-Teil mit `result: { type: "text", value }`), nicht als V2-`tool`-Teil. Die Stub-Logik griff dadurch nie. Behoben in `toolPartOf`/`stubMessage`, Test mit der Live-Form (`51/51`). Danach akzeptierte OpenCode die Stubs, und das Modell las gekürzte Dateien bei Bedarf selbst neu.
- D2 erneut (nativ vs. turn, 2 Modelle × 2 Läufe): glm −47 % / −34 %, luna −21 % / −16 % inkl. Jev (Σ glm −41 %, Σ luna −19 %). Größter Prompt 193–206k → 122–139k.
- **Must-keep 8/8 Arme korrekt**, jeder turn-Turn mit exakt den vorgeschriebenen Tool-Aufrufen; keine erfundenen Leseergebnisse. Kein Fallback, Replay 100 %.
- Hook p95 turn 0,9–1,6 s (OpenRouter-Latenz), weiter über 700 ms.
- **Entscheidung: Go für die Turn-Policy mit Platzhaltern** (D2-Kriterium); **Phase 6 abgeschlossen.** A–C werden auf Entscheidung des Nutzers nicht erneut gemessen (D2 ist der härteste Fall; A–C waren schon ohne Platzhalter Must-keep-korrekt). Bekannte Einschränkung: Hook p95 0,9–1,6 s (Ziel < 700 ms), begrenzbar mit `JEV_COMPILE_TIMEOUT_MS`. Flag bleibt standardmäßig aus.
- Nächster Schritt: Phase 7A (Claude Code), siehe [`claude-code.md`](claude-code.md).

#### Context

Phase 5 ist Go (v7/v8). Das Plugin `.opencode/plugins/jev-context.ts` kompiliert heute **bei jedem Dispatch neu** (`mode: "rebuild"` ist in `CompilationResult` hart codiert). Dadurch ändert sich das versendete Präfix von Dispatch zu Dispatch (z. B. wenn „recent context“-Pins wegfallen), der Provider-Prompt-Cache wird entwertet, und jeder Tool-Loop-Schritt kostet einen Compiler-/Jev-Aufruf.

Lokale Evidenz (read-only aus `~/.local/share/opencode/opencode.db`, nur Zahlen):
- Cache-Read-Anteil in Sessions im Jev-Projekt `0,735` gegenüber `0,880` in anderen Projekten (konfundiert, aber konsistent mit Präfixbruch).
- Cache-Hit nach Leerlauf: `<60 s 0,92`, `60–300 s 0,91`, `300–600 s 0,76`, `600–1800 s 0,46`, `>1800 s 0,09` → TTL ≈ 5–10 min.
- OpenCode V2 speichert pro Assistant-Schritt `tokens {input, output, reasoning, cache{read, write}}`, `cost`, `model`, `time` (`session_message.data`). Der lokale models.dev-Katalog (`kv: models-dev:catalog`) enthält `cost.input`, `cost.cache_read`, optional `cost.cache_write` und `limit.context` pro Modell.
- Der `context`-Hook liefert laut offizieller V2-Doku `model: { providerID, id }`, `system`, `messages`, `options`.

Ziel: pro Dispatch deterministisch zwischen **reuse** (vorheriges versendetes Präfix + neue Messages anhängen, kein Compiler-Aufruf) und **rebuild** (heutige Neukompilierung) entscheiden; Jev beurteilt nur optional die Task-Kontinuität. Ergebnis ist ein in OpenCode gemessener, realer Kostenvorteil (Provider-Kosten inkl. Cache + Selector) ohne Qualitätsverlust.

Entscheidung des Nutzers: Kalibrierung und Live-A/B mit **`opencode-go/glm-5.3-flash`** (Input 0,15 / Cache-Read 0,03 USD pro 1M, 1M Context).

#### Leitplanken (aus Plan.md / §9 / §15)

- Neues Flag `JEV_CACHE_ROUTING=1`, **standardmäßig aus**. Ohne Flag bleibt Verhalten strukturell identisch (Test sichert das ab). `JEV_SUMMARY_LEVELS` bleibt aus; Routing funktioniert mit beiden Policies, abgenommen wird mit der binären Default-Policy.
- Fehler jeder Art (ungültiges Präfix, Storage, Preisdaten, Compiler) → vollständiger Originalcontext wie bisher. Fehlende Preisdaten → Status quo (rebuild bei jedem Dispatch).
- Keine neuen Dependencies (`node:sqlite`, `node:crypto` reichen). Keine externen Netzaufrufe aus dem Plugin.
- Routing-State und Metriken inhaltsfrei: nur Message-IDs, Hashes, Tokenzahlen, Zeitstempel, Preise.
- Vor Änderungen an `route.ts` die Route-Handler-Doku unter `node_modules/next/dist/docs/01-app/` lesen.
- Kostenpflichtige Live-Läufe und Transcript-Übertragung vorab ausdrücklich freigeben lassen.

#### Schritt 1 – Provider- und Agent-Metriken normalisieren

**Neu: `src/lib/cache-routing.ts`** (reine Logik, wie `context.ts` vom Plugin importiert):
- `ModelPricing { inputPerM, cacheReadPerM, cacheWritePerM, contextLimit }` – `cacheWritePerM` fällt auf `inputPerM` zurück (implizites Caching ohne Aufschlag).
- `DispatchUsage { input, cacheRead, cacheWrite, output, costUsd, at }` + `normalizeUsage(message)` für die OpenCode-V2-Form `tokens.cache.read/write`. Weitere Providerformen erst, wenn Schritt 1c zeigt, dass sie gebraucht werden (YAGNI).
- `cacheWarmth(gapMs, calibration)` → `warm | uncertain | cold` (Start: `≤300 s / ≤600 s / >600 s`, in Schritt 4 kalibriert).

**Preisquelle:** Skript `scripts/cache-pricing.ts` (npm `pricing:cache`) liest `models-dev:catalog` read-only aus der OpenCode-DB und schreibt `.opencode/jev-pricing.json` (nur Modelle mit `cost.cache_read`, Werte pro 1M, `limit.context`, `updatedAt`). Plugin liest die Datei einmal beim `setup`; fehlt Datei/Modell → kein Routing (Status quo, Metrik `routeReason: "no pricing"`).

**1c – Verifikation am echten Hook (kostenlos, lokal):** kurzer Diagnoselauf, der nur die **Feldnamen** (keine Werte/Inhalte) von `event.model` und einer Assistant-Message in `event.messages` in Plugin-Storage schreibt. Klärt: (a) liegt `event.model` vor, (b) tragen Assistant-Messages `id` und `tokens`. Fehlt `id` → stabiler Schlüssel = SHA-256 über die kanonische Message-JSON. Fehlen `tokens` → Live-Usage nur offline (Schritt 4), Routing funktioniert trotzdem (Preise + Gap + Tokenschätzung).

#### Schritt 2 – Reuse/Rebuild-Break-even deterministisch

**Routing-State pro Session** (In-Memory-Map + `ctx.storage` `routing/<sessionID>`, inhaltsfrei):
`{ sent: Array<{ key: string; hash: string } | { summaryOf: chunkId; level }>, lastOriginalIndex, sentTokens, lastDispatchAt, lastUserEntryId, lastReduction (EMA), pricingModel }`.

**Reuse-Aufbau im Plugin** (`buildReuseMessages`): vorheriges Outgoing aus aktuellen `event.messages` per Key rekonstruieren (Summary-Extrakte deterministisch via `createSummaryVariants`), danach alle Messages nach `lastOriginalIndex` anhängen. Fehlt eine referenzierte Message, hat sich ein Hash geändert (z. B. OpenCode-Compaction) oder schlägt `validateToolPairs` fehl → Präfix ungültig → rebuild.

**`decideRoute(input)` in `cache-routing.ts`**, feste Reihenfolge:
1. Kein gültiges Präfix / erster Dispatch / keine Preise → `rebuild` (Status quo).
2. Context-Druck: `reuseTokens ≥ pressureRatio × min(contextLimit, 108k-Compaction-Schwelle)` → `rebuild`.
3. Gleicher User-Turn (Tool-Loop-Schritt) und `warm` → `reuse` ohne Compiler-Aufruf. Begründung: alle Schritte seit dem aktuellen User-Turn sind ohnehin als `current task work` gepinnt; der ältere Rest wurde bereits für denselben Auftrag bewertet.
4. `cold` → `rebuild` (Reuse hat keinen Cache-Vorteil).
5. Neuer User-Turn, warm/uncertain → Kostenvergleich über Horizont `H` (erwartete weitere Dispatches, kalibriert):
   - P = gecachte Präfix-Tokens, A = neue Tokens, R̂ = geschätzte Rebuild-Tokens = Pins + `lastReduction`-basierte Schätzung, S = erwartete Selector-Kosten (EMA).
   - `reuse = p_hit·P·cr + (1−p_hit)·P·cw + A·cw + H·(P+A)·cr`
   - `rebuild = R̂·cw + S + H·R̂·cr`  (`p_hit` aus Warmth-Kalibrierung, `cr`/`cw` = Cache-Read/-Write-Preis)
   - `rebuild`, wenn `rebuild < reuse·(1 − margin)`; `reuse`, wenn `reuse < rebuild·(1 − margin)`; sonst **Grauzone** → Schritt 3.
6. Nach tatsächlichem Rebuild: Ergebnis mit echtem R erneut vergleichen; lohnt es sich nicht, Reuse-Messages senden (Selector-Kosten sind versunken, Auswahl bleibt sicher).

Alle Schwellen (`pressureRatio`, `margin`, `H`, TTL-Grenzen, `p_hit`) als ein exportiertes `DEFAULT_ROUTING`-Objekt; Startwerte konservativ, Kalibrierung in Schritt 4.

**Metrik-Erweiterung** (`recordMetric`): `route`, `routeReason`, `warmth`, `gapMs`, `reuseTokens`, `rebuildTokensEstimated/Actual`, `reuseUsdEstimated`, `rebuildUsdEstimated`, `compilerSkipped`, `continuity`, `prefixValid`, `pricingModel`, sowie – falls in 1c verfügbar – die normalisierte Usage des vorherigen Schritts.

#### Schritt 3 – Task-Kontinuität optional mit Jev

- Nur in der Grauzone und nur an neuen User-Turns. Das Plugin sendet dann an `/api/context` zusätzlich `continuity: { previousRequest }`.
- `src/lib/context.ts`: `buildSelectorRequest`/`buildSummarySelectorRequest` hängen bei gesetztem Feld eine Noul-Frage `continuity` an (State enthält bereits `current_request`; `previousRequest` redigiert in `instructions`). Kriterien: true = „setzt denselben Auftrag fort, früherer Context bleibt maßgeblich“, false = „neues Thema/Ziel“. Ein Jev-Request, keine Zusatzlatenz; läuft über den bestehenden `SelectorAnswerCache`.
- `route.ts`: optionales Feld validieren (String, Längenlimit), auch bei 0 Kandidaten die eine Frage stellen, Antwort als `continuity?: number` zurückgeben. Binärer/Summary-Request ohne Feld bleibt byte-kompatibel.
- Plugin: `continuity ≥ 0,60` → `reuse` (Horizont bleibt), `≤ 0,40` → `rebuild`, dazwischen konservativ `rebuild` (kleinerer, frisch bewerteter Context). Schwellen in Schritt 4 kalibrieren. Jev entscheidet nie über Sicherheit oder Kosten, nur über Kontinuität.

#### Schritt 4 – Policy anhand realer Sessions kalibrieren (kostenlos, offline)

**Neu: `scripts/calibrate-cache-routing.ts`** (npm `calibrate:cache`), liest `opencode.db` mit `DatabaseSync(..., { readOnly: true })`:
- Nur `session_message` (numerische `tokens`, `cost`, `time`, `model`) und Plugin-Metriken unter dem `jev-context`-kv-Präfix. Keine Account-/Credential-Tabellen, keine Textfelder ausgeben.
- Ausgabe (nur Aggregate): Hit-Kurve nach Leerlauf pro Modell → TTL/`p_hit`; Median/p75 Dispatches pro User-Turn → `H`; Cache-Read-Anteil nach rebuild-Dispatches vs. natürlichem Append → realer Präfixbruch-Preis; Simulation von `decideRoute` über aufgezeichnete Metriksequenzen für ein Gitter aus `margin`/`pressureRatio`/TTL, Ziel minimale simulierte Gesamtkosten ohne Pressure-Verletzung.
- Gewählte Werte in `DEFAULT_ROUTING` übernehmen und mit Begründung in `docs/plan/agents/opencode.md` dokumentieren.

#### Tests (lokal, vor jedem Live-Lauf)

In `src/lib/context.test.ts` (Konvention: `node:test`, `npm run test:context`):
- Flag aus → Hook-Verhalten unverändert (bestehende Hook-Tests + expliziter Vergleich).
- `decideRoute`: jede Regel 1–6 einzeln; Determinismus (gleiche Eingabe → gleiche Entscheidung); fehlende Preise → rebuild.
- Reuse-Aufbau: exaktes Präfix + Anhang; geänderter Hash / fehlende Message (Compaction) → rebuild; Summary-Extrakte byte-identisch reproduziert; keine verwaisten Tool-Paare.
- Tool-Loop-Schritt warm → Compiler wird nicht aufgerufen (Fetch-Mock zählt 0).
- Storage-Fehler im Routing-State → vollständiger Originalcontext bzw. Status quo, nie Absturz.
- `continuity`-Frage: nur mit Feld, redigiert, Parsing, Route-Kompatibilität ohne Feld.
- `normalizeUsage` für die in 1c beobachtete Form.
- Danach `npm run lint`, `npm run build`, lokaler `/api/context`-Smoke mit und ohne `continuity`.

#### Schritt 5 – Reuse vs. Rebuild vollständig in OpenCode testen (kostenpflichtig, Freigabe nötig)

Aufbau wie v6–v8 (isolierte Kopien unter `%TEMP%\jev-cache-v1` ohne `.env`/`Plan.md`, `node_modules` per Junction, Harness setzt `PWD`, Budgetgrenzen, Wiederholung nach Transportabbruch), Modell `opencode-go/glm-5.3-flash`, binäre Policy.

Drei Arme mit identischen Prompts:
1. **Nativ** – Plugin in der Kopie deaktiviert (Kostenbasis mit natürlichem Cache).
2. **Rebuild-always** – heutiges Plugin (Status quo).
3. **Routed** – `JEV_CACHE_ROUTING=1`.

Sessions je Arm, jeweils ≥ 30 Modellnachrichten: A (Codebase/Refactor), B (Security/Konfiguration), C (Test/Retrieval/Root Cause) mit den bestehenden Prompt-Sets aus v7 (falls nicht mehr vorhanden, gleichwertig neu erstellen) sowie **D (Cache-Grenzfälle)**: Themenwechsel mitten in der Session, Pausen > 10 min (kalter Cache) und > Compaction-Schwelle. Fehlerfälle nur für neue Pfade provozieren: ungültiges Präfix, Routing-Storage-Fehler, fehlende Preisdatei, Compiler-Fehler während Rebuild.

Gemessen je Arm (reale Provider-Werte aus `session_message`, nicht geschätzt): Agent-Kosten USD, Input/Cache-Read/Cache-Write-Tokens, Cache-Read-Anteil, Selector-Kosten, Gesamtkosten, Hook p50/p95, Anteil übersprungener Compiler-Aufrufe, max. Outgoing-Tokens, mediane Reduktion, Route-Verteilung und Gründe, Must-keep-Treffer, Task-Erfolg.

**Abnahmekriterien Phase 6**
- `100 %` Canary-, Sicherheits-, Repository-, offene-Task- und Root-Cause-Fakten im Routed-Arm.
- Task-Erfolg und Patch-Qualität nicht schlechter als Rebuild-always.
- Keine verwaisten Tool-Paare, keine ungültigen Sequenzen; alle provozierten Fehler → vollständiger Context.
- **Gesamtkosten (Agent + Selector) Routed < Rebuild-always**, gepoolt über A–D; Vergleich zu Nativ wird ausgewiesen (Ziel ebenfalls darunter, sonst begründen).
- Hook p95 < 700 ms (Reuse-Dispatches sollten ihn senken).
- Keine Outgoing-Größe über der Pressure-Schwelle; keine durch Routing ausgelöste OpenCode-Compaction, die im Rebuild-Arm nicht auftritt.
- Offline-Replay der geloggten Eingaben durch `decideRoute` reproduziert 100 % der Live-Entscheidungen.

Geschätzte Kosten: glm-5.3-flash ist günstig; 12 Sessions + Fehlerfälle voraussichtlich deutlich unter 1 USD Agent + ca. 0,1–0,2 USD Selector. Vor Start ausdrückliche Freigabe einholen.

**Go:** Flag bleibt trotzdem standardmäßig aus (separate Produktentscheidung, wie bei Phase 5). **No-Go:** verletzte Kriterien mit Messwerten dokumentieren.

#### Dokumentation

- Ergebnisse, Kalibrierwerte und Entscheidung in `docs/plan/agents/opencode.md` unter Phase 6 (Checkboxen 1–5 abhaken).
- `Plan.md` Status/Nächster Schritt und `docs/plan/06-roadmap.md` aktualisieren; bei Go ist Phase 7A (Claude Code) nächster Schritt.
- Nichts resetten; `Plan copy.md` und bestehende Änderungen an `Plan.md` erhalten.

#### Kritische Dateien

| Datei | Änderung |
| --- | --- |
| `src/lib/cache-routing.ts` | neu: Pricing, Usage-Normalisierung, Warmth, `decideRoute`, `DEFAULT_ROUTING` |
| `.opencode/plugins/jev-context.ts` | Flag, Routing-State, `buildReuseMessages`, Compiler-Skip, Metriken; wiederverwendet `validateToolPairs`, `createSummaryVariants`, `recordMetric`, `prepareContext` |
| `src/lib/context.ts` | optionale `continuity`-Frage in beiden Request-Buildern, `CompilationResult.continuity` |
| `src/app/api/context/route.ts` | Feld validieren, Frage auch ohne Kandidaten, Antwort durchreichen |
| `scripts/cache-pricing.ts`, `scripts/calibrate-cache-routing.ts`, `package.json` | Preisdatei, Offline-Kalibrierung |
| `src/lib/context.test.ts` | Tests wie oben |

#### Verifikation

1. `npm run test:context` mit und ohne `JEV_CACHE_ROUTING`/`JEV_SUMMARY_LEVELS`, `npm run lint`, `npm run build`.
2. `npm run pricing:cache` → `.opencode/jev-pricing.json` enthält glm-5.3-flash mit Cache-Read-Preis.
3. `npm run calibrate:cache` → Aggregate plausibel (TTL ≈ 5–10 min wie oben), Werte übernommen.
4. Lokaler `/api/context`-Smoke mit/ohne `continuity`.
5. Diagnose-Hook-Lauf (Schritt 1c), dann nach Freigabe OpenCode-Smoke mit Routing: mindestens ein `reuse` mit `compilerSkipped` und steigendem Cache-Read-Anteil in `session_message`, danach die A/B/C/D-Abnahme.
