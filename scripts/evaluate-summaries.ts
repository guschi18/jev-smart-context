import {
  buildSummarySelectorRequest,
  normalizeTranscript,
  readSummaryDecisions,
  type SummaryLevel,
} from "../src/lib/context.ts";
import { REPLAY_ATTEMPTS } from "../src/lib/context-evaluation.ts";
import { REPLAY_FIXTURES } from "../src/lib/context-fixture.ts";
import { PROVIDER } from "../src/lib/providers.ts";
import type { JevResponse } from "../src/lib/types.ts";

const apiKey = process.env.OPENROUTER_API_KEY?.trim();
if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing.");

const levels: SummaryLevel[] = ["drop", "short", "long", "full"];
const fixtureFilter = new Set(argument("fixtures")?.split(",").filter(Boolean) ?? []);
const attempts = Number(argument("attempts") ?? REPLAY_ATTEMPTS);
if (!Number.isInteger(attempts) || attempts < 1) throw new Error("--attempts must be a positive integer");
const fixtures = REPLAY_FIXTURES.filter(
  (fixture) => fixture.summaryTargets && (!fixtureFilter.size || fixtureFilter.has(fixture.id)),
);
if (!fixtures.length) throw new Error("No matching summary fixtures");
const runs: Array<{
  fixtureId: string;
  latencyMs: number;
  costUsd?: number;
  before: number;
  after: number;
  decisions: Array<{
    id: string;
    target: SummaryLevel;
    raw: SummaryLevel;
    selected: SummaryLevel;
    confidence: number;
    probabilities: Record<string, number>;
  }>;
  error?: string;
}> = [];

for (let attempt = 1; attempt <= attempts; attempt++) {
  for (const fixture of fixtures) {
    const input = {
      currentRequest: fixture.currentRequest,
      activeGoal: fixture.activeGoal,
      repository: fixture.repository,
      chunks: normalizeTranscript(fixture.transcript, fixture.currentEntryId),
    };
    const { candidates, request } = buildSummarySelectorRequest(
      input,
      process.env.JEV_MODEL?.trim() || PROVIDER.model,
    );
    const candidateIds = candidates.map(({ chunk }) => chunk.id);
    const targetIds = Object.keys(fixture.summaryTargets!);
    if (candidateIds.length !== targetIds.length || targetIds.some((id) => !candidateIds.includes(id))) {
      throw new Error(`${fixture.id}: summary targets do not match candidates`);
    }

    const started = performance.now();
    try {
      const response = await fetch(PROVIDER.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const latencyMs = Math.round(performance.now() - started);
      const body = await response.json() as JevResponse | { error?: unknown };
      if (!response.ok || !("answers" in body)) throw new Error(`HTTP ${response.status}`);
      const choices = readSummaryDecisions(candidates, body.answers);
      const byId = new Map(candidates.map((candidate) => [candidate.chunk.id, candidate]));
      runs.push({
        fixtureId: fixture.id,
        latencyMs,
        costUsd: body.usage.cost,
        before: candidates.reduce((sum, candidate) => sum + candidate.variants.full.tokenEstimate, 0),
        after: choices.reduce((sum, choice) => {
          const variants = byId.get(choice.id)!.variants;
          return sum + (choice.level === "drop" ? 0 : variants[choice.level].tokenEstimate);
        }, 0),
        decisions: choices.map((choice) => ({
          id: choice.id,
          target: fixture.summaryTargets![choice.id],
          raw: choice.rawLevel,
          selected: choice.level,
          confidence: choice.confidence,
          probabilities: choice.probabilities,
        })),
      });
    } catch (error) {
      runs.push({
        fixtureId: fixture.id,
        latencyMs: Math.round(performance.now() - started),
        before: 0,
        after: 0,
        decisions: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
    console.error(`${runs.length}/${fixtures.length * attempts} ${fixture.id}`);
  }
}

const decisions = runs.flatMap((run) => run.decisions);
const costs = runs.map((run) => run.costUsd);
const tokensBefore = runs.reduce((sum, run) => sum + run.before, 0);
const tokensAfter = runs.reduce((sum, run) => sum + run.after, 0);
const selectorCostUsd = costs.every((cost) => typeof cost === "number")
  ? costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0)
  : undefined;
const estimatedAgentSavingsUsd = (tokensBefore - tokensAfter)
  * Number(process.env.AGENT_INPUT_USD_PER_MILLION ?? 3) / 1_000_000;
const minimumDetailRecall = decisions.length
  ? decisions.filter(({ target, selected }) => levels.indexOf(selected) >= levels.indexOf(target)).length / decisions.length
  : 0;
const reductions = runs.filter((run) => !run.error).map((run) => run.before ? 1 - run.after / run.before : 0);
const reasons: string[] = [];
if (runs.some((run) => run.error)) reasons.push(`${runs.filter((run) => run.error).length} selector run(s) failed.`);
if (minimumDetailRecall < 1) reasons.push(`Minimum-detail recall is ${(minimumDetailRecall * 100).toFixed(1)}%, not 100%.`);
if (median(reductions) < 0.4) reasons.push(`Median reduction is ${(median(reductions) * 100).toFixed(1)}%, below 40%.`);
if (selectorCostUsd === undefined) reasons.push("OpenRouter did not report selector cost for every run.");
if (selectorCostUsd !== undefined && estimatedAgentSavingsUsd - selectorCostUsd <= 0) reasons.push("Estimated net savings are not positive.");

console.log(JSON.stringify({
  method: "jev-choice",
  runCount: runs.length,
  decisionCount: decisions.length,
  exactAccuracy: decisions.length
    ? decisions.filter(({ target, selected }) => target === selected).length / decisions.length
    : 0,
  minimumDetailRecall,
  medianReduction: median(reductions),
  tokensBefore,
  tokensAfter,
  selectorLatencyP50Ms: percentile(runs.map((run) => run.latencyMs), 0.5),
  selectorLatencyP95Ms: percentile(runs.map((run) => run.latencyMs), 0.95),
  selectorCostUsd,
  summaryGenerationCostUsd: 0,
  estimatedAgentSavingsUsd,
  netSavingsUsd: selectorCostUsd === undefined ? undefined : estimatedAgentSavingsUsd - selectorCostUsd,
  choices: Object.fromEntries(levels.flatMap((target) => levels.map((selected) => {
    const count = decisions.filter((item) => item.target === target && item.selected === selected).length;
    return count ? [`${target}->${selected}`, count] : [];
  }))),
  rawChoices: Object.fromEntries(levels.flatMap((target) => levels.map((selected) => {
    const count = decisions.filter((item) => item.target === target && item.raw === selected).length;
    return count ? [`${target}->${selected}`, count] : [];
  }))),
  fixtures: Object.fromEntries(fixtures.map((fixture) => [
    fixture.id,
    runs.filter((run) => run.fixtureId === fixture.id).flatMap((run) => run.decisions),
  ])),
  decision: reasons.length ? "no-go" : "go",
  reasons,
}, null, 2));

function argument(name: string) {
  return process.argv.slice(2).find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
