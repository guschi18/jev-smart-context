import {
  DEFAULT_THRESHOLDS,
  MIN_SELECTOR_TOKENS,
  closeDependencies,
  prefilterChunks,
  type CompilationResult,
  type ContextChunk,
  type SelectionThresholds,
} from "./context.ts";
import type { ReplayFixture } from "./context-fixture";

export type ReplayRun = {
  fixtureId: string;
  attempt: number;
  result: CompilationResult;
};

export const REPLAY_ATTEMPTS = 5;

export type MethodMetrics = {
  medianReduction: number;
  mustKeepRecall: number;
  precision: number;
  tokensBefore: number;
  tokensAfter: number;
};

export type FixtureMetrics = {
  fixtureId: string;
  title: string;
  set: ReplayFixture["set"];
  runs: number;
  baselineReduction: number;
  prefilterReduction: number;
  jevReduction: number;
  mustKeepRecall: number;
};

export type EvaluationReport = {
  thresholds: SelectionThresholds;
  baseline: MethodMetrics;
  prefilter: MethodMetrics;
  jev: MethodMetrics;
  holdout: MethodMetrics;
  fixtures: FixtureMetrics[];
  runCount: number;
  selectorLatencyP50Ms: number;
  selectorLatencyP95Ms: number;
  selectorCostUsd?: number;
  estimatedAgentSavingsUsd: number;
  netSavingsUsd?: number;
  fallbackCount: number;
  safetyLosses: string[];
  decision: "go" | "no-go" | "pending";
  reasons: string[];
};

type Selection = { fixture: ReplayFixture; chunks: ContextChunk[]; kept: Set<string> };

export function calibrateThresholds(fixtures: ReplayFixture[], runs: ReplayRun[]) {
  const candidates = [...new Set([
    DEFAULT_THRESHOLDS.relevance,
    ...Array.from({ length: 19 }, (_, index) => (index + 1) / 20),
  ])].sort((a, b) => a - b);
  let best: SelectionThresholds | undefined;
  let bestMetrics: MethodMetrics | undefined;

  for (const relevance of candidates) {
    const thresholds = { relevance };
    const selected = selections(fixtures, runs, "jev", thresholds);
    const metrics = aggregate(selected);
    if (metrics.mustKeepRecall < 1 || safetyLosses(selected).length) continue;
    if (
      !best ||
      !bestMetrics ||
      metrics.medianReduction > bestMetrics.medianReduction ||
      (metrics.medianReduction === bestMetrics.medianReduction &&
        metrics.precision > bestMetrics.precision) ||
      (metrics.medianReduction === bestMetrics.medianReduction &&
        metrics.precision === bestMetrics.precision && relevance < best.relevance)
    ) {
      best = thresholds;
      bestMetrics = metrics;
    }
  }
  return best ?? DEFAULT_THRESHOLDS;
}

export function evaluateReplay(
  fixtures: ReplayFixture[],
  runs: ReplayRun[],
  agentInputUsdPerMillion: number,
  attempts = 1,
): EvaluationReport {
  const calibrationFixtures = fixtures.filter((fixture) => fixture.set === "calibration");
  const thresholds = calibrateThresholds(calibrationFixtures, runs);
  const baselineSelections = selections(fixtures, runs, "baseline", thresholds);
  const prefilterSelections = selections(fixtures, runs, "prefilter", thresholds);
  const jevSelections = selections(fixtures, runs, "jev", thresholds);
  const baseline = aggregate(baselineSelections);
  const prefilter = aggregate(prefilterSelections);
  const jev = aggregate(jevSelections);
  const holdoutIds = new Set(fixtures.filter((fixture) => fixture.set === "holdout").map((fixture) => fixture.id));
  const holdout = aggregate(jevSelections.filter((selection) => holdoutIds.has(selection.fixture.id)));
  const safety = safetyLosses(jevSelections);
  const fallbackCount = runs.filter((run) => run.result.fallbackReason).length;
  const latencies = runs.map((run) => run.result.selectorLatencyMs);
  const costValues = runs.map((run) => run.result.selectorUsage?.costUsd);
  const selectorCostUsd = costValues.every((cost) => typeof cost === "number")
    ? costValues.reduce<number>((sum, cost) => sum + (cost ?? 0), 0)
    : undefined;
  const savedTokens = jev.tokensBefore - jev.tokensAfter;
  const estimatedAgentSavingsUsd = savedTokens * agentInputUsdPerMillion / 1_000_000;
  const netSavingsUsd = selectorCostUsd === undefined
    ? undefined
    : estimatedAgentSavingsUsd - selectorCostUsd;
  const complete = fixtures.every(
    (fixture) => runs.filter((run) => run.fixtureId === fixture.id).length === attempts,
  );
  const reasons: string[] = [];

  if (!complete) reasons.push(`Only ${runs.length}/${fixtures.length * attempts} replay runs are complete.`);
  if (fallbackCount) reasons.push(`${fallbackCount} selector run(s) used the fail-safe fallback.`);
  if (holdout.mustKeepRecall < 1) reasons.push(`Holdout must-keep recall is ${(holdout.mustKeepRecall * 100).toFixed(1)}%, not 100%.`);
  if (safety.length) reasons.push(`${safety.length} safety-critical chunk(s) were lost.`);
  if (holdout.medianReduction < 0.4) reasons.push(`Holdout median reduction is ${(holdout.medianReduction * 100).toFixed(1)}%, below 40%.`);
  if (percentile(latencies, 0.95) >= 500) reasons.push(`Selector p95 is ${percentile(latencies, 0.95)} ms, not below 500 ms.`);
  if (selectorCostUsd === undefined) reasons.push("OpenRouter did not report selector cost for every run.");
  if (netSavingsUsd !== undefined && netSavingsUsd <= 0) reasons.push("Estimated net savings are not positive.");

  const pending = !complete || selectorCostUsd === undefined;
  return {
    thresholds,
    baseline,
    prefilter,
    jev,
    holdout,
    fixtures: fixtures.map((fixture) => {
      const baselineRuns = baselineSelections.filter((selection) => selection.fixture.id === fixture.id);
      const prefilterRuns = prefilterSelections.filter((selection) => selection.fixture.id === fixture.id);
      const jevRuns = jevSelections.filter((selection) => selection.fixture.id === fixture.id);
      return {
        fixtureId: fixture.id,
        title: fixture.title,
        set: fixture.set,
        runs: jevRuns.length,
        baselineReduction: aggregate(baselineRuns).medianReduction,
        prefilterReduction: aggregate(prefilterRuns).medianReduction,
        jevReduction: aggregate(jevRuns).medianReduction,
        mustKeepRecall: aggregate(jevRuns).mustKeepRecall,
      };
    }),
    runCount: runs.length,
    selectorLatencyP50Ms: percentile(latencies, 0.5),
    selectorLatencyP95Ms: percentile(latencies, 0.95),
    selectorCostUsd,
    estimatedAgentSavingsUsd,
    netSavingsUsd,
    fallbackCount,
    safetyLosses: safety,
    decision: pending ? "pending" : reasons.length ? "no-go" : "go",
    reasons,
  };
}

function selections(
  fixtures: ReplayFixture[],
  runs: ReplayRun[],
  method: "baseline" | "prefilter" | "jev",
  thresholds: SelectionThresholds,
) {
  const byFixture = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  return runs.flatMap((run) => {
    const fixture = byFixture.get(run.fixtureId);
    if (!fixture) return [];
    const result = run.result;
    const chunks = result.chunks;
    let kept: Set<string>;
    if (method === "baseline") {
      kept = new Set(chunks.map((chunk) => chunk.id));
    } else if (method === "prefilter") {
      kept = new Set(prefilterChunks(chunks).chunks.map((chunk) => chunk.id));
    } else if (result.fallbackReason) {
      kept = new Set(chunks.map((chunk) => chunk.id));
    } else {
      kept = selectJev(chunks, result, thresholds);
    }
    return [{ fixture, chunks, kept } satisfies Selection];
  });
}

function selectJev(
  chunks: ContextChunk[],
  result: CompilationResult,
  thresholds: SelectionThresholds,
) {
  const prefiltered = prefilterChunks(chunks);
  const decisions = new Map(result.decisions.map((decision) => [decision.id, decision]));
  const kept = new Set(
    prefiltered.chunks
      .filter(
        (chunk) =>
          chunk.pinned ||
          chunk.kind === "user_turn" ||
          chunk.tokenEstimate < MIN_SELECTOR_TOKENS,
      )
      .map((chunk) => chunk.id),
  );

  for (const chunk of prefiltered.chunks) {
    if (
      chunk.pinned ||
      chunk.kind === "user_turn" ||
      chunk.tokenEstimate < MIN_SELECTOR_TOKENS
    ) continue;
    const decision = decisions.get(chunk.id);
    if (
      !decision ||
      decision.relevance === undefined ||
      decision.relevance >= thresholds.relevance
    ) {
      kept.add(chunk.id);
    }
  }
  return closeDependencies(chunks, kept);
}

function aggregate(selected: Selection[]): MethodMetrics {
  const tokensBefore = selected.reduce(
    (sum, selection) => sum + selection.chunks.reduce((chunkSum, chunk) => chunkSum + chunk.tokenEstimate, 0),
    0,
  );
  const tokensAfter = selected.reduce(
    (sum, selection) => sum + selection.chunks
      .filter((chunk) => selection.kept.has(chunk.id))
      .reduce((chunkSum, chunk) => chunkSum + chunk.tokenEstimate, 0),
    0,
  );
  const mustKeep = selected.flatMap((selection) => selection.fixture.mustKeepChunkIds);
  const keptMust = selected.reduce(
    (sum, selection) => sum + selection.fixture.mustKeepChunkIds.filter((id) => selection.kept.has(id)).length,
    0,
  );
  const keptSafe = selected.reduce(
    (sum, selection) => sum + selection.fixture.safeToDropChunkIds.filter((id) => selection.kept.has(id)).length,
    0,
  );
  return {
    medianReduction: median(selected.map(reduction)),
    mustKeepRecall: mustKeep.length ? keptMust / mustKeep.length : 1,
    precision: keptMust + keptSafe ? keptMust / (keptMust + keptSafe) : 1,
    tokensBefore,
    tokensAfter,
  };
}

function reduction(selection: Selection) {
  const before = selection.chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0);
  const after = selection.chunks
    .filter((chunk) => selection.kept.has(chunk.id))
    .reduce((sum, chunk) => sum + chunk.tokenEstimate, 0);
  return before ? 1 - after / before : 0;
}

function safetyLosses(selected: Selection[]) {
  return selected.flatMap((selection) =>
    selection.fixture.safetyCriticalChunkIds
      .filter((id) => !selection.kept.has(id))
      .map((id) => `${selection.fixture.id}:${id}`),
  );
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
