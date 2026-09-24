# Wiedereinstieg nach Phase 6 (Stand 24. September 2026)

Kurzer Startpunkt für die nächste Sitzung. Messwerte und Begründungen stehen in [`history/phase-6-live-ab.md`](history/phase-6-live-ab.md) („Platzhalter statt Löschen“), der Phasenstand in [`agents/opencode.md`](agents/opencode.md) unter „Phase 6“.

## Wo wir stehen

- **Turn-Policy mit Platzhaltern: Go** (`JEV_CACHE_ROUTING=1` + `JEV_CACHE_POLICY=turn`, beide standardmäßig aus). D2 erneut, 2 Modelle × 2 Läufe: Must-keep in allen 8 Armen korrekt, jeder turn-Turn mit exakt den vorgeschriebenen Tool-Aufrufen, keine erfundenen Leseergebnisse. Netto inkl. Jev: glm −41 %, luna −19 %.
- Gekürzte Tool-Ausgaben werden durch `TOOL_OUTPUT_REMOVED` ersetzt, Aufruf bleibt sichtbar; Antworten, Reasoning und User-Nachrichten sind nie Kandidaten. Das Modell liest Gekürztes bei Bedarf selbst neu (Smoke-Test).
- **Fehler beim Smoke-Test gefunden und behoben:** OpenCode `2.0.13` liefert Tool-Ergebnisse live als eigene `role: "tool"`-Nachricht ohne `id` (`{ type: "tool-result", id, name, result: { type: "text", value } }`), nicht als V2-`tool`-Teil. Die Stub-Logik griff dadurch vorher nie. Fix in `toolPartOf`/`stubMessage` (`.opencode/plugins/jev-context.ts`), Test mit der Live-Form.
- Stand: `51/51` Context-Tests, `tsc`, ESLint, Build grün.

## Entscheidung und nächster Schritt

- **Phase 6 abgeschlossen** (24. September 2026). A–C werden auf Entscheidung des Nutzers nicht erneut gemessen: D2 ist der härteste Fall, und A–C waren schon ohne Platzhalter Must-keep-korrekt.
- Bekannte Einschränkung: Hook p95 im turn-Arm 0,9–1,6 s (Ziel < 700 ms), verursacht durch OpenRouter-Latenz der Selector-Aufrufe (p50 14–19 ms). Begrenzbar mit `JEV_COMPILE_TIMEOUT_MS=1500`.
- Flag bleibt standardmäßig aus (separate Produktentscheidung).
- **Nächster Schritt: Phase 7A – Claude Code** ([`agents/claude-code.md`](agents/claude-code.md)).

Offene Punkte zur Open-Source-Bereitschaft (CI-Tests, Kampagnen-Skripte, Aufräumen): [`open-source-todo.md`](open-source-todo.md).

## So startet man die Läufe

Kampagnen-Skripte (nicht im Repo, keine Secrets): `%TEMP%\jev-campaign-scripts\`. Im Git-Bash:

```bash
cd "$TEMP/jev-campaign-scripts"
# Compiler-Server: je Kampagne ein eigener Port (sonst teilen Läufe den Selector-Cache)
#   cd /d/Tools/Jev-Explainend && npx next start -p 3418
# Port prüfen: netstat meldet deutsch ("ABHÖREN"), daher:
#   netstat -ano | grep -a -E ":3418 " | grep -a -v WARTEND
# Frische Kopien (Ordnername darf noch nicht existieren)
CAMPAIGN=jev-d4-glm-1 SESSIONS=D2 ARMS=native,turn node setup.mjs
# Lauf (liest OPENROUTER_API_KEY aus der .env, gibt ihn nie aus)
CAMPAIGN=jev-d4-glm-1 SESSIONS=D2 ARMS=native,turn TURN_PORT=3418 BUDGET_FACTOR=2 \
  node --env-file=/d/Tools/Jev-Explainend/.env harness.mjs d2
# luna: zusätzlich MODEL=opencode-go/gpt-5.6-luna
# Smoke-Session (6 Prompts, ≈ 0,005 USD): SESSIONS=S ARMS=turn … harness.mjs s
# Auswertung
CAMPAIGN=jev-d4-glm-1 node evaluate.mjs 2>/dev/null | node compact.mjs glm-1
CAMPAIGN=jev-d4-glm-1 node d2check.mjs
```

- `harness.mjs` erkennt das Turn-Ende über `idle` in `session_message` und protokolliert nach `%TEMP%\<CAMPAIGN>\runs.jsonl`. Seit dem 24. September mit 15-s-Busy-Timeout auf `opencode.db`; bei Lesefehlern rechnet die Budgetprüfung mit dem letzten bekannten Stand weiter (vorher Abbruch mit `database is locked` bei 4 parallelen Kampagnen).
- `compact.mjs` zeigt je Arm Kosten, Cache-Read, größten Prompt, Brüche, Kürzung, Refresh, Fallbacks, Hook-p95 und Replay.
- `d2check.mjs` vergleicht pro Turn die Tool-Aufrufe aller Arme und summiert Kosten nur über identische Turns.
- `evaluate.mjs --answers=…` kürzt lange Antworten; Schlussberichte bei Bedarf direkt aus `session_message` lesen.
- Session D2 hat Pausen von 11 und 6 min (Cache-Ablauf); ein Lauf dauert ≈ 20–25 min.
- Server nach dem Test beenden (PID per netstat wie oben, dann `taskkill //PID <pid> //T //F`).
