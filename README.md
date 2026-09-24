# Jev Smart Context

**A local Smart Context compiler for coding agents — Jev decides what is relevant, deterministic code decides what is safe.**

Every model call sends the agent's full conversation and tool history again. Most of it is tool output (file reads, command results) that was needed once and never again. This project decides, once per user turn, which of those outputs the model still needs and replaces the rest with a short placeholder. That cuts input tokens and context-window pressure and keeps the provider's prompt cache warm, without losing requirements, security rules, decisions or open work.

Built on the [Jev Explained](https://github.com/davila7/jev-explained) playground and [TypeSafe's Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) (`typesafe/jev-1.13` via the [OpenRouter Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request)).

## The idea: Meta-Attention, once per turn

Context is not static. When the user starts a new turn, the tool work of the previous turn is re-evaluated against the new request:

```text
new user turn
      ↓
freeze everything already judged      ← byte-identical prefix, provider cache stays warm
      ↓
open chunks: previous turn's tool outputs
      ↓
deterministic prefilter               ← pins, duplicates, secrets, size — no model cost
      ↓
Jev relevance questions               ← one noul question per candidate, batched, cached
      ↓
dependency closure                    ← transitively keep referenced chunks
      ↓
placeholders for dropped outputs      ← tool call stays visible, output becomes a fixed stub
      ↓
OpenCode (Claude Code / Codex planned)
```

Inside a tool loop nothing is judged: new messages are only appended, and the warm prefix is reused without a compiler or Jev call. Once judged, content stays frozen, so the prompt can only change behind the frozen prefix.

The division of labor is strict:

- **Jev** evaluates semantic relevance and uncertainty for closed questions (noul / choice / score primitives, calibrated probabilities, typically ~0.4 s per call via OpenRouter).
- **Code** owns everything determinism can solve: token counting, budgets, dependencies, cache economics and security rules. Jev is never a security boundary.

### What is never pruned

- System, developer and repository instructions
- User messages, assistant answers and reasoning — only tool outputs are candidates
- Every tool call itself; a pruned output is replaced by `[Tool output removed by Jev context pruning to save tokens. Run the tool again if you need this content.]`, so the model knows what it read and re-runs the tool when it needs the content again
- Tool work of the current turn and the most recent messages
- The last error state and failed tool calls, unfinished tool transactions
- Secrets and sensitive content — detected locally, never sent externally
- Anything under 100 estimated tokens (cheaper to keep than to classify)

### Fail-safe by default

A missing API key, network error, timeout (`JEV_COMPILE_TIMEOUT_MS`, default 5 s), oversized payload or malformed selector response never breaks the agent task. With the turn policy the frozen state is sent unchanged and removed context is never re-added; in the default per-call mode the complete original context is sent. The selector may fail; the agent task must not.

## What is in this repo

| Piece | Path | What it is |
| --- | --- | --- |
| **Compiler core** | `src/lib/context.ts` | Chunk model, pins, deterministic prefilter, selector request builders, dependency closure, summary variants, fail-safe compilation |
| **Cache routing** | `src/lib/cache-routing.ts` | Model pricing, cache warmth, reuse/rebuild decision and the turn policy (`decideTurnRoute`), all pure and replayable |
| **Compiler endpoint** | `src/app/api/context/route.ts` | Validated `/api/context` route: pins secrets locally, calls Jev, caches identical selector answers, falls back safely |
| **OpenCode plugin** | `.opencode/plugins/jev-context.ts` | OpenCode V2 `context` hook: builds chunks from the outgoing messages, freezes the sent prefix, calls the compiler, replaces only the model-bound message array |
| **Context Lab UI** | `src/app/context/`, `src/components/ContextLab.tsx` | Replay a realistic coding session against a new request; every keep/drop score, token estimate and fallback is visible |
| **Evaluation harness** | `src/lib/context-evaluation.ts`, `src/lib/context-fixture.ts`, `scripts/` | 10 labeled scenarios (6 calibration / 4 holdout), threshold fitting, cost & latency report, Go/No-Go; offline cache calibration |
| **Jev playground** | `src/app/page.tsx`, `src/lib/examples.ts` | The original Jev Explained learning app: four runnable examples showing noul / choice / score |

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000 for the playground and http://localhost:3000/context for the Context Lab. An OpenRouter key (create one at [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys)) is stored in your browser's `localStorage` only and forwarded per request; the server never persists it.

Tests and evaluation:

```bash
npm run test:context        # offline unit tests: chunks, pins, closure, routing, turn policy, placeholders
npm run evaluate:context    # 50 real Jev replay runs (costs OpenRouter credits)
npm run evaluate:summaries  # 45 real Jev summary-level replays (costs credits)
npm run calibrate:cache     # offline cache calibration from OpenCode's local database (numbers only)
```

## Use it inside OpenCode V2

The plugin at `.opencode/plugins/jev-context.ts` is loaded automatically when you start OpenCode V2 in this repository. Recommended setup with the turn policy:

```powershell
$env:OPENROUTER_API_KEY = "your-key"
npm run pricing:cache              # once: writes .opencode/jev-pricing.json (cache prices, context windows)
$env:JEV_CACHE_ROUTING = "1"
$env:JEV_CACHE_POLICY = "turn"
$env:JEV_COMPILE_TIMEOUT_MS = "1500"   # optional: cap the wait for Jev
npm run dev
# In another terminal, start OpenCode V2 in this repository.
```

### Modes

| Mode | Flags | When Jev is asked | Status |
| --- | --- | --- | --- |
| **Turn policy** (recommended) | `JEV_CACHE_ROUTING=1`, `JEV_CACHE_POLICY=turn` | Once per user turn, only for the previous turn's tool outputs; tool loops reuse the warm prefix | Live Go (Phase 6); opt-in |
| Per call (default) | none | Before every model call, over the whole history; dropped chunks are removed | Live Go (Phase 4) |
| Summary levels | `JEV_SUMMARY_LEVELS=1` | Before every model call; candidates become `drop / short / long / full` extracts | Live Go (Phase 5); opt-in, disables the turn policy |
| Cost routing | `JEV_CACHE_ROUTING=1` without `JEV_CACHE_POLICY` | Per call, but skips Jev when reusing the warm prefix is cheaper | Experimental, No-Go |

All flags are off by default; enabling one by default is a separate product decision.

### Turn policy in detail

- **Tool loop** (same user turn): new messages are appended to the previously sent request; no compiler or Jev call, hook overhead ~15 ms.
- **New user turn:** the previous turn's tool outputs go to Jev in batches (≤ 60 chunks, ≤ 200 kB). Dropped outputs become the placeholder; everything else stays byte-identical.
- **Pressure and growth:** at 80 % of the model's real context window (from the pricing file, measured with the provider's real token counts), or once the prompt has grown 1.5× past 40k tokens since the last full judgement, frozen content is re-judged. The result is applied only when the saved cache reads outweigh rewriting the tail (always under pressure). Removed content stays removed.
- **Without the pricing file** the policy assumes a 108k window and never re-judges for cost reasons, so run `npm run pricing:cache` first.
- Routing state is content-free (message keys, hashes, token counts, timestamps) and lives in OpenCode's plugin storage; every decision is logged with its inputs and can be replayed offline.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | – | Key for Jev; without it the plugin never changes the context |
| `JEV_CONTEXT_ENDPOINT` | `http://127.0.0.1:3000/api/context` | Compiler URL; loopback hosts only |
| `JEV_CACHE_ROUTING` | off | `1` enables cache-aware routing |
| `JEV_CACHE_POLICY` | – | `turn` selects the turn policy (requires `JEV_CACHE_ROUTING=1`) |
| `JEV_COMPILE_TIMEOUT_MS` | `5000` | Upper bound per compiler request (500–5000 ms) |
| `JEV_SUMMARY_LEVELS` | off | `1` enables summary levels instead of binary keep/drop |
| `JEV_PRICING_FILE` | `.opencode/jev-pricing.json` | Alternative pricing file |
| `JEV_HOOK_DIAGNOSTIC` | off | `1` records field names and types of hook events (never contents) |

## Results so far

- **Replay evaluation** (100 runs, calibration + holdout): 83.6 % median token reduction, 100 % must-keep recall, 95.2 % precision, p95 latency 374–479 ms, positive net savings.
- **OpenCode field test, per call** (three independent long sessions, 99 model messages): all 48 canary and repository-rule checks passed, 42.7 % dispatch input reduction, p95 625 ms, zero context losses across network, timeout and parser fallbacks.
- **Summary levels, live** (three sessions, 146 dispatches): 100 % must-keep facts, 64.4 % median reduction, p95 575 ms, positive net effect.
- **Turn policy, live A/B against native OpenCode** (large-context session with topic switches, cache-expiring pauses and full reads of large files; fixed tool work; 2 models × 2 runs): all must-keep checks passed in every arm, every turn made exactly the required tool calls, net cost incl. Jev **−41 %** (`glm-5.3-flash`) and **−19 %** (`gpt-5.6-luna`), largest prompt 193–206k → 122–139k tokens, no fallback, 100 % offline replay of routing decisions.
- **Known limitation:** with the turn policy the hook p95 is 0.9–1.6 s on turns where Jev is asked (median ~15 ms), driven by selector latency at OpenRouter. `JEV_COMPILE_TIMEOUT_MS` caps it; on timeout the frozen state is sent without pruning.

Full numbers, thresholds, phase decisions and acceptance criteria: [Plan.md](Plan.md) and [docs/plan/](docs/plan/) (German).

## Safety model

- Known secret patterns (including hyphenated `sk-…` provider keys) are redacted locally before any external call; sensitive chunks are pinned and never sent to Jev.
- `.env` contents, credentials, tokens, cookies and private keys are blocked by default.
- The plugin only accepts a loopback compiler endpoint and enforces payload and chunk limits.
- Routing state and metrics are content-free; no server-side persistence of keys; logs stay secret-free.
- Adversarial or injected text can influence Jev's judgment — safety rules are therefore decided by code, never by the model.

## Project layout

```
src/
  lib/
    context.ts             compiler core (chunks, pins, selectors, fallback)
    cache-routing.ts       pricing, cache warmth, reuse/rebuild and turn-policy decisions
    selector-cache.ts      cache for identical selector answers
    context-fixture.ts     10 replay scenarios with must-keep / safe-to-drop labels
    context-evaluation.ts  replay metrics, threshold calibration, Go/No-Go report
    examples.ts            playground examples
  app/
    page.tsx               Jev playground
    context/page.tsx       Context Lab
    api/jev/route.ts       playground proxy to OpenRouter Decisions
    api/context/route.ts   compiler endpoint
.opencode/plugins/
  jev-context.ts           OpenCode V2 adapter (chunking, freezing, placeholders, routing)
scripts/
  evaluate-context.ts      replay evaluation runner
  evaluate-summaries.ts    summary-level evaluation runner
  cache-pricing.ts         model cache prices from OpenCode's local catalog
  calibrate-cache-routing.ts  offline cache calibration (numeric fields only)
docs/plan/                 plan, phase decisions and measurement history (German)
```

## Roadmap

OpenCode is done (Phases 3–6). Next: Claude Code hooks (Phase 7A), then Codex (7B) and a cross-agent consolidation (7C). Open-source housekeeping: [docs/plan/open-source-todo.md](docs/plan/open-source-todo.md).

## Origin & credits

The playground foundation, Jev examples and visual design come from [Jev Explained](https://github.com/davila7/jev-explained) by Daniel Avila. The Smart Context compiler, Context Lab, evaluation harness and OpenCode integration build on that base.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md), the [Code of Conduct](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Daniel Avila
