import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_ROUTING,
  cacheWarmth,
  decideRoute,
  movingAverage,
  readPricing,
  type ModelPricing,
  type RoutingConfig,
  type Warmth,
} from "../src/lib/cache-routing.ts";

// Offline calibration for cache-aware routing. Reads OpenCode's database
// read-only and extracts numeric fields only (tokens, cost, time, model) plus
// the content-free jev-context metrics. No text field is selected or printed.
const dbPath = argument("db") ?? join(homedir(), ".local", "share", "opencode", "opencode.db");
const pricingPath = argument("pricing") ?? join(import.meta.dirname, "..", ".opencode", "jev-pricing.json");
const pricingFile = JSON.parse(readFileSync(pricingPath, "utf8")) as unknown;
const db = new DatabaseSync(dbPath, { readOnly: true });

type Step = {
  session: string;
  type: "user" | "assistant";
  created: number;
  completed?: number;
  model?: string;
  input: number;
  read: number;
  write: number;
};

const steps = (db.prepare(`
  SELECT session_id AS session, type,
    COALESCE(json_extract(data, '$.time.created'), time_created) AS created,
    json_extract(data, '$.time.completed') AS completed,
    json_extract(data, '$.model.providerID') || '/' || json_extract(data, '$.model.id') AS model,
    COALESCE(json_extract(data, '$.tokens.input'), 0) AS input,
    COALESCE(json_extract(data, '$.tokens.cache.read'), 0) AS read,
    COALESCE(json_extract(data, '$.tokens.cache.write'), 0) AS write
  FROM session_message
  WHERE type IN ('user', 'assistant')
  ORDER BY session_id, seq
`).all() as Step[]);

const metricPrefix = `plugin:${[..."jev-context"].map((char) => char.charCodeAt(0).toString(16).padStart(4, "0")).join("")}:metrics/`;
type Metric = {
  timestamp: string;
  sessionID: string;
  status: string;
  inputTokensBefore?: number;
  inputTokensAfter?: number;
  messagesBefore?: number;
  messagesAfter?: number;
  selectorCostUsd?: number;
  route?: string;
  selection?: unknown[];
};
const metrics = (db.prepare("SELECT value FROM kv WHERE key LIKE ? || '%' ORDER BY key").all(metricPrefix) as Array<{ value: string }>)
  .map((row) => JSON.parse(row.value) as Metric)
  .filter((metric) => typeof metric.inputTokensBefore === "number" && typeof metric.inputTokensAfter === "number");
db.close();

const bySession = new Map<string, Step[]>();
for (const step of steps) bySession.set(step.session, [...(bySession.get(step.session) ?? []), step]);
const pluginSessions = new Set(metrics.map((metric) => metric.sessionID));

// 1. Cache hit share by idle gap before an assistant step.
const buckets = [
  { label: "<60 s", max: 60_000 },
  { label: "60–300 s", max: 300_000 },
  { label: "300–600 s", max: 600_000 },
  { label: "600–1800 s", max: 1_800_000 },
  { label: ">1800 s", max: Infinity },
];
type Hit = { gapMs: number; hit: number; tokens: number; plugin: boolean };
const hits: Hit[] = [];
for (const [session, list] of bySession) {
  let lastDone: number | undefined;
  for (const step of list) {
    if (step.type !== "assistant") continue;
    const total = step.input + step.read + step.write;
    if (lastDone !== undefined && total > 0) {
      hits.push({ gapMs: step.created - lastDone, hit: step.read / total, tokens: total, plugin: pluginSessions.has(session) });
    }
    lastDone = step.completed ?? step.created;
  }
}
const weighted = (items: Hit[]) => {
  const tokens = items.reduce((sum, item) => sum + item.tokens, 0);
  return tokens ? round(items.reduce((sum, item) => sum + item.hit * item.tokens, 0) / tokens) : null;
};
const hitCurve = buckets.map((bucket, index) => {
  const inBucket = hits.filter((item) => item.gapMs >= (buckets[index - 1]?.max ?? -Infinity) && item.gapMs < bucket.max);
  return {
    gap: bucket.label,
    steps: inBucket.length,
    hitAll: weighted(inBucket),
    hitNative: weighted(inBucket.filter((item) => !item.plugin)),
    hitPlugin: weighted(inBucket.filter((item) => item.plugin)),
  };
});
const nativeHitFor = (warmth: Warmth, config: RoutingConfig) =>
  weighted(hits.filter((item) => !item.plugin && cacheWarmth(item.gapMs, config) === warmth)) ?? config.pHit[warmth];

// 2. Dispatches per user turn → horizon H.
const turnSteps: number[] = [];
for (const list of bySession.values()) {
  let count = -1;
  for (const step of list) {
    if (step.type === "user") {
      if (count > 0) turnSteps.push(count);
      count = 0;
    } else if (count >= 0) count += 1;
  }
  if (count > 0) turnSteps.push(count);
}

// 3. Real price of a prefix break: hit share of the step after a context
// mutation vs. an unchanged (natural append) dispatch in plugin sessions.
type Dispatch = Metric & { at: number; newUserTurn: boolean; hit?: number; model?: string };
const dispatches: Dispatch[] = [];
for (const [session, list] of groupBy(metrics, (metric) => metric.sessionID)) {
  const sessionSteps = bySession.get(session) ?? [];
  const ordered = [...list].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  let previousAt = -Infinity;
  for (const metric of ordered) {
    const at = Date.parse(metric.timestamp);
    const step = sessionSteps.find((item) => item.type === "assistant" && item.created >= at - 1_000 && item.created <= at + 60_000);
    const total = step ? step.input + step.read + step.write : 0;
    dispatches.push({
      ...metric,
      at,
      newUserTurn: sessionSteps.some((item) => item.type === "user" && item.created > previousAt && item.created <= at),
      hit: total ? step!.read / total : undefined,
      model: step?.model ?? sessionSteps.find((item) => item.model)?.model,
    });
    previousAt = at;
  }
}
const mutated = (item: Dispatch) => item.status === "compiled" && (item.messagesAfter ?? 0) < (item.messagesBefore ?? 0);
const mean = (values: number[]) => values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null;
const prefixBreak = {
  mutatedDispatches: dispatches.filter((item) => mutated(item) && item.hit !== undefined).length,
  hitAfterMutation: mean(dispatches.filter((item) => mutated(item) && item.hit !== undefined).map((item) => item.hit!)),
  unchangedDispatches: dispatches.filter((item) => !mutated(item) && item.hit !== undefined).length,
  hitUnchanged: mean(dispatches.filter((item) => !mutated(item) && item.hit !== undefined).map((item) => item.hit!)),
};

// keepRatio prior: compiled/original tokens of compiles in which Jev decided.
const keepRatios = metrics
  .filter((metric) => metric.status === "compiled" && Array.isArray(metric.selection) && metric.selection.length > 0 && metric.inputTokensBefore)
  .map((metric) => metric.inputTokensAfter! / metric.inputTokensBefore!);

// 4. Replay decideRoute over the recorded dispatch sequences for a grid and
// price each choice with the empirical hit rates measured above.
const fallbackPricing = readPricing(pricingFile, "opencode-go/glm-5.3-flash")!;
const rebuildHit = prefixBreak.hitAfterMutation ?? 0.5;

function simulate(config: RoutingConfig) {
  let cost = 0;
  let rebuildAlways = 0;
  let reuses = 0;
  let pressure = 0;
  for (const list of groupBy(dispatches, (item) => item.sessionID).values()) {
    let sent: number | undefined;
    let before: number | undefined;
    let lastAt = 0;
    let keepRatio: number | undefined;
    let selectorCost: number | undefined;
    for (const item of list) {
      const pricing: ModelPricing = readPricing(pricingFile, item.model) ?? fallbackPricing;
      const cr = pricing.cacheReadPerM / 1e6;
      const cw = pricing.cacheWritePerM / 1e6;
      const full = item.inputTokensBefore!;
      const rebuilt = item.inputTokensAfter!;
      const selector = item.selectorCostUsd ?? 0;
      const gapMs = item.at - lastAt;
      const valid = sent !== undefined && before !== undefined && full >= before;
      const appended = valid ? full - before! : 0;
      const input = {
        prefix: sent === undefined ? "none" as const : valid ? "valid" as const : "invalid" as const,
        pricing,
        sameUserTurn: !item.newUserTurn,
        gapMs,
        prefixTokens: sent ?? 0,
        appendedTokens: appended,
        fullTokens: full,
        pinnedTokens: 0,
        ...(keepRatio !== undefined ? { keepRatio } : {}),
        ...(selectorCost !== undefined ? { selectorCostUsd: selectorCost } : {}),
      };
      let decision = decideRoute(input, config);
      if (decision.route === "rebuild" && input.prefix === "valid") {
        decision = decideRoute({ ...input, rebuildTokensActual: rebuilt }, config);
      }
      const warmth = cacheWarmth(gapMs, config);
      const pHit = nativeHitFor(warmth, config);
      const rebuildCost = rebuilt * (rebuildHit * cr + (1 - rebuildHit) * cw) + selector;
      rebuildAlways += rebuildCost;
      if (decision.route === "reuse") {
        reuses += 1;
        cost += sent! * (pHit * cr + (1 - pHit) * cw) + appended * cw;
        sent = sent! + appended;
      } else {
        cost += rebuildCost;
        sent = rebuilt;
        keepRatio = movingAverage(keepRatio, full ? rebuilt / full : 1, config.emaAlpha);
        selectorCost = movingAverage(selectorCost, selector, config.emaAlpha);
      }
      if (sent >= Math.min(pricing.contextLimit, config.compactionTokens)) pressure += 1;
      before = full;
      lastAt = item.at;
    }
  }
  return { cost, rebuildAlways, reuses, pressure };
}

const grid: Array<{ config: RoutingConfig; result: ReturnType<typeof simulate> }> = [];
for (const margin of [0, 0.05, 0.1, 0.2, 0.3]) {
  for (const pressureRatio of [0.6, 0.7, 0.8, 0.9]) {
    for (const warmMs of [120_000, 300_000, 450_000]) {
      for (const uncertainMs of [450_000, 600_000, 900_000]) {
        if (uncertainMs <= warmMs) continue;
        for (const horizon of [1, 2, 3, 5]) {
          const config = { ...DEFAULT_ROUTING, margin, pressureRatio, warmMs, uncertainMs, horizon };
          grid.push({ config, result: simulate(config) });
        }
      }
    }
  }
}
const safe = grid.filter((item) => item.result.pressure === 0);
const best = (safe.length ? safe : grid).sort((a, b) =>
  a.result.cost - b.result.cost ||
  // Ties: prefer the more conservative (larger margin, lower pressure ratio).
  b.config.margin - a.config.margin ||
  a.config.pressureRatio - b.config.pressureRatio)[0];
const defaults = simulate(DEFAULT_ROUTING);
// One parameter at a time around the defaults: shows how flat the optimum is.
const sensitivity = Object.fromEntries(([
  ["margin", [0, 0.1, 0.2, 0.3]],
  ["pressureRatio", [0.6, 0.8, 0.9]],
  ["warmMs", [120_000, 300_000, 450_000]],
  ["uncertainMs", [450_000, 600_000, 900_000]],
  ["horizon", [1, 2, 3, 5]],
] as const).map(([name, values]) => [
  name,
  Object.fromEntries(values.map((value) => [value, round(simulate({ ...DEFAULT_ROUTING, [name]: value }).cost, 6)])),
]));

console.log(JSON.stringify({
  source: { assistantSteps: steps.filter((step) => step.type === "assistant").length, sessions: bySession.size, pluginMetrics: metrics.length, replayedDispatches: dispatches.length },
  hitCurve,
  pHitNative: {
    warm: nativeHitFor("warm", DEFAULT_ROUTING),
    uncertain: nativeHitFor("uncertain", DEFAULT_ROUTING),
    cold: nativeHitFor("cold", DEFAULT_ROUTING),
  },
  dispatchesPerUserTurn: { turns: turnSteps.length, median: quantile(turnSteps, 0.5), p75: quantile(turnSteps, 0.75), mean: mean(turnSteps) },
  prefixBreak,
  keepRatioWithSelector: { compiles: keepRatios.length, median: quantile(keepRatios.map((value) => round(value)), 0.5), p75: quantile(keepRatios.map((value) => round(value)), 0.75) },
  simulation: {
    rebuildAlwaysUsd: round(defaults.rebuildAlways, 6),
    defaults: { usd: round(defaults.cost, 6), reuses: defaults.reuses, pressure: defaults.pressure },
    best: {
      usd: round(best.result.cost, 6),
      reuses: best.result.reuses,
      pressure: best.result.pressure,
      margin: best.config.margin,
      pressureRatio: best.config.pressureRatio,
      warmMs: best.config.warmMs,
      uncertainMs: best.config.uncertainMs,
      horizon: best.config.horizon,
    },
    gridSize: grid.length,
    sensitivity,
  },
}, null, 2));

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

function quantile(values: number[], q: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function round(value: number, digits = 3) {
  return Number(value.toFixed(digits));
}

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}
