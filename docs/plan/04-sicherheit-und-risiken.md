# Sicherheit, Datenschutz und Risiken

Verbindliche Sicherheitsgrenzen und bekannte Risiken. Immer lesen.

> Teil des aufgeteilten Plans. Index, Status und Leseregeln: [`Plan.md`](../../Plan.md). Abschnittsnummern (§) entsprechen dem ursprünglichen Gesamtplan.

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
