# Historie: Phase 6, Schritt 5 – Live-A/B Cache-aware Routing

Vollständige Messwerte der kostenpflichtigen Live-Kampagne vom 23. September 2026. Nur bei Bedarf lesen; Zusammenfassung und Entscheidung stehen unter „Phase 6“ in [`agents/opencode.md`](../agents/opencode.md).

> Teil des aufgeteilten Plans. Index, Status und Leseregeln: [`Plan.md`](../../../Plan.md).

## Aufbau

- Modell: `opencode-go/glm-5.3-flash` (Input `0,15`, Cache-Read `0,03` USD/1M, 1M Context). Der Provider meldete in allen Läufen `cache.write = 0`.
- OpenCode `@opencode/cli 2.0.13`, Aufruf `opencode run --standalone --auto -m opencode-go/glm-5.3-flash --format json [-s <session>]`.
- Isolierte Projektkopien unter `%TEMP%\jev-cache-v1` bzw. `%TEMP%\jev-cache-v3`: ohne `.env*`, `Plan.md`, `Plan copy.md`, `CLAUDE.md`, `tmp`, `.next`, `.git`; `node_modules` als Junction; je Kopie `git init` und Baseline-Commit.
- Drei Arme mit identischen Prompts, pro Session parallel gestartet:
  - **nativ**: Plugin vorhanden, aber ohne `OPENROUTER_API_KEY` → Fallback bei jedem Dispatch, der Context bleibt unverändert.
  - **rebuild-always**: Plugin mit Key, Compiler `next start -p 3417` (Status quo, Neukompilierung bei jedem Dispatch).
  - **routed**: zusätzlich `JEV_CACHE_ROUTING=1`, eigener Compiler `next start -p 3418`, damit die Arme keinen `SelectorAnswerCache` teilen.
- Harness: erkennt das Turn-Ende über eine neue `idle`-Zeile in `session_message` (der Prozess beendet sich nicht immer selbst) und beendet dann den Prozessbaum; prüft das Session-Verzeichnis gegen die Kopie; eine Wiederholung nach Timeout (8 min) oder Abbruch; Budget je Gruppe (A–C `0,60`, D `0,45`, F `0,15` USD); Protokoll in `runs.jsonl`. Der Key wird aus `.env` per `--env-file` geladen und nie ausgegeben.
- Auswertung: reale Provider-Werte aus `session_message` (`tokens.input`, `tokens.cache.read/write`, `cost`), Plugin-Metriken aus dem `jev-context`-kv-Präfix, Offline-Replay jeder Routing-Entscheidung mit `decideRoute(routeInput, routeConfig)`.

## Prompt-Sets

Jeder erste Prompt legt einen Canary und eine Session-Regel fest und untersagt das interaktive Frage-Werkzeug (in v1 brach A-routed daran mit Exit 1 ab).

| Session | Turns | Canary | Regel / Prüfung |
| --- | --- | --- | --- |
| A Codebase/Refactor | 18 | `ALPHA-7431` | keine Änderungen außerhalb `src/` (README-Auftrag muss abgelehnt werden); Refactor `isContinuity`, JSDoc, Tests, Lint, tsc |
| B Security/Konfiguration | 18 | `BRAVO-2290` | `.env*` nie lesen, keine Keys ausgeben (zwei Provokationen); neue `src/lib/limits.ts`, tsc |
| C Test/Root Cause | 17 | `CHARLIE-5518` | injizierter Fehler `cacheWarmth` (`<` statt `<=`, 36/1 Tests); offene Aufgabe `docs/NOTES.md` erst auf Signal |
| D Cache-Grenzfälle | 15 | `DELTA-9044` | immer Deutsch; Pausen 11 min und 6 min, Themenwechsel, große Reads (Next-Doku, `package-lock.json`) Richtung Compaction-Schwelle |
| F Fehlerfälle (nur routed) | 4 | `ECHO-3107` | ungültiges Präfix, Storage-Fehler, fehlende Preisdatei, toter Compiler-Port |

## v1 (abgebrochen) und Fehlerfälle F

**Fehlerfälle F** (Injektion per Patch in der jeweiligen Kopie):

| Fall | Modell-Msgs | Routen | Ergebnis |
| --- | --- | --- | --- |
| F-prefix (Hash + Zufall) | 6 | `invalid prefix` 10, `first dispatch` 1 | nur Rebuilds, voller Context bei Fehler |
| F-storage (set/get werfen) | 6 | `first dispatch` 4, Tool-Loop 7 | erster Dispatch je Prozess, danach In-Memory-Reuse |
| F-pricing (Datei gelöscht) | 6 | `no pricing` 13 | Status quo (Rebuild) |
| F-compiler (Port 3499) | 6 | Tool-Loop 5, `reuse cheaper` 2, `gray zone` 1 | vollständiger Fallback, danach Reuse des vollen Contexts |

Canary 4/4, Replay 44/44, keine ungültige Sequenz, zusammen `0,030 USD`.

**v1 A–D** (nach dem ersten Drittel abgebrochen):

| Arm | Modell-Msgs | Cache-Read | Gesamt USD | Hook p95 | Reduktion |
| --- | --- | --- | --- | --- | --- |
| A nativ / rebuild / routed | 23 / 24 / 27 | 0,59 / 0,54 / 0,69 | 0,0402 / **0,0337** / 0,0404 | 6 / 578 / 11 ms | – / 44 % / 0 % |
| B nativ / rebuild / routed | 27 / 26 / 24 | 0,72 / 0,28 / 0,75 | 0,0485 / 0,0474 / **0,0407** | 6 / 724 / 11 ms | – / 57 % / 0 % |

Befund: Routed wählte fast ausschließlich Reuse (`reuse cheaper`, Tool-Loop) und kürzte nie. Ursachen im Kostenmodell:
- `keepRatio` wurde vom trivialen ersten Compile (≈ 1, nichts zu entfernen) gesetzt, der geschätzte Rebuild war deshalb fast so groß wie Reuse.
- Die Rebuild-Seite rechnete mit 0 % Cache-Treffern, obwohl nach einer Kontextmutation real ≈ 52 % getroffen werden.

Korrektur vor v3: `pHitRebuild = 0,52`, `keepRatioPrior = 0,64`, `keepRatio` lernt nur aus Compiles mit Jev-Entscheidungen; Regressionstest ergänzt (`37/37`). Zusätzlich wurden die Prompt-Sets verlängert (v1-Sessions hatten nur 23–27 Modellnachrichten).

Hinweis zum Replay: v1 wurde zur Laufzeit zu 100 % reproduziert. Mit dem heutigen `decideRoute` weichen v1-Replays ab, weil deren `routeConfig` die später ergänzten Felder `pHitRebuild`/`keepRatioPrior` noch nicht enthält.

**v2** wurde nach ≈ 1,5 min auf Wunsch gestoppt (Kontext-Kompaktierung der Arbeitssitzung) und nicht ausgewertet; Kosten wenige Cent.

## v3 (vollständig)

Tokens aus `session_message` summiert über alle Assistant-Schritte; Gesamt = Agent + Selector.

| Arm | Modell-Msgs | Input | Cache-Read | Cache-Read-Anteil | Agent USD | Selector USD | Gesamt USD | max. Provider-Prompt | Hook p50 / p95 | Reduktion (Median) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A nativ | 35 | 196.400 | 646.272 | 0,767 | 0,0519 | – | **0,0519** | 31.814 | 4 / 8 ms | – |
| A rebuild | 33 | 167.089 | 456.640 | 0,732 | 0,0417 | 0,0110 | 0,0527 | 24.170 | 456 / 701 ms | 33 % |
| A routed | 35 | 228.520 | 552.832 | 0,708 | 0,0540 | 0,0002 | 0,0543 | 29.131 | 7 / 14 ms | 0 % |
| B nativ | 36 | 275.429 | 593.600 | 0,683 | 0,0631 | – | 0,0631 | 33.341 | 4 / 9 ms | – |
| B rebuild | 42 | 216.046 | 284.160 | 0,568 | 0,0446 | 0,0079 | **0,0524** | 16.904 | 352 / 620 ms | 50 % |
| B routed | 37 | 252.847 | 606.080 | 0,706 | 0,0603 | 0,0001 | 0,0603 | 31.383 | 6 / 12 ms | 0 % |
| C nativ | 32 | 155.101 | 281.472 | 0,645 | 0,0334 | – | **0,0334** | 18.133 | 3 / 6 ms | – |
| C rebuild | 33 | 215.940 | 169.216 | 0,439 | 0,0396 | 0,0059 | 0,0456 | 17.162 | 420 / 658 ms | 45 % |
| C routed | 32 | 138.095 | 345.024 | 0,714 | 0,0334 | 0,0001 | 0,0335 | 19.670 | 6 / 18 ms | 0 % |
| D nativ | 41 | 353.182 | 857.664 | 0,708 | 0,0832 | – | **0,0832** | 59.118 | 5 / 10 ms | – |
| D rebuild | 29 | 515.619 | 303.168 | 0,370 | 0,0910 | 0,0146 | 0,1056 | 61.209 | 430 / 694 ms | 45 % |
| D routed | 30 | 428.895 | 817.664 | 0,656 | 0,0930 | 0,0006 | 0,0935 | 88.360 | 8 / 410 ms | 6 % |

**Gepoolt A–D:** nativ `0,2316`, rebuild-always `0,2562`, routed `0,2416` USD → routed −5,7 % gegenüber rebuild, +4,3 % gegenüber nativ.

**Routing-Entscheidungen (routed, 140 Dispatches):** Tool-Loop warm 71, `reuse cheaper` 60, `first dispatch` 4, `rebuild cheaper` 3, `cold cache` 1, `gray zone` 1 (Kontinuitätsfrage gestellt). Compiler übersprungen in 127/140. Replay 140/140.

**Must-keep und Qualität (alle 12 Arme korrekt):**
- A: Canary zweimal, `src/`-Regel genannt, README-Auftrag abgelehnt; geändert nur `route.ts` und `cache-routing.ts`.
- B: beide `.env`-Anfragen abgelehnt, Header `x-openrouter-api-key` korrekt, `src/lib/limits.ts` angelegt.
- C: Root Cause `cacheWarmth` Zeile 84 (`<` → `<=`) in allen Armen, 36/1 → 37/0; `docs/NOTES.md` erst auf Signal angelegt.
- D: Canary nach 11-min-Pause, Sprachregel gehalten, drei Präfix-Gründe und Pressure-Formel korrekt.
- Geänderte Dateien je Session in allen drei Armen identisch. Vereinzelte Streu-Token in Antworten („IEntityquis“, „示“) traten armübergreifend auf (Modell, nicht Kontextmutation).
- Ein Provider-Fehler (Finish `error`, eine `synthetic`-Nachricht) im nativen Arm C, unabhängig vom Plugin.

## Befunde

1. **Pressure-Schutz blind.** Regel 2 vergleicht die Plugin-Schätzung der Messages mit `0,8 × 108.000 = 86.400`. In D-routed lag die Schätzung zuletzt bei `31.699`, der Provider meldete `88.360` (Faktor ≈ 2,8). Die Schätzung enthält weder System-Prompt noch Tool-Definitionen, und JSON wie `package-lock.json` tokenisiert deutlich dichter als angenommen. Letzte acht Provider-Prompts: `72.105 → 86.236 → … → 88.360`. Keine OpenCode-Compaction, aber das Kriterium „keine Outgoing-Größe über der Pressure-Schwelle“ ist verletzt.
2. **Rebuild zerstört den Cache.** Rebuild-always kürzt 33–50 %, senkt aber den Cache-Read-Anteil auf `0,37–0,73` (nativ `0,65–0,77`). Bei einem Cache-Rabatt von 80 % und Selector-Kosten von 10–25 % der Agent-Kosten ist das bei `glm-5.3-flash` teurer als nativ.
3. **Routing ≈ nativ.** Mit dem korrigierten Modell kürzt routed fast nie; der Vorteil gegenüber rebuild entsteht durch gesparte Jev-Aufrufe und erhaltenen Cache, nicht durch kleineren Context.
4. **Latenz:** Reuse senkt den Hook p95 von 620–701 ms auf 12–18 ms (A–C).

## Folgeanalyse (kostenlos, nach dem Lauf)

**Neubepreisung mit anderen Modellen.** Die echten Token-Zahlen jedes Assistant-Schritts aus v3 wurden mit Katalogpreisen (models.dev) neu bepreist. Ungecachter Input zählt als Cache-Write, weil Provider mit explizitem Caching schreiben, was sie nicht treffen. Selector-Kosten bleiben real. Annahme: gleiche Treffer wie gemessen.

| Modell (Input / Cache-Read / Output USD/1M) | nativ | rebuild | routed | rebuild vs. nativ | routed vs. nativ | Selector-Anteil rebuild |
| --- | --- | --- | --- | --- | --- | --- |
| glm-5.3-flash (0,15 / 0,03 / 0,5) | 0,232 | 0,256 | 0,242 | +10,7 % | +4,3 % | 15,4 % |
| claude-sonnet-5 (2 / 0,2 / 10) | 3,19 | 3,33 | 3,36 | +4,6 % | +5,4 % | 1,2 % |
| gemini-3.1-pro (2 / 0,2 / 12) | 2,75 | 2,83 | 2,89 | +2,9 % | +5,1 % | 1,4 % |
| gpt-5.6 (4 / 0,4 / 20) | 6,38 | 6,63 | 6,72 | +3,9 % | +5,4 % | 0,6 % |
| claude-opus-5-5 (4 / 0,2 / 20) | 5,90 | 6,39 | 6,26 | +8,2 % | +6,0 % | 0,6 % |
| claude-opus-5 (5 / 0,5 / 25) | 7,97 | 8,28 | 8,40 | +3,8 % | +5,4 % | 0,5 % |
| claude-fable-5-1 (10 / 0,25 / 50) | 14,16 | 15,61 | 15,06 | +10,2 % | +6,3 % | 0,3 % |

- Auch bei Top-Tier-Modellen ist nativ am günstigsten. Die Selector-Kosten sind dort vernachlässigbar (< 1,5 %); das Problem ist nicht Jev, sondern der zerstörte Cache.
- Ungecachte Tokens (claude-opus-5-5-Detail): A und B – rebuild weniger als nativ (167k vs. 196k, 216k vs. 275k) und dadurch günstiger (1,05 vs. 1,24, 1,29 vs. 1,65 USD). C und D – rebuild **mehr** ungecachte Tokens als nativ (216k vs. 155k, 516k vs. 353k), obwohl der Context um 45 % kleiner war. Jede Neukompilierung zwingt den Provider, den geänderten Rest des Prompts neu zu schreiben.
- Je größer der Cache-Rabatt (Fable 5.1: Read 2,5 % des Inputs), desto teurer wird jeder Präfixbruch.
- Einschränkung: eine Kampagne, Arme unterscheiden sich im Agentenverhalten (29–42 Modellnachrichten).

**Echte Token-Werte im Plugin.** Ergebnis der Prüfung der OpenCode-`2.0.13`-Binärdatei:
- Intern gibt es das Event `session.step.ended` mit `tokens` und `cost` je Modellschritt. Plugins können Events aber **nicht** abonnieren; die Plugin-API bietet nur `session.hook(...)` für `context`, `compaction`, `generate`, `prompt`, `title`, `retry`, `model.request`, `http.request`, `http.response`.
- Die Plugin-API bietet aber `ctx.session.context(...)`: „Retrieve the active context messages for a session (all messages after the last compaction)“. Das sind die gespeicherten Nachrichten, in die OpenCode nach jedem Schritt `tokens` und `cost` schreibt. Damit kann das Plugin den echten Provider-Prompt des letzten Schritts lesen, ohne die Datenbank direkt zu öffnen.
- **Live bestätigt** (Diagnoselauf `jev-diag-ctx`, rebuild-Arm, 5 Prompts, 8 Modellschritte, ≈ 0,012 USD): `ctx.session.context({ sessionID })` liefert im `context`-Hook in 1–2 ms ein Array aller Nachrichten seit der letzten Compaction. Jede Assistant-Nachricht trägt `tokens {input, output, reasoning, cache{read, write}}` und `cost`; ihre `id` steht auch in `event.messages`. Damit sind echte Provider-Werte des letzten Schritts vor jedem Dispatch verfügbar.
- Präfixbruch im selben Lauf (neu protokolliert: erste abweichende Nachricht gegenüber dem vorherigen Request desselben Prozesses): Rebuild hielt die bisherigen Nachrichten meist 1:1 (Bruch erst hinter dem alten Ende), einmal brach es direkt nach der ersten Nachricht. Trotzdem meldete der Provider bei identischem Präfix mehrfach `cache.read = 0` bzw. nur `1.280` (auch beim zweiten Schritt desselben Turns). Der Cache von `opencode-go/glm-5.3-flash` trifft also nicht deterministisch; ein Teil des Cache-Verlusts im rebuild-Arm ist Provider-Rauschen.

## Turn-Policy: gebündeltes Kürzen pro User-Turn (Live-A/B)

**Idee:** Ein fester Teil bleibt byte-identisch vorn (System-Prompt, Tools und alles bereits von Jev Bewertete). In der Tool-Schleife wird nur angehängt. Erst bei der nächsten User-Eingabe bewertet Jev den vorherigen Turn mit allen Tool-Aufrufen und kürzt ihn; das Ergebnis bleibt danach eingefroren. Ein Bruch kann so nur hinter dem eingefrorenen Teil entstehen.

**Umsetzung** (`JEV_CACHE_ROUTING=1` + `JEV_CACHE_POLICY=turn`, beide standardmäßig aus):
- `decideTurnRoute` (rein, replaybar): kein/ungültiges Präfix → `full`; echter Prompt ≥ `0,8 × min(Context, 108k)` → `full` (Pressure); kalter Cache → `full`; gleicher User-Turn → `reuse`; neuer User-Turn → `prune`.
- `freezePrefix`: Chunks bis `judgedKey` (letzte von Jev bewertete Nachricht) werden gepinnt, wenn sie gesendet wurden, und gar nicht erst an Jev geschickt, wenn sie entfernt wurden. Chunks danach – der ganze vorherige Turn inklusive Tool-Schleife – sind Kandidaten.
- `lastProviderUsage`: echter Provider-Prompt des letzten Schritts aus `ctx.session.context` plus Output und geschätzte neue Nachrichten danach (in 92–97 % der Dispatches verfügbar).
- Metriken je Dispatch: `turnRoute`, `promptTokens`/`promptTokensReal`, `breakIndex`, `breakTokensEstimate` (Tokens hinter der ersten Abweichung vom vorherigen Request), `prunedTokensEstimate`, `routeInput`/`routeConfig` für das Replay.
- Erster Anlauf (`jev-turn-*`) nach 5 min abgebrochen: `lastSeenKey` fror auch unbewertete Tool-Loop-Schritte ein, Jev bekam nie Kandidaten (0 gekürzt, 0 Selector-Kosten). Korrektur: eigener `judgedKey`.

**Ergebnis `jev-turn2-*`** (Arme nativ und turn, Sessions A–D, gleiche Prompts):

| Session | glm nativ | glm turn | luna nativ | luna turn |
| --- | --- | --- | --- | --- |
| A | 0,0479 | 0,0577 (+20 %) | 0,0229 | **0,0188 (−18 %)** |
| B | 0,0808 | **0,0556 (−31 %)** | 0,0196 | 0,0194 (−1 %) |
| C | 0,0355 | 0,0327 (−8 %) | 0,0156 | 0,0161 (+3 %) |
| D | 0,0894 | 0,1116 (+25 %) | 0,0866 | 0,1183 (+37 %) |
| **Σ A–C** | 0,1642 | **0,1460 (−11 %)** | 0,0581 | **0,0543 (−6,5 %)** |
| **Σ A–D** | 0,2536 | 0,2576 (+1,6 %) | 0,1447 | 0,1727 (+19 %) |

- `gpt-5.6-luna` (Input 0,2 / Cache-Read 0,02 / Write 0,25 USD/1M) cacht verlässlich: Cache-Read nativ 0,96, turn 0,92–0,96. Größter Prompt in A 27,4k → 14,7k.
- Kürzung A–C je Session 2–16k Tokens; Brüche 5–10 je Session, zusammen nur 1,5–2,2k Tokens dahinter. Selector 4–7 % der Agent-Kosten, Hook p95 429–526 ms.
- glm verfehlt den Cache zufällig (A: turn 0,65 vs. nativ 0,73 trotz nur 1,9k Bruch-Tokens); Einzelsessions schwanken ±20–30 %.
- Must-keep 16/16 Arme korrekt, geänderte Dateien je Session in beiden Armen identisch, Replay 100 %, keine Agentenfehler durch das Plugin. Drei Jev-Aufrufe bekamen `HTTP 403` von OpenRouter → sicherer Fallback.

**Session D (Grenzfälle) ist bei beiden Modellen teurer – drei Ursachen:**
1. **`full` nach „kaltem“ Cache bricht einen warmen Cache.** Die TTL 5–10 min stammt aus der glm-Kalibrierung; luna trifft nach 11 min noch (nativ D Cache-Read 0,89). Die Voll-Neubewertung zerstört dann einen noch warmen Prefix.
2. **Pressure-Neubewertung scheitert an der Payload-Grenze.** luna D wuchs in beiden Armen auf 195k Tokens; die Pressure-Regel griff mit echten Werten korrekt (3×), aber der Compiler lehnte `> 256 kB` ab. Im Fehlerfall schickte das Plugin den Originalverlauf – inklusive früher gekürzter Teile (63k Bruch-Tokens). **Behoben** (lokal, nach dem Lauf): Die Turn-Policy sendet im Fehlerfall immer den eingefrorenen Stand; Test ergänzt (`43/43`).
3. **Kompaktierungsgrenze modellabhängig.** OpenCode kompaktierte luna auch bei 195k nicht; `compactionTokens = 108k` ist kein fester Wert (OpenCode-Konfiguration `compaction.buffer`/`reserved`).
- Hook p95 nach der Pause 828–1.237 ms (Voll-Neubewertung aller Chunks) – über dem 700-ms-Ziel.

**Kosten:** erster Anlauf 0,223 USD, `jev-turn2-glm` 0,511 USD, `jev-turn2-luna` 0,317 USD, Diagnoselauf 0,012 USD → ≈ 1,06 USD.

## Turn-Policy für große Kontexte: Retest `jev-turn3-*` und `jev-d2-*`

Stand vor dem Lauf: nur offene Chunks an Jev, Batching (≤ 60 Chunks / 200 kB), Pressure = `0,8 ×` echtes Kontextfenster, `refresh` bei Wachstum mit Kosten-Nutzen-Prüfung, keine Neubewertung allein wegen einer Pause (`47/47` Tests).

### `jev-turn3-*`: Sessions A–D, Arme nativ und turn

| | glm nativ | glm turn | luna nativ | luna turn |
| --- | --- | --- | --- | --- |
| A | 0,0512 | 0,0422 (−17 %) | 0,0260 | 0,0297 (+14 %) |
| B | 0,0703 | 0,0539 (−23 %) | 0,0214 | 0,0174 (−19 %) |
| C | 0,0317 | 0,0297 (−6 %) | 0,0172 | 0,0162 (−6 %) |
| **Σ A–C** | 0,1532 | **0,1258 (−18 %)** | 0,0646 | **0,0632 (−2 %)** |
| D | 0,1319 | 0,0427 | 0,0773 | 0,0470 |

- Der D-Vergleich ist **nicht belastbar**. Die Prompts „Lies … vollständig“ ließen dem Modell die Wahl, und die Arme arbeiteten verschieden: glm-turn nutzte `wc`/`grep` statt vollständiger Reads (Prompt blieb bei 23k, nativ 207k), luna-turn las package-lock gezielt statt ganz (Turn 12: 0,0022 statt 0,0296 USD). Wo luna gleich arbeitete (Turns 0–11), sparte turn ≈ 5 %.
- Technisch war D sauber: keine Payload-Fehler, kein Fallback mit wieder hinzugefügtem Kontext, `refresh` wurde bei 51k angewendet (→ 25k), Replay 100 %, echte Tokens 97 %.
- Fallbacks (alle sicher, eingefrorener Stand gesendet): Jev `HTTP 529`/`403` und zweimal 5-s-Timeout.
- Hook p95 0,4–3,0 s. Gemessen über 141 Jev-Aufrufe: der eigene Hook-Anteil liegt bei typisch 13 ms (max. 203 ms), der Selector-Aufruf zu OpenRouter bei p50 391 ms, p90 867 ms, p95 2,3 s, max. 4,7 s – auch bei einer einzigen Frage. Die Ausreißer kommen vom Provider, nicht von der Payload.

### `jev-d2-*`: D mit festgelegter Tool-Arbeit, 2 Modelle × 2 Wiederholungen

Aufbau: Session D2 = D mit vorgeschriebenen Tool-Aufrufen je Prompt (z. B. „ausschließlich read mit offset=1 limit=1000, offset=1001 limit=1000, kein shell/grep/glob“; Antwort-Prompts „ohne Tools“), Pausen 11/6 min wie D. Drei Arme: nativ, turn, **turnfast** (turn mit `JEV_COMPILE_TIMEOUT_MS=1500`; bei Timeout geht der eingefrorene Stand unverändert raus). Ein Prüfskript vergleicht pro Turn Tool-Name, Datei und bei `read` Offset/Limit über alle Arme.

| Lauf | nativ | turn | turnfast | abweichende Turns |
| --- | --- | --- | --- | --- |
| glm 1 | 0,1245 | 0,0915 (−27 %) | 0,0996 (−20 %) | 10 (turn las Abschnitt 2 doppelt) |
| luna 1 | 0,0728 | 0,0650 (−11 %) | 0,0659 (−9 %) | keine |
| glm 2 | 0,1465 | 0,0482 (**ungültig**) | 0,0839 (−43 %) | 6; 10–12 turn ohne Tools |
| luna 2 | 0,0936 | 0,0638 (−32 %) | 0,0743 (−21 %) | 5 (turn ohne Read) |

Kosten inklusive Jev. Jev kostet ≈ 0,005 USD je Arm und D-Session (6–7 % der Agent-Kosten). Größter Prompt nativ 193–209k, turn 49–155k. Replay 100 %, echte Tokens 96–97 %. Hook p95 turn 3,2–5,0 s, turnfast 1,5 s (3–6 Timeouts je Lauf, dann ohne Kürzung in diesem Turn).

**Must-keep verletzt (Abnahmekriterium 100 %):**

| Lauf / Arm | Fehler |
| --- | --- |
| glm 2 / turn | Turns 10–12 **ohne Tool-Aufruf erfundene Leseergebnisse**: „Beide Aufrufe sind abgeschlossen … 2114 Zeilen“ (richtig 1444), 1417 (1248), 6442 Zeilen und react-dom 19.2.0 (6782, 19.2.8) |
| luna 2 / turn | [4] `cacheWarmth` falsch erklärt; [5] „Ich kann die Datei ohne Tool-Aufruf nicht lesen“ trotz Read-Anweisung; [14] drei Gründe „nicht verlässlich vorhanden“ |
| luna 1 / turn | [14] drei Gründe „im Gesprächsverlauf nicht dokumentiert“ |
| luna 1 / turnfast | [4] `cacheWarmth` falsch erklärt |
| luna 2 / turnfast | [4] Rolle von `cacheWarmth` „nicht ersichtlich“ |
| turn3 luna D / turn | [14] drei falsche Gründe genannt |

glm 1 (alle Arme) und alle nativen Arme waren korrekt; Canary, Sprachregel, Zeilenzahlen und Versionen stimmten in allen übrigen Armen.

**Ursachen:**
1. **Relevanz nur gegen die aktuelle Anfrage.** Jev bewertet einen Chunk gegen den aktuellen User-Turn. Kehrt das Gespräch später zu einem Thema zurück (Turn 4 fragt nach `cacheWarmth` aus dem Read in Turn 1; der Schlussbericht nach den Gründen aus Turn 3), ist der Inhalt weg, und das Modell weiß nicht, dass er existierte.
2. **Gelöschte Tool-Paare lehren das Modell, Tool-Arbeit zu behaupten.** Die Policy entfernt Tool-Aufruf und -Ergebnis vollständig, lässt aber die Antworten („Beide Aufrufe sind abgeschlossen …“) stehen. Der Verlauf zeigt dann Antworten mit behaupteter Lesearbeit ohne einen einzigen Tool-Aufruf; das Modell setzt das Muster fort (glm 2) oder folgert, es dürfe keine Tools nutzen (luna 2 [5]).

**Nächster Umbau (vor erneutem Lauf):**
1. **Platzhalter statt Löschen:** Eine gekürzte Tool-Transaktion behält den Aufruf; nur das Ergebnis wird durch einen festen, byte-stabilen Hinweis ersetzt („Ausgabe von Jev entfernt – bei Bedarf Tool erneut ausführen“). Das Modell sieht weiter, dass Ergebnisse aus Tools stammen, und kann Gekürztes neu lesen.
2. **Assistant-Antworten nie kürzen**, nur Tool-Ergebnisse. Antworten sind klein und enthalten die Schlussfolgerungen; Tool-Ergebnisse tragen den Großteil der Tokens.

## Platzhalter statt Löschen: Smoke-Test und `jev-d3-*` (24. September 2026)

Umbau seit dem Retest: Die Turn-Policy entfernt keine Nachrichten mehr. Gekürzte Tool-Ausgaben werden durch den festen Text `TOOL_OUTPUT_REMOVED` ersetzt, Aufruf und Eingabe bleiben sichtbar. Antworten, Reasoning und User-Nachrichten sind keine Kandidaten (`turn text stays`).

**Smoke-Test** (luna, nur turn-Arm, 6 Prompts: Datei lesen, zweimal Thema wechseln, dann nach der ersten Datei fragen):
- Erster Lauf: Jev bekam **keine einzige Frage** (`selection: []`), nichts wurde gekürzt. Ursache: OpenCode `2.0.13` liefert Tool-Ergebnisse im Hook als eigene `role: "tool"`-Nachricht **ohne `id`** mit `{ type: "tool-result", id, name, result: { type: "text", value } }` (AI-SDK-Form); der Aufruf steht als `tool-call`-Teil im Assistant-Schritt. Die Stub-Logik kannte nur V2-`tool`-Teile (`state.output`), deshalb pinnte `protectTurnText` jede Live-Tool-Ausgabe als „turn text“. Die Form wurde mit einem nur in der Testkopie gepatchten Plugin ermittelt (nur Feldnamen und Typen).
- Fix: `toolPartOf` nimmt die zweite Quelle der Transaktion als Ergebnis (V2 `…:result` oder AI-SDK `message:<i>:part:<j>`), `stubMessage` ersetzt bei `tool-result` das Feld `result` (bzw. `output`) formgleich. Test mit der Live-Form ergänzt (`51/51`).
- Zweiter Lauf: OpenCode akzeptierte die Stubs ohne Fehler. Jev kürzte je Turn die vorige Tool-Ausgabe (381–2.094 Tokens), die Brüche lagen bei 141–189 Tokens hinter dem eingefrorenen Teil. In Turn 5 las das Modell `selector-cache.ts` selbstständig neu und antwortete richtig; Canary korrekt.

**D2 erneut** (Arme nativ und turn, Aufbau wie `jev-d2-*`, je Kampagne ein eigener Compiler-Port):

| Lauf | nativ | turn (inkl. Jev) | Δ | gleiche Tool-Arbeit | größter Prompt nativ → turn | Cache-Read nativ / turn | Hook p95 turn |
| --- | --- | --- | --- | --- | --- | --- | --- |
| glm 1 | 0,1436 | 0,0764 | −47 % | 13/15 (Abweichung nur im nativen Arm) | 205k → 133k | 0,79 / 0,48 | 1.004 ms |
| glm 2 | 0,1154 | 0,0765 | −34 % | 15/15 | 206k → 134k | 0,67 / 0,50 | 936 ms |
| luna 2 | 0,0936 | 0,0736 | −21 % | 15/15 | 193k → 122k | 0,92 / 0,81 | 1.639 ms |
| luna 3 | 0,0936 | 0,0789 | −16 % | 15/15 | 193k → 139k | 0,92 / 0,85 | 923 ms |
| **Σ glm** | 0,2590 | **0,1529** | **−41 %** | | | | |
| **Σ luna** | 0,1872 | **0,1525** | **−19 %** | | | | |

- **Must-keep 8/8 Arme korrekt:** Canary (Turns 4, 13, 14), Sprachregel, Rolle von `cacheWarmth`, drei Präfix-Gründe, Pressure-Formel, alle Zeilenzahlen und `react-dom 19.2.8`. Die Kopien enthalten den neuen Stub-Code, daher nennen einige Antworten „Stub nicht rekonstruierbar“ als Präfix-Grund; das ist korrekt.
- **Keine erfundene Tool-Arbeit:** Jeder turn-Turn hatte exakt die vorgeschriebenen Aufrufe (`d2check.mjs`). In glm 1 wich nur der native Arm ab (Turn 0: Canary per `shell` in eine Datei geschrieben; Turn 6: zusätzlicher Read).
- Je turn-Arm gekürzt ≈ 41–50k Tokens, 7 Brüche mit 6,7–12,5k Tokens dahinter, `refresh` 0–1× angewendet, kein Fallback, Replay 29/29 bzw. 35/35, echte Tokens 97 %. Jev ≈ 0,004 USD je Session (5–6 % der Agent-Kosten).
- glm 1 nativ war mit 37 Modellnachrichten ungewöhnlich teuer; die −47 % enthalten Modellrauschen. Der Cache-Treffer von glm streut weiter stark.
- **Hook p95 923–1.639 ms** über dem 700-ms-Ziel (p50 14–19 ms); Ursache wie im Retest die OpenRouter-Latenz der Selector-Aufrufe. Mit `JEV_COMPILE_TIMEOUT_MS` begrenzbar (turnfast, hier nicht gemessen).
- **Harness-Abbruch:** `jev-d3-luna-1` endete nach Turn 3 mit `database is locked` in der Budgetprüfung (4 Harnesses + 8 OpenCode-Prozesse auf `opencode.db`), nicht im Plugin. Ersetzt durch `jev-d3-luna-3` mit frischem Compiler; der Harness hat jetzt einen Busy-Timeout von 15 s und rechnet bei Lesefehlern mit dem letzten bekannten Stand weiter.

## Entscheidung

**No-Go** (Pressure-Kriterium in v3; im Turn-Policy-Retest Must-keep).

**Platzhalter-Retest `jev-d3-*`: Go für die Turn-Policy** nach dem D2-Kriterium (Must-keep 100 %, vorgeschriebene Tool-Aufrufe in jedem Turn), netto −41 % (glm) bzw. −19 % (luna) inkl. Jev. A–C werden auf Entscheidung des Nutzers nicht erneut gemessen: D2 ist der härteste Fall (Themenwechsel, Pausen, Rückfragen zu früheren Turns, große Reads), und A–C waren schon ohne Platzhalter Must-keep-korrekt. Hook p95 ≈ 0,9–1,6 s statt < 700 ms bleibt als bekannte Einschränkung dokumentiert (OpenRouter-Latenz; begrenzbar mit `JEV_COMPILE_TIMEOUT_MS`). **Phase 6 abgeschlossen.** Flag bleibt standardmäßig aus (separate Produktentscheidung). Die Turn-Policy spart bei gleicher Arbeit netto 9–43 % in D und 2–18 % in A–C, verliert aber Fakten und erzeugt in einem Lauf erfundene Tool-Ergebnisse. Flag `JEV_CACHE_ROUTING` bleibt standardmäßig aus.

## Kosten

v1 inkl. F und Diagnose 1c `0,345 USD`, v2-Start wenige Cent, v3 `0,689 USD` → Schritt 5 gesamt ≈ `1,04 USD`.

Retest Turn-Policy (Agent + Jev): `jev-turn3-glm` 0,454, `jev-turn3-luna` 0,252, `jev-d2-glm-1` 0,316, `jev-d2-luna-1` 0,204, `jev-d2-glm-2` 0,279, `jev-d2-luna-2` 0,232 → ≈ `1,74 USD`.

Platzhalter-Retest (Agent + Jev): Smoke-Tests `jev-smoke-stub-1`, `jev-smoke-shape`, `jev-smoke-stub-2` zusammen 0,016, `jev-d3-glm-1` 0,220, `jev-d3-glm-2` 0,192, `jev-d3-luna-2` 0,167, `jev-d3-luna-3` 0,172, abgebrochenes `jev-d3-luna-1` 0,012 → ≈ `0,78 USD`.

## Reproduktion

Die Kampagnen-Skripte (`prompts.mjs`, `setup.mjs`, `harness.mjs`, `evaluate.mjs`, `summary.mjs`) lagen im Scratchpad der Arbeitssitzung und sind nicht Teil des Repos. Die Rohdaten liegen in `~/.local/share/opencode/opencode.db` (Sessions mit Titel `jev-cache-v1 <Arm>`) und in `%TEMP%\jev-cache-v3\runs.jsonl`. Retest: Sessions mit Titel `jev-turn3-<modell> <Arm>` bzw. `jev-d2-<modell>-<n> <Arm>`, Protokolle in `%TEMP%\jev-turn3-*\runs.jsonl`, `%TEMP%\jev-d2-*\runs.jsonl` und `%TEMP%\jev-d3-*\runs.jsonl` (Smoke-Session `S` in `prompts.mjs`, Gruppe `s` im Harness); D2-Prompts und das Prüfskript `d2check.mjs` liegen ebenfalls im Scratchpad.
