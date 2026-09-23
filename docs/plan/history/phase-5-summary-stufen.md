# Historie: Phase 5 Summary-Stufen

Vollständiges Protokoll von Phase 5 inklusive aller Abnahmen (v1–v8), Ursachenanalysen, Fixes und Kosten. Nur bei Bedarf lesen; das Ergebnis steht im Index.

> Teil des aufgeteilten Plans. Index, Status und Leseregeln: [`Plan.md`](../../../Plan.md). Abschnittsnummern (§) entsprechen dem ursprünglichen Gesamtplan.

### Phase 5: Summary-Stufen

1. [x] Erst nach erfolgreichem `keep/drop` im OpenCode-Praxistest beginnen.
2. [x] Short- und Long-Summaries lokal erzeugen und speichern. Als lokale, deterministische Phase-5-Baseline werden Head/Tail-Varianten nur für ältere, große, nicht gepinnte und nicht sensible Chunks im vorhandenen OpenCode-Plugin-Storage abgelegt; Original, Short und Long bleiben gemeinsam versioniert, werden aber noch nicht versendet.
3. [x] Jev Choice für `drop/short/long/full` evaluiert und mit einer Confidence-Regel kalibriert. Eine raw `short`-Wahl unter `0,50` Confidence wird konservativ auf `long` angehoben. Score bleibt YAGNI, solange die geschlossene Choice-Menge ausreicht.
4. [x] Summary-Kosten in die Nettoersparnis eingerechnet; die lokale extraktive Baseline hat keine Provider-Generierungskosten.
5. [x] Die Stufen vollständig in realen OpenCode-Sessions testen.
   - [x] Aktuelle offizielle OpenCode-V2-Plugin-Dokumentation und das tatsächlich installierte Message-Schema prüfen; keine Annahmen aus älteren Versionen übernehmen.
   - [x] Den vorhandenen `/api/context`-Pfad minimal um Summary-Choice-Ergebnisse erweitern. Der binäre Request und Response bleiben rückwärtskompatibel und weiterhin Default.
   - [x] Im OpenCode-Plugin einen standardmäßig deaktivierten Experimentpfad ergänzen, beispielsweise über `JEV_SUMMARY_LEVELS=1`. Ohne Flag muss das heutige binäre Verhalten byte-for-byte beziehungsweise strukturell unverändert bleiben.
   - [x] `drop`, `short`, `long` und `full` fail-safe auf ausgehende Messages anwenden. Tool-Call und Tool-Result dürfen niemals verwaist werden; bei einer gekürzten Tool-Transaktion muss die gesamte Transaktion durch genau einen normalen Text-Summary ersetzt werden.
   - [x] Pins, User-Turns, aktuelle Fehler, sensible Chunks, unvollständige Tool-Transaktionen und Abhängigkeits-Closure weiterhin vollständig behalten.
   - [x] Bei fehlender oder ungültiger Choice-Antwort, Netzwerkfehler, Timeout, Parserfehler, unzulässiger Message-Form oder Storage-Fehler den vollständigen ursprünglichen Context versenden.
   - [x] Metriken um raw Choice, effektive Stufe nach Confidence-Regel, tatsächlich versendete Tokens, Selector-Kosten und Fallback-Grund ergänzen; keine Transcript-Inhalte oder Secrets in Metriken schreiben.
   - [x] Unit-/Logiktests für Summary-Ersetzung, vollständige Tool-Transaktionen, `short < 0,50 → long`, deaktiviertes Feature-Flag und vollständigen Fallback ergänzen.
   - [x] Drei unabhängige OpenCode-Sessions mit je mindestens 30 Modellnachrichten und Codebase-, Security-, Konfigurations-, Test- und Retrieval-Aufgaben durchgeführt. Wegen der unten dokumentierten Qualitätsfehler bleibt Punkt 5 offen.
   - [x] Netzwerk-, Timeout-, Parser- und Validierungsfehler im OpenCode-Lauf provoziert; Storage-Fehler direkt am echten Plugin-Hook injiziert. In allen Fällen blieb der volle Context erhalten.
   - Erst nach erfüllten Abnahmekriterien Punkt 5 und Phase 5 abschließen; andernfalls Summary-Stufen deaktiviert lassen und das No-Go dokumentieren.

Zwischenstand 22. September 2026: Die fail-safe Summary-Ausgabe ist hinter `JEV_SUMMARY_LEVELS=1` integriert. Ein lokaler API-Smoke-Test, 14 Logiktests, ESLint und der Next.js-Produktions-Build sind erfolgreich. Ausstehend sind der kontrollierte OpenCode-Smoke-/Live-Test sowie die realen Netzwerk-, Timeout- und Parserfehler-Läufe; kostenpflichtige Requests und die Übertragung realer Transcripts erfordern vorher eine ausdrückliche Freigabe. Die binäre Policy bleibt Default.

Ergebnis: technisch funktionsfähige feinere Budgetkontrolle, wegen Qualitätsfehlern nicht für den allgemeinen OpenCode-Einsatz freigegeben.

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

#### Kontrollierte OpenCode-Abnahme am 23. September 2026

OpenCode V2.0.13, `JEV_SUMMARY_LEVELS=1` nur in den Testprozessen, Modell `openrouter/qwen/qwen3-coder-next`, lokaler Compiler. Die drei Sessions liefen in getrennten Kopien ohne `.env`. Ein Smoke-Test lieferte gültige Modellantworten und zwei echte Summary-Dispatches. Die Tabelle zählt erfolgreiche Dispatches mit mindestens einer Choice-Entscheidung; es gab in den drei Sessions keine Fallbacks. Tokenzahlen sind die vorhandene lokale Schätzung (Zeichen/4) für die tatsächlich gewählten ausgehenden Messages, über wiederholte Dispatches summiert. p50/p95 verwenden den Nearest-Rank-Wert.

| Session | Modellnachrichten | Summary-Dispatches / Fallbacks | Inputtokens vor → nach | Median Reduktion | p50 / p95 | Selector USD | Agentersparnis / Netto USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A: Codebase/Refactor | 34 | 35 / 0 | 604.861 → 277.833 | 57,5 % | 496 / 652 ms | 0,02943 | 0,03924 / +0,00982 |
| B: Security/Konfiguration | 32 | 41 / 0 | 168.702 → 51.680 | 76,7 % | 380 / 503 ms | 0,01102 | 0,01404 / +0,00302 |
| C: Test/Retrieval/Root Cause | 31 | 40 / 0 | 265.472 → 98.163 | 79,7 % | 407 / 588 ms | 0,01875 | 0,02008 / +0,00133 |
| Gesamt | 97 | 116 / 0 | 1.039.035 → 427.676 | 68,9 % | 414 / 636 ms | 0,05920 | 0,07336 / +0,01417 |

Die geschätzte Agentersparnis nutzt den am Testtag gelisteten [OpenRouter-Inputpreis für Qwen3-Coder-Next](https://openrouter.ai/qwen/qwen3-coder-next/api) von 0,12 USD pro Million Tokens; Cache-Effekte sind nicht eingerechnet. Die lokale extraktive Summary-Erzeugung kostete 0 USD beim Provider. Die gesamte Testkampagne einschließlich Smoke-, Fehler- und binärer Kontrollläufe verzeichnete 0,19767 USD Agent-Modellkosten und 0,06452 USD Selector-Kosten, zusammen 0,26219 USD laut lokalen Usage-Feldern. Über 604 Choice-Entscheidungen verteilten sich raw `drop/short/long/full` auf `468/64/3/69` und nach der Confidence-Regel auf `468/12/55/69`; eine effektive `long`-Wahl wurde wegen gemeinsam genutzter physischer Message als `full` versendet.

Alle neun Canary-Abfragen, drei Repository-Regel-Abfragen, drei expliziten Sicherheitsconstraint-Abfragen sowie die späte Root-Cause-Abfrage waren korrekt. **Eine Abfrage zum offenen Task-State war falsch:** Session A behauptete nach dem Refactor weiterhin `13/14` bestandene Tests und einen angeblich flakigen Fehler; ohne das nur für den Testprozess geerbte Experimentflag waren tatsächlich `14/14` Tests erfolgreich. Damit ist der verlangte vollständige Erhalt offener Aufgaben- und Verifikationsfakten nicht nachgewiesen.

**Task-Erfolg gegen die binäre Policy verschlechtert:** Der erste Refactor-Auftrag in Session A endete mit der bloßen Ausgabe eines vorherigen Tool-Summary-Extracts und ohne Änderung. Erst ein weiterer User-Turn führte zum korrekten Patch. Eine binäre Kontrollsession mit gleichem Modell, denselben zehn vorangehenden Prompts und derselben Aufgabe erledigte den Patch im ersten Versuch und bestand `14/14` Tests. Im Summary-Lauf schlug zusätzlich ein erster Edit-Tool-Call wegen nicht passendem Suchtext fehl; der zweite Versuch korrigierte ihn. Keine verwaisten Tool-Transaktionen, ungültigen Provider-Sequenzen oder Provider-Retries wurden beobachtet.

Kontrollierte OpenCode-Fehlerläufe für nicht erreichbaren Compiler, Timeout, ungültiges JSON, unvollständige Summary-Choice-Daten und inkonsistente Chunk-Auswahl behielten jeweils den gesamten ursprünglichen Context (Inputtokens vor = nach). Ein direkt am Plugin-Hook injizierter Summary-Storage-Fehler bestätigte denselben Fallback. Metriken enthielten keine Canary- oder Transcript-Texte und weder Metrik- noch Summary-Storage enthielten den API-Schlüssel. Summary-Storage enthält wie vorgesehen lokale Original-/Extraktvarianten.

**No-Go für Phase 5, Punkt 5.** Reduktion, p95, geschätzte Nettoersparnis und Fail-safe erreichten die Ziele, aber Task-State-Treue und Task-Erfolg gegenüber der binären Policy verfehlten die verbindlichen Kriterien. Die Checkbox bleibt offen, `JEV_SUMMARY_LEVELS` bleibt standardmäßig aus und Phase 6 beginnt nicht. Nächster Schritt ist die Ursache der als finale Modellantwort ausgegebenen Tool-Summary und des falschen Verifikationsstatus zu beheben und die Abnahme danach erneut durchzuführen.

## 15. Abnahmeprotokoll als Vorlage für weitere Agenten

### Nachgewiesener Replay-Ausgangspunkt

- Erster Replay: 45 Requests, 70 Entscheidungen, `92,9 %` Mindestdetail-Recall; fünf reproduzierbare `long → short`-Unterselektionen, deshalb No-Go.
- Diagnose: betroffen war `refactor-constraints:tool:shared`; raw `short`, Confidence ungefähr `0,34`.
- Nach Kalibrierung: zweiter unabhängiger Replay mit weiteren 45 Requests und 70 Entscheidungen.
- Ergebnis: `100 %` Mindestdetail-Recall, `93,7 %` mediane Reduktion, p50 `312 ms`, p95 `417 ms`, `0,00249354 USD` Selektorkosten und geschätzter Nettoeffekt `+0,07388646 USD`.
- Entscheidung: Go für einen kontrollierten OpenCode-Live-Test, **noch kein Go für allgemeine Aktivierung**.
- Letzte lokale Prüfung: 14 Tests bestanden, ESLint bestanden, Next.js-Produktions-Build bestanden und lokaler API-Smoke-Test bestanden.

### Ergebnis der realen OpenCode-Abnahme

Der Nutzer hat kostenpflichtige OpenRouter-Requests und die Übertragung nicht sensibler Projektinhalte und Test-Transcripts an OpenRouter sowie über OpenRouter an TypeSafe/Jev ausdrücklich freigegeben. Smoke-Test, drei Langzeitsessions, Fehlerläufe und binäre Kontrollsession wurden durchgeführt. Die fachliche Abnahme scheiterte an einem verlorenen Refactor-Turn und einem falschen Task-State-Fakt; Details stehen in Phase 5.

## 16. Konkreter nächster Arbeitsschritt

**Handoff für einen neuen Chat:** Phase 1 bis 4 und Phase 5 Punkte 1 bis 4 sind abgeschlossen. Die Summary-Stufen sind technisch integriert, aber die reale Abnahme vom 23. September 2026 ergab **No-Go**. Die Messwerte, die binäre Kontrollsession und die genaue Entscheidung stehen in Phase 5. Punkt 5 bleibt offen; `JEV_SUMMARY_LEVELS` bleibt standardmäßig aus.

### Jetzt zu untersuchen

1. **Verlorener Refactor-Turn:** In OpenCode-Session A gab das Modell auf den ersten Refactor-Auftrag nur den Text einer vorherigen `[Previous tool_transaction: short extract]`-Message aus und änderte keine Datei. Ein weiterer User-Turn führte zum Patch. Die binäre Kontrollsession mit gleichem Modell, denselben zehn vorangehenden Prompts und derselben Aufgabe schaffte den Patch beim ersten Versuch. Die Ursache ist noch nicht bewiesen.
2. **Falscher Verifikationsstatus:** Später behauptete Session A, nach Entfernen des geerbten Experimentflags seien weiterhin nur `13/14` Tests erfolgreich und der Fehler sei „flaky“. Tatsächlich bestanden dann `14/14` Tests. Prüfen, ob hier Context-Auswahl, die Darstellung alter Testlogs oder ein unabhängiger Modellfehler verantwortlich war; die beiden Qualitätsfehler nicht ohne Nachweis gleichsetzen.

### Arbeitsfolge im neuen Chat

1. Den vorhandenen Arbeitsbaum und die Phase-5-Messwerte lesen; vorhandene Änderungen an `Plan.md` und die ungetrackte `Plan copy.md` erhalten. Relevante Next.js-16-Dokumente unter `node_modules/next/dist/docs/` vor Codeänderungen lesen.
2. Den ersten Fehler mit einem kleinen, nicht sensiblen OpenCode-Verlauf reproduzieren. In `.opencode/plugins/jev-context.ts` besonders `applySummaryLevels`, die Rolle und Position der erzeugten Assistant-Textmessage sowie den `context`-Hook verfolgen; in `src/lib/context.ts` Kandidaten, Pins und Choice-Ergebnisse prüfen. Nur inhaltsfreie Diagnosemetriken speichern. Die lokalen Testartefakte unter dem temporären Verzeichnis `jev-summary-accept-20260923-v2` können helfen, sind aber keine dauerhafte Projektabhängigkeit.
3. Den falschen Teststatus separat mit demselben Testlog unter Summary- und binärer Policy untersuchen. Das Testkommando muss ohne geerbtes `JEV_SUMMARY_LEVELS=1` laufen, wenn es den binären Default-Pfad prüft. Erwartet sind `14/14` bestandene Context-Tests.
4. Nur die nachgewiesene Ursache minimal im vorhandenen Experimentpfad beheben. Die binäre Default-Policy, vollständige Tool-Transaktionen, Pins und den vollständigen Fallback erhalten. Einen kleinen ausführbaren Regressionstest für den konkreten Fehler ergänzen.
5. Zuerst lokale Tests durchführen. Für einen kurzen nicht sensiblen OpenCode-Smoke-Test und die vollständige Live-Abnahme nach Abschnitt 15 erneut ausdrücklich die Freigabe für kostenpflichtige Requests und Transcript-Übertragung einholen, einschließlich passender binärer Kontrolle. Nur bei allen erfüllten Kriterien Phase 5 Punkt 5 abhaken; sonst No-Go mit Messwerten fortschreiben.

Phase 6, Claude Code, Codex, Datenbank, Cache-Preislogik und generative Summary-Erzeugung bleiben bis zu einem dokumentierten Phase-5-Go außerhalb dieses Arbeitsschritts. Der neue Chat beginnt mit der lokalen Ursachenanalyse; weitere lange Live-Läufe sind vor einem überprüften Fix nicht nötig.

### Lokale Ursachenanalyse am 23. September 2026

- Session A: Unmittelbar vor dem verlorenen Refactor-Turn wurden zwei gerade abgeschlossene `read`-Transaktionen als `short` versendet; die folgende Modellantwort gab einen dieser Extrakte aus. Die Transaktionen wurden als alt eingestuft, weil `normalizeTranscript` für ihre Recency den Turn des Tool-Aufrufs statt des späteren Ergebnisses verwendete. Die verkürzten Ergebnisse im konkreten Dispatch sind belegt; ob allein dies die Modellantwort verursachte, muss der erneute Live-Test zeigen.
- Minimaler Fix in `src/lib/context.ts`: Für eine Tool-Transaktion zählt der spätere Turn von Aufruf und Ergebnis. Ein Regressionstest mit zwei Tool-Aufrufen und getrennten Ergebnissen prüft, dass beide aktuellen Transaktionen vollständig bleiben und keine Summary-Kandidaten sind. Die binäre Default-Policy und der vollständige Fallback bleiben bestehen.
- Verifikationsstatus separat geprüft: Session A enthält nur zwei Testläufe mit geerbtem `JEV_SUMMARY_LEVELS=1`, beide `13/14`. Ein bestandener Lauf nach Entfernen des Flags ist in der Session nicht protokolliert. Derselbe Stand der isolierten Testkopie ergibt ohne Flag `14/14`, mit Flag `13/14`. Die spätere Aussage „13/14, flaky“ war ein unbelegter Modellschluss aus alten Fehlerlogs; ein durch die Context-Auswahl verlorener erfolgreicher Testlog ist damit nicht nachgewiesen.
- Lokale Prüfung nach dem Fix: `15/15` Context-Tests ohne Experimentflag, ESLint und Next.js-Produktions-Build bestanden. Phase 5, Punkt 5 bleibt **No-Go** und `JEV_SUMMARY_LEVELS` bleibt standardmäßig aus. Für einen neuen kostenpflichtigen OpenCode-Smoke-Test und die vollständige Abnahme ist vorab erneut die ausdrückliche Freigabe für Requests und Transcript-Übertragung erforderlich.

### Erneute kontrollierte OpenCode-Abnahme nach dem Recency-Fix

Der Nutzer gab kostenpflichtige OpenRouter-Requests und die Übertragung nicht sensibler Test-Transcripts über OpenRouter an TypeSafe/Jev ausdrücklich erneut frei. Getestet wurde mit OpenCode V2.0.13 und `openrouter/qwen/qwen3-coder-next` in neuen isolierten Kopien ohne `.env`; `JEV_SUMMARY_LEVELS=1` galt nur für Summary-Testprozesse. Ein erster Smoke-Versuch fiel wegen fehlenden Netzwerkzugriffs des lokalen Compilers dreimal vollständig auf Originalcontext zurück. Nach dessen Neustart mit Netzwerkzugriff gelangen drei echte Summary-Dispatches mit gültigen Modellantworten. Die drei folgenden Langzeitsessions hatten keine Fallbacks. Die Tabelle zählt nur erfolgreiche Dispatches mit Choice-Entscheidungen; Tokenzahlen sind lokale Zeichen/4-Schätzungen der gewählten ausgehenden Messages. p50/p95 sind Nearest-Rank-Werte.

| Session | Modellnachrichten | Summary-Dispatches / Fallbacks | Inputtokens vor → nach | Median Reduktion | p50 / p95 | Selector USD | Agentersparnis / Netto USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A: Codebase/Refactor | 33 | 38 / 0 | 479.925 → 262.187 | 46,2 % | 400 / 710 ms | 0,02110 | 0,02613 / +0,00503 |
| B: Security/Konfiguration | 32 | 36 / 0 | 150.128 → 46.809 | 78,2 % | 350 / 433 ms | 0,00967 | 0,01240 / +0,00273 |
| C: Test/Retrieval/Root Cause | 30 | 32 / 0 | 259.156 → 72.094 | 85,4 % | 397 / 547 ms | 0,01707 | 0,02245 / +0,00538 |
| Gesamt | 95 | 106 / 0 | 889.209 → 381.090 | 69,2 % | 387 / 498 ms | 0,04784 | 0,06097 / +0,01314 |

Die geschätzte Agentersparnis verwendet den erneut geprüften [OpenRouter-Inputpreis für Qwen3-Coder-Next](https://openrouter.ai/qwen/qwen3-coder-next/api) von 0,12 USD pro Million Tokens ohne Cache-Effekt. Die Choice-Verteilung über 434 Entscheidungen war raw `drop/short/long/full = 336/64/0/34`, effektiv nach Confidence-Regel `336/5/59/34` und tatsächlich angewandt `297/5/51/81`; gemeinsam genutzte physische Messages wurden konservativ häufiger vollständig behalten. Die Metriken enthielten keine Canary-Texte, Transcript-Inhalte oder API-Schlüssel; auch die lokal gespeicherten Summary-Varianten enthielten den echten API-Schlüssel nicht. In den drei abgeschlossenen Summary-Sessions und der binären Kontrolle A waren alle beobachteten Tool-Parts abgeschlossen; erfolgreiche Modellantworten bestätigten gültige Provider-Sequenzen.

- **Verlorener Refactor-Turn behoben:** Session A führte denselben Refactor nach denselben zehn Vorläufen im ersten Auftrag aus; die frühere Ausgabe eines bloßen Tool-Extrakts trat nicht wieder auf. Die binäre Kontrolle A schaffte denselben Patch ebenfalls im ersten Auftrag. Beide Änderungen rufen `containsSecret(chunk.content)` einmal pro Chunk auf und erhalten das Verhalten.
- **Verifikationsstatus weiterhin fragil:** Session A ließ beim ersten Testaufruf das geerbte Experimentflag entgegen der Anweisung aktiv, meldete `14/15` und nannte den Fehler erneut „flaky“. Erst ein eigener, ausdrücklich flagfreier Testaufruf ergab `15/15`; die spätere Task-State-Abfrage gab `15 pass, 0 fail` korrekt wieder. Die binäre Kontrolle A erreichte `15/15` bereits im ersten Auftrag.
- **Neuer Root-Cause-Fehler:** Session C erinnerte Canary und frühes fehlgeschlagenes Testresultat korrekt, erklärte am Ende aber fälschlich, das Experimentflag sei beim fehlerhaften Test *nicht* gesetzt gewesen, und empfahl es für den erfolgreichen Lauf zu setzen. Beim finalen Summary-Dispatch wurde gerade das frühe Testlog als `full` versendet; dieser Fehler beweist daher keinen Verlust des Logs durch die Context-Auswahl. Die zusätzliche binäre Kontrolle C geriet nach sechs Nutzerfragen in wiederholte `read`-Aufrufe und wurde zur Kostenbegrenzung abgebrochen; sie liefert keinen gültigen Root-Cause-Vergleich.
- Canary- und Repository-Regel-Abfragen in A, Sicherheitsconstraint- und Canary-Abfragen in B sowie Canary und frühes Tool-Result in C waren korrekt. A überschritt mit p95 `710 ms` die Grenze von `< 700 ms` für die einzelne Session. Über die gesamte neue Kampagne einschließlich Smoke und Kontrollen meldeten die lokalen Usage-Felder ungefähr `0,43031 USD` Agent- und `0,08546 USD` Selektorkosten, zusammen `0,51576 USD`; die abgebrochene Kontrolle C ist darin enthalten.

**No-Go für Phase 5, Punkt 5 bleibt bestehen.** Der Recency-Fix beseitigte den reproduzierten unmittelbaren Tool-Extrakt, aber der erneute Lauf verfehlte Root-Cause-Treue, erstmalige Verifikationsqualität gegenüber der binären Kontrolle und in Session A die p95-Grenze. Die Checkbox bleibt offen, das Experimentflag bleibt standardmäßig aus, Phase 6 beginnt nicht. Nächster Schritt: die falsche Root-Cause-Ableitung mit dem vollständig versendeten Testlog als Modell-/Promptverhalten isolieren und die Testprozess-Umgebung im Auftrag eindeutig verifizieren; erst danach einen neuen kontrollierten Qualitätsvergleich planen.

### Lokale Isolierung des Root-Cause-Fehlers

- Im erhaltenen, nicht sensiblen OpenCode-Verlauf C der erneuten Abnahme nennt der erste User-Turn ausdrücklich den Fehler **bei geerbtem Summary-Flag**. Der frühe Tool-Aufruf `npm.cmd run test:context` meldet `14/15`, und der Assertion-Diff zeigt den vollständigen statt des erwarteten gefilterten Contexts. Der Test-Harness startete diese Session mit `JEV_SUMMARY_LEVELS=1`; im Test lieferte der Mock nur binäre `decisions`. Im Summary-Pfad fehlten deshalb `summaryDecisions`, `validateSummaryResult` löste den vollständigen Fallback aus. Das erklärt den fehlgeschlagenen Test ohne „flaky“ Verhalten.
- Die finale Modellantwort behauptete das Gegenteil: Das Flag sei **nicht** gesetzt gewesen und müsse für einen erfolgreichen Lauf gesetzt werden. Der frühe Fehlerlog wurde laut Dispatch-Messung vollständig versendet; auch der frühe Auftrag und die spätere korrekte Erklärung des Flag-Schalters standen im gespeicherten Verlauf. Ein Verlust dieses Logs durch Summary-Auswahl ist damit nicht belegt. Der falsche Schluss ist im beobachteten Output ein Modell-/Promptfehler; ob die binäre Policy denselben Fehler erzeugt, bleibt mangels abgeschlossener Kontrolle C offen.
- Lokale Gegenprobe vor der Testkorrektur: ohne `JEV_SUMMARY_LEVELS` `15/15`, mit `JEV_SUMMARY_LEVELS=1` `14/15`. Der Hook-Test setzt jetzt sein Flag für den ersten binären Abschnitt ausdrücklich auf „nicht gesetzt“, schaltet es für den Summary-Fallback-Abschnitt selbst auf `1` und stellt den ursprünglichen Wert am Ende wieder her. Danach `15/15` sowohl ohne als auch mit geerbtem Flag. Der produktive Plugin-Code und die binäre Default-Policy wurden nicht geändert.
- Für den nächsten kurzen Qualitätsvergleich muss der Auftrag das Flag **für den Testprozess selbst** festlegen und den genauen Befehl, Flag-Wert, Assertion-Diff und Fallback-Grund vor jeder Root-Cause-Antwort nennen. Auf Windows kann der historische Fehler in einer isolierten Kopie mit `cmd /c "set JEV_SUMMARY_LEVELS=1&& npm.cmd run test:context"` und der binäre Gegenlauf mit `cmd /c "set JEV_SUMMARY_LEVELS=&& npm.cmd run test:context"` geprüft werden. Derselbe eingefrorene, nicht sensible Verlauf und dieselbe Frage sind mit Summary- und binärer Policy zu vergleichen; ein falscher Schluss in beiden Läufen wäre kein Nachweis eines Summary-spezifischen Qualitätsverlusts. Dieser kostenpflichtige Vergleich und jede weitere Live-Abnahme brauchen erneut die ausdrückliche Freigabe für Requests und Transcript-Übertragung. Bis dahin bleibt Phase 5, Punkt 5 **No-Go**.

### Kurzer gepaarter Root-Cause-Vergleich nach ausdrücklicher Freigabe

Der Nutzer gab kostenpflichtige OpenRouter-Requests und die Übertragung des eingefrorenen, nicht sensiblen Testverlaufs an OpenRouter/TypeSafe erneut ausdrücklich frei. Zwei neue isolierte OpenCode-Sessions mit `openrouter/qwen/qwen3-coder-next` bekamen dieselben neun User-Prompts und denselben historischen Teststand. Ein kleines lokales `run-flagged-test.cmd` setzte `JEV_SUMMARY_LEVELS=1`, druckte den Wert `1` und startete danach `npm.cmd run test:context` in derselben Shell. In beiden Sessions meldete der Tool-Output `14/15` und den vollständigen Context statt der erwarteten Filterung. Für den OpenCode-Prozess selbst war das Summary-Flag nur im Summary-Arm gesetzt. Der Compiler lief separat mit nachweislich erfolgreichem Jev-Request; beide Arme hatten `17` erfolgreiche Selector-Dispatches und `0` Fallbacks.

| Arm | Selector-Dispatches | Geschätzte Inputtokens vor → nach | Mediane Reduktion | p50 / p95 | Selector USD | Root-Cause-Antwort |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Summary | 17 / 0 Fallbacks | 19.330 → 7.883 | 68,2 % | 310 / 401 ms | 0,00149 | Kernursache richtig, zusätzliche falsche Behauptung zum fehlenden API-Key beim ersten Assertion-Lauf |
| Binär | 17 / 0 Fallbacks | 21.899 → 12.898 | 23,0 % | 297 / 387 ms | 0,00145 | Kernursache richtig, zusätzliche falsche Behauptung, der erfolgreiche historische Mock enthalte `summaryDecisions` |

Im finalen Summary-Dispatch war die frühe Test-Transaktion mit `779` geschätzten Tokens als `full` ausgewählt. Beide Antworten nannten den gedruckten Flag-Wert `1`, die fehlenden `summaryDecisions`, die darauf folgende Validierungsausnahme und den unveränderten Full-Context. Die frühere Inversion „Flag war nicht gesetzt“ trat in diesem gepaarten Versuch nicht auf. Beide Antworten enthielten trotzdem je eine nicht durch Log oder Code gedeckte Zusatzbehauptung; der kurze Vergleich erfüllt deshalb nicht die geforderten `100 %` Root-Cause-Treue und belegt keinen Summary-spezifischen Qualitätsverlust. Das Experiment bleibt standardmäßig aus, Phase 5 Punkt 5 bleibt **No-Go**.

Ausgeschlossene Vorläufe: Ein erster Summary-Start scheiterte am Netzwerk. Ein längerer Summary-Lauf antwortete ohne Selector-Wirkung, weil alle `33` Dispatches nach Timeout vollständig zurückfielen. Nach einem erfolgreichen Neustart des Compilers erreichte ein längerer Summary-Lauf `32/32` erfolgreiche Dispatches und eine korrekte Kernursache, aber seine binäre Kontrolle lief bei der vierten Zwischenfrage in ein Zeitlimit und liefert keinen gepaarten Vergleich. Ein weiterer Kurzstart brach mit Provider-Transportfehler ab. Nur die oben gepaarten Sessions fließen in die Tabelle ein. Die isolierten Testkopien enthielten keine `.env`; Metriken enthalten keine Testtexte oder API-Schlüssel. Ein Summary-Vorlauf legte trotz Leseauftrag eine `ANALYSIS.md` in seiner temporären Kopie an; diese Abweichung wurde nicht als Task-Erfolg gewertet.

Nächster Schritt vor einer erneuten vollen Phase-5-Abnahme: den Root-Cause-Auftrag an die belegbaren Schritte binden und unbelegte Zusatzursachen ausdrücklich als unbestätigt kennzeichnen lassen; dann einen kleinen weiteren gepaarten Qualitätstest mit genauem Pass/Fail-Maß durchführen. Eine komplette Drei-Session-Abnahme ist durch diesen Kurzvergleich nicht ersetzt.

### Lokale Bestandsprüfung und nächster Qualitätsnachweis

Die lokale Prüfung im bestehenden Arbeitsbaum ergab `15/15` Context-Tests sowohl ohne als auch mit geerbtem `JEV_SUMMARY_LEVELS=1`; ESLint und der Next.js-Produktions-Build bestanden. Der vorhandene Recency-Fix und der gegen das geerbte Flag isolierte Hook-Test decken die beiden nachgewiesenen Code- beziehungsweise Testursachen ab. Der gepaarte Root-Cause-Vergleich oben zeigte unbelegte Zusatzbehauptungen in **beiden** Policies, obwohl der entscheidende Testlog im Summary-Arm vollständig vorlag. Ein weiterer Selector-Eingriff ist daraus nicht begründbar.

Vor einer erneuten vollen Abnahme folgt ein kurzer gepaarter Lauf auf demselben eingefrorenen, nicht sensiblen Verlauf mit demselben Modell und identischen Prompts. Der Auftrag verlangt vor jeder Schlussfolgerung die belegten Werte für Testbefehl, Flag im **Testprozess**, Pass/Fail-Zahl, Assertion-Diff und Fallback-Grund; nicht belegte Ursachen sind ausdrücklich als unbestätigt zu markieren. Gewertet werden (a) korrekter Teststatus ohne erfundene Verifikation und (b) ein Refactor-Patch im ersten Auftrag nach den zehn Vorläufen. Ein Arm besteht nur, wenn beide Antworten und der Patch den protokollierten Fakten entsprechen. Der Summary-Arm darf gegenüber dem binären Arm weder einen zusätzlichen User-Turn benötigen noch eine zusätzliche falsche Tatsachenbehauptung enthalten. Beide Arme sind einzeln zu bewerten; gemeinsame Modellfehler sind kein Nachweis für einen Summary-spezifischen Verlust, erfüllen aber auch nicht die `100 %`-Treue.

Kostenpflichtige Requests und Transcript-Übertragung für diesen Vergleich benötigen erneut ausdrückliche Freigabe. Bis zu einem erfolgreichen vollständigen Drei-Session-Nachweis bleibt Phase 5, Punkt 5 offen und `JEV_SUMMARY_LEVELS` standardmäßig aus.

### Gepaarter Task-State-Kurztest und OpenCode-V2-Adapter-Fix

Nach erneuter ausdrücklicher Freigabe wurden vier kurze, gepaarte OpenCode-Sessions mit `openrouter/qwen/qwen3-coder-next` in isolierten Kopien ohne `.env` ausgeführt. Beide Policies erhielten pro Paar identische Prompts. Ein lokaler Test-Shellskriptlauf druckte das Flag `1` und ergab `14/15` (Assertion: tatsächlich 3 statt erwarteter 2 Messages); der zweite druckte `<unset>` und ergab `15/15`. Nur der OpenCode-Prozess des Summary-Arms hatte das Experimentflag gesetzt. Alle ausgewerteten Compiler-Dispatches endeten ohne Fallback; Kandidaten wurden bei Bedarf von Jev bewertet.

Im ersten Paar (je zehn Prompts) nannte der Summary-Arm trotz vollständigem unmittelbarem Tool-Output zunächst weder den gedruckten Flag-Wert noch die richtige Richtung des Assertion-Diffs und behauptete am Ende fälschlich, ein fehlender API-Key habe die Filterung verhindert. Der binäre Arm nannte `1`, `14/15`, 3 statt 2 Messages und später `15/15` korrekt. Die OpenCode-V2-Transaktion lag tatsächlich als `type: "tool"` mit Aufruf und Ergebnis in **einem Assistant-Part** vor; der Adapter hatte diesen Part als gewöhnlichen Assistant-Text normalisiert. Das fehlgeschlagene Testergebnis mit `state.metadata.exit = 1` wurde daher nicht als Fehler gepinnt. Dies ist ein nachgewiesener Adapterfehler, auch wenn die falsche unmittelbare Modellantwort nicht allein dadurch erklärt ist.

Der Adapter bildet diese OpenCode-V2-Parts jetzt als gemeinsame Tool-Transaktion ab und markiert einen beendeten Part mit Fehlerstatus oder Exitcode ungleich null als Fehler. Ein Regressionstest prüft die beobachtete Part-Form und den Pin. Lokal bestehen `16/16` Tests mit und ohne geerbtes Summary-Flag; ESLint und Next.js-Produktions-Build bestehen.

Der anschließende Vier-Prompt-Retest nach dem Fix behielt in beiden Armen die Testzahlen und Flag-Werte korrekt. Der Summary-Arm schrieb in der finalen Root-Cause-Antwort dennoch erneut einen fehlenden API-Key als Ursache hinzu; im Test-Harness war der Mock-Key gesetzt und der fehlende `summaryDecisions`-Wert löste die Validierungsausnahme aus. Der binäre Arm kennzeichnete den nicht direkt aus seinem gelesenen Testlog belegten Validierungsschritt als unbestätigt und erfand keinen fehlenden Key. Summary: 10 erfolgreiche Dispatches, 0 Fallbacks, geschätzte Inputtokens `13.746 → 12.354`, p95 `772 ms`; binär: 16 erfolgreiche Dispatches, 0 Fallbacks, `19.004 → 8.653`, p95 `424 ms`. Dies ist ein kurzer Qualitätstest, keine neue Drei-Session-Abnahme. Die gesamte neue Kampagne einschließlich ausgeschlossener Vorläufe kostete laut lokalen Usage-Feldern ungefähr `0,06066 USD` Agent- und `0,01502 USD` Selector-Requests; ein zusätzlicher API-Smoke-Request kostete `0,00004 USD`.

**No-Go bleibt bestehen:** Trotz behobenem Adapterfehler ist `100 %` Task-State-/Root-Cause-Treue im Summary-Retest nicht erreicht; auch dessen p95 liegt über `< 700 ms`. Ein weiterer Refactor-Kurztest wurde nach diesem bereits entscheidenden Qualitätsfehler nicht gestartet. Der frühere kontrollierte Refactor-Vergleich nach dem Recency-Fix hatte den Patch in beiden Policies im ersten Auftrag erreicht. Phase 5, Punkt 5 bleibt offen, die binäre Policy bleibt Default und `JEV_SUMMARY_LEVELS` bleibt standardmäßig aus.

### Nachanalyse der Key-Behauptung im Task-State-Kurztest

Die Auswertung der gespeicherten Sessions (`statusfix … v4 verified`) widerlegt, dass die Key-Behauptung Summary-spezifisch ist:

- Der fehlgeschlagene Testlog (`783` geschätzte Tokens) ging in **allen 10** Summary-Dispatches als `full` hinaus. Die Context-Auswahl hat nichts Relevantes entfernt.
- Der Log belegte die wahre Ursache nicht. Er zeigte nur den Testnamen `…fails safe without a key` und den Message-Diff (3 statt 2), aber weder `summaryDecisions` noch den `fallbackReason`. Die Testdatei wurde in keiner der beiden Sessions gelesen.
- **Beide** Arme leiteten schon im zweiten Turn einen fehlenden Key aus dem Testnamen ab (binär: „when lacking a key“). Die frühere Aussage, der binäre Arm habe keinen fehlenden Key erfunden, gilt nur für die Schlussantwort.
- Dem Prompt-Set `statusfix` fehlte der Beleg-Prompt zur Plugin-Fallback-Regel. Der letzte Prompt verlangte trotzdem eine Erklärung der fehlenden `summaryDecisions`. Der Summary-Arm verband diese Vorgabe mit seiner eigenen Key-Hypothese aus Turn 2, der binäre Arm kennzeichnete sie als unbelegt. Bei n=1 ist dieser Unterschied Modellvarianz, kein nachgewiesener Policy-Effekt.

Korrektur: Der Hook-Sammeltest ist in drei Tests aufgeteilt (`filters messages in binary mode`, `falls back when summary mode gets no summaryDecisions`, `fails safe without a key`). Jeder prüft Status und `fallbackReason` vor den Messages. Eine Gegenprobe mit einem durchgereichten Flag `1` zeigt jetzt `fallbackReason: 'Compiler returned no summary decisions'` direkt im Assertion-Diff. Lokal bestehen `18/18` Tests mit und ohne geerbtes Flag; ESLint und der Build bestehen. Plugin-Code, Selector und die binäre Default-Policy bleiben unverändert.

Für den nächsten gepaarten Qualitätstest gilt:
- einen eingefrorenen Fehlerlog verwenden, der die Ursache belegt
- keine Prompts, die unbelegte Erklärungen verlangen
- alle Zwischenantworten bewerten
- mindestens drei Wiederholungen pro Arm

Das No-Go für Phase 5, Punkt 5 bleibt bestehen, unter anderem wegen p95 `772 ms` im Summary-Retest. Kostenpflichtige Läufe brauchen erneut ausdrückliche Freigabe.

### Gepaarter Beleg-Test v5 (3 Läufe pro Arm)

Freigabe durch den Nutzer: kostenpflichtige Requests und Übertragung des nicht sensiblen Testverlaufs.

**Aufbau**
- Zwei isolierte Kopien ohne `.env` und ohne `Plan.md` unter `%TEMP%\jev-summary-accept-20260923-v5`, Modell `openrouter/qwen/qwen3-coder-next`.
- Eingefrorener Fehler: Der aufgeteilte Hook-Test reicht das Flag durch. `run-flagged-test.cmd` druckt `1` und ergibt `17/18`, der Diff zeigt `fallbackReason: 'Compiler returned no summary decisions'`. `run-clear-test.cmd` druckt `<unset>` und ergibt `18/18`.
- Sechs Prompts: flagged-Lauf, Abruf ohne Tools, README-Lektüre, `fallbackReason` ohne Tools, clear-Lauf, Schlussbericht. Kein Prompt verlangt eine unbelegte Erklärung.
- Die Arme wechselten sich ab. Bewertet wurden alle Zwischenantworten.

**Ausgeschlossener Vorlauf:** Der erste Summary-Lauf arbeitete im echten Projekt statt in der Kopie. Die Git-Bash-Umgebung hatte `PWD` weitergegeben. Im Projekt wurde nur gelesen und getestet, `git status` blieb unverändert. Der Harness setzt `PWD` jetzt auf die Kopie und bricht bei falschem Workspace ab.

**Qualität (alle Zwischenantworten)**

| Arm | Lauf | Flag `1` korrekt | `17/18`, Testname, Diff | `fallbackReason` (P4) | `<unset>`, `18/18` | Falsche Tatsachenbehauptung |
| --- | --- | --- | --- | --- | --- | --- |
| Summary | r1 | nein: „nicht sichtbar“ in P1–P3 und P6 | ja | ja | ja | Flag-Wert als nicht gezeigt behauptet |
| Summary | r2 | ja | ja | ja | ja | keine |
| Summary | r3 | ja | ja | ja | ja | P2: Output sei „truncated“ gewesen |
| Binär | r1 | nein: `binary` erfunden, später „exit code prefix“ | ja | ja | ja | erfundener Flag-Wert |
| Binär | r2 | P1/P2 ja, P3 „none printed“ | ja | ja | ja | P3: Flag nicht gedruckt |
| Binär | r3 | nein: „not shown“ in P1–P3 und P6 | ja | ja | ja | Flag-Wert als nicht gezeigt behauptet |

- Die Zeile `1` stand in jedem flagged-Tool-Output an erster Stelle.
- Keine Antwort nannte einen fehlenden API-Key.
- Die belegte Ursache `Compiler returned no summary decisions` nannten alle sechs Läufe korrekt, in P4 und im Schlussbericht.
- Die P2-Frage nach dem Grund für den vollen Context haben beide Arme gleich missverstanden, als Frage nach dem Belegumfang. Sie ist nicht gewertet.

**Ergebnis Qualität:** Summary 1/3 fehlerfrei (r2), binär 0/3. Der Summary-Arm enthielt keine zusätzliche falsche Behauptung gegenüber dem binären Arm und brauchte keinen zusätzlichen User-Turn. Ein Summary-spezifischer Qualitätsverlust ist damit nicht belegt. Dass die Ursache jetzt im Log steht, hat die frühere Key-Fehlableitung vollständig beseitigt. Die `100 %`-Treue erreicht aber keiner der Arme, weil das Modell den gedruckten Flag-Wert unzuverlässig liest.

**Messwerte der gültigen Läufe**

| Arm | Dispatches / Fallbacks | Inputtokens vor → nach | Mediane Reduktion | Hook p50 / p95 | Selector USD |
| --- | ---: | ---: | ---: | ---: | ---: |
| Summary | 47 / 0 | 201.860 → 95.373 | 51,2 % | 370 / 525 ms | 0,01602 |
| Binär | 50 / 0 | 165.941 → 72.890 | 44,4 % | 347 / 470 ms | 0,00910 |

- Der Summary-Lauf r2 lag mit p95 `744 ms` einzeln über `< 700 ms`. Die gepoolte p95 von `525 ms` liegt darunter.
- Agentkosten der sechs gültigen Sessions: etwa `0,083 USD`.
- Gesamte v5-Kampagne einschließlich Vorlauf: etwa `0,152 USD` Agent und `0,062 USD` Selector.

**Entscheidung:** Phase 5, Punkt 5 bleibt **No-Go**. Der Summary-spezifische Verdacht aus dem Kurztest ist ausgeräumt. Die `100 %`-Treue scheitert am Modell, und das in beiden Policies. Eine einzelne Summary-Session überschritt die p95-Grenze. Eine vollständige Drei-Session-Abnahme nach Abschnitt 15 steht weiterhin aus.

Nächster Schritt: den Flag-Wert im Testskript eindeutig beschriften, etwa `JEV_SUMMARY_LEVELS=1` statt einer bloßen `1`, damit die Modellunsicherheit bei der Flag-Erkennung nicht die Policy-Bewertung überlagert. Danach die volle Abnahme mit erneuter Freigabe durchführen.

### Volle Abnahme v6 (Abschnitt 15) und Pin-Fix für laufende Arbeit

Freigabe durch den Nutzer: kostenpflichtige Requests und Übertragung nicht sensibler Test-Transcripts.

**Aufbau**
- Isolierte Kopien unter `%TEMP%\jev-accept-v6`, ohne `.env` und `Plan.md`. `node_modules` ist per Junction verknüpft.
- Die Original-Prompts der ersten Abnahme: A 20, B 30, C 27. Angepasst sind nur Prompts, die unbelegte Erklärungen verlangten oder auf den alten Test verwiesen.
- Die Testskripte drucken `JEV_SUMMARY_LEVELS=1` bzw. `JEV_SUMMARY_LEVELS=<unset>`.
- Jede Session A–C lief einmal mit Summary-Stufen und einmal als binäre Kontrolle.
- Der Harness setzt `PWD` auf die jeweilige Kopie, bricht bei falschem Workspace ab und hat Budgetgrenzen.

**Fehlerfälle** (Summary-Flag aktiv, je 4 Prompts):

| Fall | Fallbacks | Grund | Messages unverändert |
| --- | ---: | --- | --- |
| Compiler nicht erreichbar | 7 | `Unable to connect` | ja |
| Timeout (Antwort nach 8 s) | 11 | `The operation timed out.` (p95 `5004 ms`) | ja |
| Ungültiges JSON | 11 | JSON Parse error | ja |
| Unvollständige `summaryDecisions` | 5 | `incomplete summary decisions` | ja |
| Inkonsistente Auswahl (unbekannte ID) | 7 | `incomplete summary decisions` | ja |
| Storage-Fehler (nur in Kopie injiziert) | 7 | `Summary storage failed` | ja |

- In jedem Fall wurde der vollständige Originalcontext versendet.
- Die wenigen Dispatches mit Status `compiled` in diesen Sessions hatten keine Summary-Kandidaten. Ihre Tokenzahl blieb unverändert.

**Sessions**

| Session | Modellnachrichten | Dispatches / Fallbacks | Mediane Reduktion | Selector p50 / p95 | Must-keep-Fakten |
| --- | ---: | ---: | ---: | ---: | --- |
| A Summary | 88 | 77 / 0 | 57,6 % | 528 / 694 ms | Canary und Regel 4/4, Patch korrekt, Test `18/18` |
| A binär | 51 | 45 / 0 | 47,6 % | 390 / 616 ms | Canary und Regel 4/4, Patch korrekt, Test `18/18` |
| B Summary | 62 | 50 / 0 | 74,9 % | 381 / 478 ms | Canary 3/3, Constraint 3/3 |
| B binär | 63 | 47 / 0 | 82,7 % | 367 / 468 ms | Canary 3/3, Constraint 3/3 |
| C Summary | 40 | 28 / 0 | 27,0 % | 404 / 507 ms | Abbruch nach Prompt 12 |
| C binär | 45 | 39 / 0 | 39,4 % | 380 / 554 ms | Abbruch nach Prompt 9 |

- **Session B:** Beide Arme halluzinierten gleichermaßen Code-Details wie Header-Name, Env-Variable und Testname, teils direkt nach dem Lesen der Datei. Das ist kein Summary-Effekt.
- **Session C:** Der Provider unterbrach in beiden Armen Antworten, OpenCode meldete „previous response was interrupted“ und beendete sich mit Exit 1. Das Plugin meldete keinen Fallback. Beide Sessions sind unvollständig und für die Root-Cause-Frage nicht gewertet. Bis zum Abbruch stimmten Flag-Zeile, `17/18`, Diff und `fallbackReason` in beiden Armen.

**Summary-spezifischer Fehler in Session A**
- Der erste Edit gelang. Danach versuchte das Modell denselben Edit noch 16-mal, obwohl eine erneute Leseoperation bereits den neuen Code zeigte. Die Aufgabe wurde im selben User-Turn doch noch erfüllt, kostete aber 37 zusätzliche Modellnachrichten.
- Ursache laut Rekonstruktion der Dispatches: Tool-Schritte des *laufenden* User-Turns waren nur gepinnt, wenn sie zu den letzten zwei Messages gehörten. OpenCode speichert jeden Schritt als eigene Message. Deshalb bewertete der Selector den erfolgreichen Edit mit Confidence 0,19–0,37 als `drop`.
- Gleichzeitig blieben die beiden alten Leseoperationen von `route.ts` als „sensitive content“ vollständig gepinnt, weil die Datei Secret-Muster enthält. Das Modell sah also nur den alten Code.

**Fix in `src/lib/context.ts`**
- `normalizeTranscript` pinnt jetzt alle Chunks ab dem aktuellen User-Turn mit dem Grund `current task work`. Das setzt die Regel aus Abschnitt 5 um: aktive, noch nicht verifizierte Änderungen werden nie entfernt.
- Die Regel gilt für beide Policies und ist rein konservativ: Sie kann Context nur behalten, nie entfernen.
- Ein Regressionstest bildet die beobachtete OpenCode-V2-Form nach: Edit gefolgt von drei weiteren Schritten.
- Eine Rekonstruktion des echten Verlaufs A zeigt den Edit und alle Schritte des laufenden Auftrags jetzt als gepinnt.
- Lokal bestehen `19/19` Tests mit und ohne Flag. ESLint und der Build bestehen.

**Entscheidung:** v6 ist **No-Go**. Der Loop in Session A war ein Summary-spezifischer Qualitätsfehler, jetzt behoben, und Session C ist unvollständig. Die Fehlerfälle erfüllen die Fail-safe-Anforderung vollständig und müssen nicht wiederholt werden.

Als Nächstes folgt ein v7-Lauf der Sessions A–C in beiden Armen mit dem Fix. Die Kopien liegen unter `%TEMP%\jev-accept-v7`. Der Harness wiederholt einen Prompt nach einem Transportabbruch einmal.

Kosten v6: etwa `0,555 USD` Agent und Selector zusammen.

### Volle Abnahme v7 mit Pin-Fix

Gleicher Aufbau wie v6, frische Kopien unter `%TEMP%\jev-accept-v7`, beide Arme mit dem Fix `current task work`. Keine Transportabbrüche, keine Prompt-Wiederholungen, keine Fallbacks.

| Session | Modellnachrichten | Dispatches | Mediane Reduktion | Selector p50 / p95 | Must-keep-Fakten | Task |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| A Summary | 53 | 45 | 41,5 % | 402 / 570 ms | Canary und Regel 4/4, Flag-Zeile, `19/19` | Patch korrekt und minimal, 1 Edit |
| A binär | 53 | 44 | 37,8 % | 415 / 582 ms | Canary und Regel 4/4, Flag-Zeile, `19/19` | Patch funktioniert, aber mit zusätzlichem `containsSecret`-Aufruf in `isChunk` |
| B Summary | 62 | 39 | 73,0 % | 343 / 413 ms | Canary 4/4, Constraint 3/3, `.env` abgelehnt | – |
| B binär | 62 | 41 | 77,1 % | 375 / 451 ms | Canary 3/3, Constraint 3/3, `.env` abgelehnt | – |
| C Summary | 79 | 74 | 62,1 % | 568 / **767** ms | Canary 4/4, `fallbackReason`, offene Aufgabe, `18/1` und `19/0`, Root Cause korrekt | – |
| C binär | 77 | 56 | 52,8 % | 489 / 663 ms | Canary 3/3, `fallbackReason`, offene Aufgabe, `18/1` und `19/0`, Root Cause korrekt | – |

**Qualität**
- Der Refactor-Loop aus v6 trat nicht mehr auf.
- Keine Antwort nannte einen fehlenden API-Key.
- Detailfehler traten in beiden Armen gleich häufig auf: in B halluzinierte Header- und Env-Namen, in A ein falsch benannter Variablenname in der Patch-Beschreibung (Summary), in C die Zeile der fehlschlagenden Assertion (Summary).

**Gepoolt über alle erfolgreichen Dispatches**

| Arm | Dispatches / Fallbacks | Inputtokens vor → nach | Mediane Reduktion | Selector p50 / p95 | Selector USD | Geschätzte Agentersparnis / Netto USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Summary | 158 / 0 | 2.266.435 → 1.024.848 | 61,2 % | 457 / **700** ms | 0,12978 | 0,14899 / +0,01921 |
| Binär | 141 / 0 | 2.073.110 → 1.063.729 | 50,5 % | 419 / 610 ms | 0,09171 | 0,12113 / +0,02942 |

Kosten der v7-Kampagne: etwa `0,739 USD`.

**Abgleich mit den Kriterien aus Abschnitt 15**

| Kriterium | Ergebnis |
| --- | --- |
| `100 %` Must-keep-Fakten | erfüllt |
| Keine verwaisten Tool-Paare oder ungültigen Sequenzen | erfüllt, 0 Fallbacks, alle Antworten erfolgreich |
| Task-Erfolg und Patch-Qualität nicht schlechter als binär | erfüllt, Patch sogar besser |
| Fehlerfälle liefern vollständigen Context (v6) | erfüllt |
| Mediane Reduktion ≥ `40 %` | erfüllt, `61,2 %` |
| Positive Nettoersparnis | erfüllt, `+0,019 USD` |
| Drei Sessions mit ≥ 30 Modellnachrichten | erfüllt |
| p95 < `700 ms` | **nicht erfüllt**: gepoolt genau `700 ms`, Session C einzeln `767 ms` |

**Entscheidung: No-Go allein wegen der Latenz.** Alle Qualitäts-, Sicherheits- und Kostenkriterien sind erfüllt. Die Checkbox bleibt offen und `JEV_SUMMARY_LEVELS` bleibt standardmäßig aus.

Die Latenz steigt mit der Zahl der Kandidaten pro Dispatch. In C wurden in 74 Dispatches 1.249 Einzelentscheidungen erneut bei Jev angefragt, weil jeder Dispatch alle älteren Kandidaten neu bewertet. Der nächste Schritt ist eine Latenzoptimierung ohne Qualitätsverlust, danach nur eine erneute Latenzmessung.

### Selector-Cache und Latenz-Nachlauf v8

**Cache**
- Neues Modul `src/lib/selector-cache.ts`, eingebunden in `/api/context`. Die Route fragt Jev nur noch nach Fragen, die noch nicht beantwortet sind.
- Der Schlüssel ist ein SHA-256-Hash aus Modus, API-Key, Modell, vollständigem Anfrage-State und vollständiger Frage mit Kandidateninhalt. Eine Antwort wird also nur bei exakt gleicher Anfrage und gleichem Chunk wiederverwendet, praktisch innerhalb eines Agent-Turns.
- Einträge verfallen nach 30 Minuten, höchstens 5.000 werden gehalten. Der Cache ist prozesslokal, passend zur einzelnen lokalen `next start`-Instanz.
- Gespeichert werden nur Antworten, die eine gültige Auswahl ergeben haben. Bei einem Jev-Fehler greift wie bisher der vollständige Fallback.
- Die Plugin-Metrik enthält jetzt `selectorCachedQuestions`.
- Neuer Unit-Test. Lokal bestehen `20/20` Tests mit und ohne Flag, ESLint und der Build bestehen.

**Nachlauf** (nach ausdrücklicher Freigabe): Session C in beiden Armen, frische Kopien unter `%TEMP%\jev-accept-v8`. Die Tests zeigen jetzt `19/1` mit Flag und `20/0` ohne.

| Session | Modellnachrichten | Dispatches / Fallbacks | Mediane Reduktion | Jev-Aufrufe p50 / p95 | Hook p95 (alle Dispatches) | Fragen aus Cache | Selector USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| C Summary | 68 | 62 / 0 | 71,3 % | 481 / 626 ms | 593 ms | 396 / 727 | 0,02048 |
| C binär | 77 | 58 / 0 | 73,7 % | 500 / 678 ms | 663 ms | 426 / 909 | 0,02809 |

- Session C Summary lag in v7 noch bei p95 `767 ms` und `0,098 USD`.
- Beide Arme nannten alle Must-keep-Fakten korrekt: Canary 3/3, Flag-Zeilen, `19/1` und `20/0`, `fallbackReason`, offene Aufgabe. Die Root Cause war ohne erfundene Ursachen hergeleitet.

**Gepoolte Summary-Abnahme:** A und B aus v7 (mit Pin-Fix, ohne Cache), C aus v8 (mit Cache).

| Dispatches / Fallbacks | Mediane Reduktion | Summe Reduktion | Jev-Aufrufe p50 / p95 | Hook p95 | Selector USD | Geschätzte Ersparnis / Netto USD |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 146 / 0 | 64,4 % | 58,8 % | 395 / 582 ms | 575 ms | 0,05238 | 0,09284 / +0,04047 |

Der Cache ändert keine Auswahlentscheidung, er verhindert nur erneute identische Fragen. A und B können dadurch höchstens schneller werden, deshalb ist die Kombination konservativ.

**Kriterien:**
- `100 %` Must-keep-Fakten: erfüllt.
- Keine ungültigen Sequenzen: erfüllt.
- Task- und Patch-Qualität nicht schlechter als binär: erfüllt.
- Fehlerfälle mit vollständigem Context (v6): erfüllt.
- Reduktion ≥ `40 %`: erfüllt.
- Positiver Nettoeffekt: erfüllt.
- p95 < `700 ms`: erfüllt.
- Drei Sessions mit ≥ 30 Modellnachrichten: erfüllt.

**Entscheidung: Go für Phase 5, Punkt 5.** Die Checkbox ist gesetzt. `JEV_SUMMARY_LEVELS` bleibt standardmäßig aus, bis eine separate Produktentscheidung es aktiviert. Die binäre Policy bleibt Default. Phase 6 darf beginnen.

Kosten v8: etwa `0,19 USD`. Kosten aller Kampagnen dieses Arbeitsschritts (v5–v8): etwa `1,70 USD`.
