# Jev Smart Context

**A local Smart Context compiler for coding agents — Jev decides what is relevant, deterministic code decides what is safe.**

Every model call sends the agent's full conversation and tool history again. This project rebuilds that history before every call so the model only sees what it needs for the current task — cutting input tokens and context-window pressure without losing requirements, security rules, decisions, or open work.

Built on the [Jev Explained](https://github.com/davila7/jev-explained) playground and [TypeSafe's Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) (`typesafe/jev-1.13` via the [OpenRouter Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request)).

## The idea: Meta-Attention

Context is not static. For every new user turn, the previous history is re-evaluated:

```text
new user turn
      ↓
normalize transcript
      ↓
semantic chunks
      ↓
deterministic prefilter     ← pins, duplicates, secrets, recency — no model cost
      ↓
Jev relevance questions     ← one noul question per candidate, in parallel
      ↓
dependency closure          ← transitively keep referenced chunks
      ↓
compiled context            ← chronologically ordered
      ↓
Claude Code / Codex / OpenCode
```

The division of labor is strict:

- **Jev** evaluates semantic relevance and uncertainty for closed questions (noul / choice / score primitives, calibrated probabilities, ~100 ms round trips).
- **Code** owns everything determinism can solve: token counting, budgets, dependencies, cache economics, and security rules. Jev is never a security boundary.

### What is always kept

Pinned chunks never leave, regardless of what Jev says:

- System, developer and repository instructions
- The current user turn (and user turns generally)
- The last relevant error state and failed tool calls
- Unfinished tool transactions, active unverified changes
- Secrets and sensitive content — detected locally, never sent externally
- Anything under 100 estimated tokens (cheaper to keep than to classify)

Jev only judges the remaining candidates: older, larger, non-sensitive tool and assistant chunks.

### Fail-safe by default

Any missing API key, network error, timeout (5 s), oversized payload, or malformed selector response keeps the **complete original context**. The selector may fail; the agent task must not.

## What is in this repo

| Piece | Path | What it is |
| --- | --- | --- |
| **Compiler core** | `src/lib/context.ts` | Chunk model, pins, deterministic prefilter, selector request builders, dependency closure, fail-safe compilation |
| **Compiler endpoint** | `src/app/api/context/route.ts` | Validated `/api/context` route: pins secrets locally, calls Jev, falls back safely |
| **Context Lab UI** | `src/app/context/`, `src/components/ContextLab.tsx` | Replay a realistic coding session against a new request; every keep/drop score, token estimate and fallback is visible |
| **OpenCode plugin** | `.opencode/plugins/jev-context.ts` | OpenCode V2 `context` hook: compiles outgoing messages before every model call, replaces only the model-bound message array |
| **Evaluation harness** | `src/lib/context-evaluation.ts`, `src/lib/context-fixture.ts`, `scripts/` | 10 labeled scenarios (6 calibration / 4 holdout), threshold fitting, cost & latency report, Go/No-Go |
| **Jev playground** | `src/app/page.tsx`, `src/lib/examples.ts` | The original Jev Explained learning app: four runnable examples showing noul / choice / score |

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000 for the playground and http://localhost:3000/context for the Context Lab. An OpenRouter key (create one at [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys)) is stored in your browser's `localStorage` only and forwarded per request; the server never persists it.

Tests and evaluation:

```bash
npm run test:context        # offline unit tests: grouping, pins, dependency closure
npm run evaluate:context    # 50 real Jev replay runs (costs OpenRouter credits)
npm run evaluate:summaries  # 45 real Jev summary-level replays (costs credits)
```

## Use it inside OpenCode V2

The plugin at `.opencode/plugins/jev-context.ts` is loaded automatically when you start OpenCode V2 in this repository:

```powershell
$env:OPENROUTER_API_KEY = "your-key"
npm run dev
# In another terminal, start OpenCode V2 in this repository.
```

The plugin converts the outgoing message history into compiler chunks, calls the local `/api/context` endpoint, and replaces only the model-bound messages. Tool calls and their results stay inseparable; provider-visible history is never broken. Content-free run metrics and deterministic summary variants are stored in OpenCode's plugin storage. Set `JEV_CONTEXT_ENDPOINT` if the local app runs on another URL.

### Cache-aware turn policy (opt-in)

By default the plugin recompiles on every dispatch, which changes the prompt prefix and costs provider cache hits. The turn policy keeps the prefix byte-stable instead:

```powershell
npm run pricing:cache            # writes .opencode/jev-pricing.json from OpenCode's local models.dev catalog
$env:JEV_CACHE_ROUTING = "1"
$env:JEV_CACHE_POLICY = "turn"
$env:JEV_COMPILE_TIMEOUT_MS = "1500"   # optional: cap the wait for Jev (500-5000 ms, default 5000)
```

- Inside a tool loop, new messages are only appended; the warm prefix is reused without a compiler or Jev call.
- At the next user turn, Jev judges the previous turn's tool outputs once. Dropped outputs are replaced by a fixed placeholder (`[Tool output removed by Jev context pruning …]`); the tool call stays visible, so the model knows what it read and re-runs the tool when it needs the content again. Answers, reasoning and user messages are never pruned.
- Judged content is frozen afterwards; a break can only occur behind the frozen prefix. On context pressure (80 % of the model's real window) or strong growth, frozen content is re-judged when it pays off.
- Any compiler failure or timeout sends the frozen state unchanged; removed context is never re-added.

Binary keep/drop is the live policy. Summary levels (`drop / short / long / full`) are calibrated in replay (extractive head/tail variants, confidence rule: raw `short` below 0.50 is raised to `long`) but are not sent yet — they become active only after controlled real-session validation.

## Results so far

- **Replay evaluation** (100 runs, calibration + holdout): 83.6 % median token reduction, 100 % must-keep recall, 95.2 % precision, p95 latency 374–479 ms, positive net savings.
- **OpenCode field test** (three independent long sessions, 99 model messages): all 48 canary and repository-rule checks passed, 42.7 % dispatch input reduction, p95 625 ms, zero context losses across network, timeout and parser fallbacks.
- **Summary-level replay** (45 runs after calibration): 100 % minimum-detail recall, 93.7 % median reduction, p95 417 ms.
- **Cache-aware turn policy** (live A/B against native OpenCode, large-context session with fixed tool work, 2 models × 2 runs): all must-keep checks passed in every arm, every turn made exactly the required tool calls, net cost incl. Jev −41 % (`glm-5.3-flash`) and −19 % (`gpt-5.6-luna`), largest prompt 193–206k → 122–139k tokens. Known limitation: hook p95 0.9–1.6 s, caused by selector latency at OpenRouter.

Full numbers, thresholds, phase decisions and acceptance criteria: [Plan.md](Plan.md).

## Safety model

- Known secret patterns are redacted locally before any external call; sensitive chunks are pinned and never sent to Jev.
- `.env` contents, credentials, tokens, cookies and private keys are blocked by default.
- The plugin only accepts a loopback compiler endpoint and enforces payload and chunk limits.
- No server-side persistence of keys; logs stay secret-free.
- Adversarial or injected text can influence Jev's judgment — safety rules are therefore decided by code, never by the model.

## Project layout

```
src/
  lib/
    context.ts             compiler core (chunks, pins, selectors, fallback)
    context-fixture.ts     10 replay scenarios with must-keep / safe-to-drop labels
    context-evaluation.ts  replay metrics, threshold calibration, Go/No-Go report
    cache-routing.ts       pricing, cache warmth, reuse/rebuild and turn-policy decisions
    examples.ts            playground examples
  app/
    page.tsx               Jev playground
    context/page.tsx       Context Lab
    api/jev/route.ts       playground proxy to OpenRouter Decisions
    api/context/route.ts   compiler endpoint
.opencode/plugins/
  jev-context.ts           OpenCode V2 adapter
scripts/
  evaluate-context.ts      replay evaluation runner
  evaluate-summaries.ts    summary-level evaluation runner
  cache-pricing.ts         model cache prices from OpenCode's local catalog
  calibrate-cache-routing.ts  offline cache calibration (numeric fields only)
```

## Origin & credits

The playground foundation, Jev examples and visual design come from [Jev Explained](https://github.com/davila7/jev-explained) by Daniel Avila. The Smart Context compiler, Context Lab, evaluation harness and OpenCode integration build on that base.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md), the [Code of Conduct](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Daniel Avila
