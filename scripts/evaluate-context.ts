import {
  buildSelectorRequest,
  compileSelection,
  fallbackCompilation,
  normalizeTranscript,
} from "../src/lib/context.ts";
import {
  REPLAY_ATTEMPTS,
  evaluateReplay,
  type ReplayRun,
} from "../src/lib/context-evaluation.ts";
import { REPLAY_FIXTURES } from "../src/lib/context-fixture.ts";
import { PROVIDER } from "../src/lib/providers.ts";
import type { JevResponse } from "../src/lib/types.ts";

const apiKey = process.env.OPENROUTER_API_KEY?.trim();
if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing.");

const runs: ReplayRun[] = [];
const total = REPLAY_FIXTURES.length * REPLAY_ATTEMPTS;

for (let attempt = 1; attempt <= REPLAY_ATTEMPTS; attempt++) {
  for (const fixture of REPLAY_FIXTURES) {
    const chunks = normalizeTranscript(fixture.transcript, fixture.currentEntryId);
    const input = {
      currentRequest: fixture.currentRequest,
      activeGoal: fixture.activeGoal,
      repository: fixture.repository,
      chunks,
    };
    const { candidates, request } = buildSelectorRequest(
      input,
      process.env.JEV_MODEL?.trim() || PROVIDER.model,
    );
    const started = performance.now();
    let result;

    if (!candidates.length) {
      result = compileSelection(input, {}, 0, { inputTokens: 0, outputTokens: 0, costUsd: 0 });
    } else {
      try {
        const response = await fetch(PROVIDER.url, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        const latencyMs = Math.round(performance.now() - started);
        const body = await response.json() as JevResponse | { error?: unknown };
        result = response.ok && "answers" in body
          ? compileSelection(input, body.answers, latencyMs, {
              inputTokens: body.usage.input_tokens,
              outputTokens: body.usage.output_tokens,
              costUsd: body.usage.cost,
            })
          : fallbackCompilation(chunks, `Selector failed (HTTP ${response.status}).`, latencyMs);
      } catch (error) {
        result = fallbackCompilation(
          chunks,
          error instanceof Error ? error.message : String(error),
          Math.round(performance.now() - started),
        );
      }
    }

    runs.push({ fixtureId: fixture.id, attempt, result });
    console.error(`${runs.length}/${total} ${fixture.id}`);
  }
}

console.log(JSON.stringify(evaluateReplay(
  REPLAY_FIXTURES,
  runs,
  Number(process.env.AGENT_INPUT_USD_PER_MILLION ?? 3),
  REPLAY_ATTEMPTS,
), null, 2));
