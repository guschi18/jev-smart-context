# Agent: OpenCode

OpenCode-V2-Adapter, abgeschlossene Phasen 3–4, implementierte Summary-Baseline und die aktive Phase 6. Lesen für jede OpenCode-Arbeit.

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

Status: geplant am 23. September 2026, Umsetzung offen. Checkliste:

- [ ] 1. Provider- und Agent-Metriken normalisieren.
- [ ] 2. Reuse/Rebuild-Break-even deterministisch berechnen.
- [ ] 3. Task-Kontinuität optional mit Jev bewerten.
- [ ] 4. Policy anhand realer Sessions kalibrieren.
- [ ] 5. Reuse und Rebuild vollständig in OpenCode gegeneinander testen.

Ergebnis: in OpenCode validierte, kostenbewusste Entscheidung zwischen warmem Präfix und kleinerem neuen Context.

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
