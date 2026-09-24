// Cache-aware routing between reusing the previously sent prefix and a fresh
// compilation. Pure logic: no I/O, no network. The OpenCode plugin imports it.

export type ModelPricing = {
  inputPerM: number;
  cacheReadPerM: number;
  cacheWritePerM: number;
  contextLimit: number;
};

export type PricingFile = {
  updatedAt: string;
  models: Record<string, Partial<ModelPricing>>;
};

export type DispatchUsage = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  costUsd?: number;
  at?: number;
};

export type Warmth = "warm" | "uncertain" | "cold";

export type WarmthCalibration = {
  warmMs: number;
  uncertainMs: number;
};

/** Pricing key as OpenCode names a model: `<providerID>/<modelID>`. */
export function pricingKey(model: { providerID?: string; id?: string } | undefined) {
  return model?.providerID && model.id ? `${model.providerID}/${model.id}` : undefined;
}

/** Reads one model's prices; anything missing or non-finite disables routing. */
export function readPricing(file: unknown, key: string | undefined): ModelPricing | undefined {
  if (!key || !file || typeof file !== "object") return undefined;
  const entry = (file as PricingFile).models?.[key];
  if (!entry || typeof entry !== "object") return undefined;
  const { inputPerM, cacheReadPerM, contextLimit } = entry;
  // Implicit provider caching has no write surcharge: a cache write costs input.
  const cacheWritePerM = entry.cacheWritePerM ?? inputPerM;
  const values = [inputPerM, cacheReadPerM, cacheWritePerM, contextLimit];
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)) {
    return undefined;
  }
  if (!contextLimit) return undefined;
  return {
    inputPerM: inputPerM!,
    cacheReadPerM: cacheReadPerM!,
    cacheWritePerM: cacheWritePerM!,
    contextLimit: contextLimit!,
  };
}

/** Normalizes an OpenCode V2 assistant step (`tokens.cache.read/write`). */
export function normalizeUsage(message: unknown): DispatchUsage | undefined {
  if (!message || typeof message !== "object") return undefined;
  const record = message as {
    tokens?: { input?: unknown; output?: unknown; cache?: { read?: unknown; write?: unknown } };
    cost?: unknown;
    time?: { completed?: unknown; created?: unknown };
  };
  const tokens = record.tokens;
  const numbers = [tokens?.input, tokens?.output, tokens?.cache?.read, tokens?.cache?.write];
  if (!numbers.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return undefined;
  }
  const at = record.time?.completed ?? record.time?.created;
  return {
    input: tokens!.input as number,
    output: tokens!.output as number,
    cacheRead: tokens!.cache!.read as number,
    cacheWrite: tokens!.cache!.write as number,
    ...(typeof record.cost === "number" ? { costUsd: record.cost } : {}),
    ...(typeof at === "number" ? { at } : {}),
  };
}

export function cacheWarmth(gapMs: number, calibration: WarmthCalibration): Warmth {
  if (!Number.isFinite(gapMs) || gapMs < 0) return "cold";
  if (gapMs <= calibration.warmMs) return "warm";
  if (gapMs <= calibration.uncertainMs) return "uncertain";
  return "cold";
}

export type RoutingConfig = WarmthCalibration & {
  /** Probability that a warm/uncertain/cold prefix is still read from cache. */
  pHit: Record<Warmth, number>;
  /** Cache hit share a rebuilt (shortened) context still gets: its head is unchanged. */
  pHitRebuild: number;
  /** compiled/original tokens assumed until a compile with selector decisions was seen. */
  keepRatioPrior: number;
  /** Expected further dispatches that reuse the chosen context. */
  horizon: number;
  /** Relative cost gap required for a clear decision; smaller gaps are gray. */
  margin: number;
  /** Share of the effective window at which reuse is refused. */
  pressureRatio: number;
  /** OpenCode's automatic compaction threshold in tokens. */
  compactionTokens: number;
  continuityReuse: number;
  continuityRebuild: number;
  /** Smoothing for keep ratio and selector cost averages. */
  emaAlpha: number;
  /** Turn policy: re-judge frozen context only above this real prompt size. */
  refreshMinTokens: number;
  /** Turn policy: ... and after the prompt grew by this factor since the last re-judgement. */
  refreshGrowth: number;
  /** Turn policy: dispatches over which a removal must pay for its cache break. */
  refreshHorizon: number;
};

// Calibrated offline (Phase 6, step 4, `npm run calibrate:cache`): pHit is the
// token-weighted native cache hit share per warmth class, TTL borders follow
// the hit curve (600–1800 s drops to 0.13), horizon = median dispatches per
// user turn (3) minus the current one. margin and pressureRatio were flat in
// the replay and keep their conservative start values. pHitRebuild is the
// measured hit share right after a context mutation (0.52); keepRatioPrior is
// the median compiled/original ratio of compiles with selector decisions (0.64).
export const DEFAULT_ROUTING: RoutingConfig = {
  warmMs: 300_000,
  uncertainMs: 600_000,
  pHit: { warm: 0.89, uncertain: 0.72, cold: 0.07 },
  pHitRebuild: 0.52,
  keepRatioPrior: 0.64,
  horizon: 2,
  margin: 0.1,
  pressureRatio: 0.8,
  compactionTokens: 108_000,
  continuityReuse: 0.6,
  continuityRebuild: 0.4,
  emaAlpha: 0.3,
  refreshMinTokens: 40_000,
  refreshGrowth: 1.5,
  refreshHorizon: 10,
};

export type Route = "reuse" | "rebuild";

export type RouteInput = {
  prefix: "valid" | "none" | "invalid";
  pricing?: ModelPricing;
  /** No new user turn since the last dispatch (agent tool loop). */
  sameUserTurn: boolean;
  gapMs: number;
  /** P: tokens of the previously sent prefix. */
  prefixTokens: number;
  /** A: tokens appended since the last dispatch. */
  appendedTokens: number;
  /** Tokens of the complete original context and of its pinned part. */
  fullTokens: number;
  pinnedTokens: number;
  /** Moving average of compiled/original tokens after rebuilds with selector decisions. */
  keepRatio?: number;
  /** Moving average of selector cost per compiler call. */
  selectorCostUsd?: number;
  /** Jev answer: does the new user turn continue the same task? */
  continuity?: number;
  /** Real compiled size once a rebuild ran; the selector cost is then sunk. */
  rebuildTokensActual?: number;
};

export type RouteDecision = {
  route: Route;
  reason: string;
  warmth: Warmth;
  /** Gray zone on a new user turn: ask Jev for task continuity. */
  needsContinuity?: boolean;
  reuseTokens: number;
  rebuildTokensEstimated?: number;
  reuseUsdEstimated?: number;
  rebuildUsdEstimated?: number;
};

/** Deterministic reuse/rebuild decision; same input, same decision. */
export function decideRoute(input: RouteInput, config: RoutingConfig = DEFAULT_ROUTING): RouteDecision {
  const warmth = cacheWarmth(input.gapMs, config);
  const reuseTokens = input.prefixTokens + input.appendedTokens;
  const base = { warmth, reuseTokens };
  const rebuild = (reason: string, extra: Partial<RouteDecision> = {}): RouteDecision =>
    ({ ...base, ...extra, route: "rebuild", reason });
  const reuse = (reason: string, extra: Partial<RouteDecision> = {}): RouteDecision =>
    ({ ...base, ...extra, route: "reuse", reason });

  // 1. Without a valid prefix or prices there is nothing to weigh: status quo.
  if (!input.pricing) return rebuild("no pricing");
  if (input.prefix === "none") return rebuild("first dispatch");
  if (input.prefix === "invalid") return rebuild("invalid prefix");

  // 2. Context pressure always wins over cache savings.
  const window = Math.min(input.pricing.contextLimit, config.compactionTokens);
  if (reuseTokens >= config.pressureRatio * window) return rebuild("context pressure");

  // 3. Tool-loop step on a warm cache: everything since the user turn is
  // pinned as current work anyway, the older rest was judged for this task.
  if (input.sameUserTurn && warmth === "warm") return reuse("tool loop, warm cache");

  // 4. A cold prefix gives reuse no cache advantage.
  if (warmth === "cold") return rebuild("cold cache");

  // 5. Cost comparison over the expected horizon.
  const cr = input.pricing.cacheReadPerM / 1e6;
  const cw = input.pricing.cacheWritePerM / 1e6;
  const pHit = config.pHit[warmth];
  const P = input.prefixTokens;
  const A = input.appendedTokens;
  const actual = input.rebuildTokensActual !== undefined;
  const R = actual
    ? input.rebuildTokensActual!
    : Math.max(input.pinnedTokens, Math.round(input.fullTokens * (input.keepRatio ?? config.keepRatioPrior)));
  const S = actual ? 0 : input.selectorCostUsd ?? 0;
  const H = config.horizon;
  // A rebuild keeps the unchanged head of the context, so part of it still hits.
  const pHitRebuild = Math.min(config.pHitRebuild, pHit);
  const reuseUsd = pHit * P * cr + (1 - pHit) * P * cw + A * cw + H * (P + A) * cr;
  const rebuildUsd = pHitRebuild * R * cr + (1 - pHitRebuild) * R * cw + S + H * R * cr;
  const costs = { rebuildTokensEstimated: R, reuseUsdEstimated: reuseUsd, rebuildUsdEstimated: rebuildUsd };

  if (rebuildUsd < reuseUsd * (1 - config.margin)) return rebuild("rebuild cheaper", costs);
  if (reuseUsd < rebuildUsd * (1 - config.margin)) return reuse("reuse cheaper", costs);
  if (input.sameUserTurn) return rebuild("gray zone", costs);

  // Gray zone on a new user turn: Jev judges only task continuity.
  if (input.continuity === undefined) return rebuild("gray zone", { ...costs, needsContinuity: true });
  if (input.continuity >= config.continuityReuse) return reuse("continuing task", costs);
  if (input.continuity <= config.continuityRebuild) return rebuild("new task", costs);
  return rebuild("uncertain continuity", costs);
}

export type TurnRoute = "reuse" | "prune" | "refresh" | "full";

export type TurnRouteInput = {
  prefix: "valid" | "none" | "invalid";
  sameUserTurn: boolean;
  gapMs: number;
  /** Next provider prompt: real prompt of the last model step plus what was appended since. */
  promptTokens: number;
  /** False when the provider usage was unavailable and promptTokens is an estimate. */
  promptTokensReal: boolean;
  /** The model's real context window; without it the compaction default applies. */
  contextLimit?: number;
  /** Prompt size when the frozen context was last judged as a whole. */
  lastRefreshPromptTokens?: number;
};

export type TurnRouteDecision = {
  route: TurnRoute;
  reason: string;
  warmth: Warmth;
  /** A refresh under pressure is applied even when it does not pay for its cache break. */
  force?: boolean;
};

/**
 * Turn-batched policy: the sent prefix stays byte-identical, tool-loop steps
 * only append, and Jev judges new context once per user turn. Everything
 * already sent is frozen, so a prune can only break the cache behind it.
 */
export function decideTurnRoute(input: TurnRouteInput, config: RoutingConfig = DEFAULT_ROUTING): TurnRouteDecision {
  const warmth = cacheWarmth(input.gapMs, config);
  const decision = (route: TurnRoute, reason: string, force?: boolean): TurnRouteDecision =>
    ({ route, reason, warmth, ...(force ? { force } : {}) });

  if (input.prefix === "none") return decision("full", "first dispatch");
  if (input.prefix === "invalid") return decision("full", "invalid prefix");
  // The real window of the model; caches may outlive a pause, so warmth alone
  // never triggers a re-judgement.
  const window = input.contextLimit ?? config.compactionTokens;
  if (input.promptTokens >= config.pressureRatio * window) return decision("refresh", "context pressure", true);
  if (input.sameUserTurn) return decision("reuse", "tool loop");
  if (
    input.promptTokens >= config.refreshMinTokens &&
    input.promptTokens >= config.refreshGrowth * (input.lastRefreshPromptTokens ?? 0)
  ) {
    return decision("refresh", "context growth");
  }
  return decision("prune", "new user turn");
}

/**
 * A re-judgement of frozen context breaks the cache from its first removal on.
 * It pays when the removed tokens, read over the horizon, cost more than
 * writing the tail behind the break once more.
 */
export function refreshPays(
  input: { removedTokens: number; tailTokens: number; pricing?: ModelPricing },
  config: RoutingConfig = DEFAULT_ROUTING,
) {
  if (!input.pricing || input.removedTokens <= 0) return false;
  const cr = input.pricing.cacheReadPerM;
  const cw = input.pricing.cacheWritePerM;
  return input.removedTokens * cr * config.refreshHorizon >= input.tailTokens * Math.max(0, cw - cr);
}

export function movingAverage(previous: number | undefined, value: number, alpha: number) {
  return previous === undefined ? value : previous + alpha * (value - previous);
}

/**
 * One sent message: an original by key and content hash, a summary extract, or
 * an original whose listed tool parts carried the fixed "output removed" stub.
 */
export type SentEntry =
  | { key: string; hash: string }
  | { summaryOf: string; level: "short" | "long"; hash: string }
  | { stubOf: string; parts: number[]; hash: string };

/** Content-free per-session routing state: ids, hashes, numbers only. */
export type RoutingState = {
  version: 1;
  sent: SentEntry[];
  /** Key of the last original message seen at the previous dispatch. */
  lastSeenKey: string;
  /** Key of the last message Jev has judged; everything after it is still open. */
  judgedKey?: string;
  /** Real prompt size at the last re-judgement of the whole frozen context. */
  refreshPromptTokens?: number;
  sentTokens: number;
  lastDispatchAt: number;
  lastUserKey: string;
  pricingModel: string;
  keepRatio?: number;
  selectorCostUsd?: number;
};

export function parseRoutingState(value: unknown): RoutingState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const state = value as Partial<RoutingState>;
  const finite = (item: unknown) => typeof item === "number" && Number.isFinite(item) && item >= 0;
  const optional = (item: unknown) => item === undefined || finite(item);
  const entryValid = (entry: unknown) => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    if (typeof item.hash !== "string") return false;
    return typeof item.key === "string" ||
      (typeof item.summaryOf === "string" && (item.level === "short" || item.level === "long")) ||
      (typeof item.stubOf === "string" && Array.isArray(item.parts) && item.parts.length > 0 &&
        item.parts.every((part) => Number.isInteger(part) && (part as number) >= 0));
  };
  if (
    state.version !== 1 ||
    !Array.isArray(state.sent) || !state.sent.every(entryValid) ||
    typeof state.lastSeenKey !== "string" ||
    (state.judgedKey !== undefined && typeof state.judgedKey !== "string") ||
    typeof state.lastUserKey !== "string" ||
    typeof state.pricingModel !== "string" ||
    !finite(state.sentTokens) || !finite(state.lastDispatchAt) ||
    !optional(state.keepRatio) || !optional(state.selectorCostUsd) || !optional(state.refreshPromptTokens)
  ) {
    return undefined;
  }
  return state as RoutingState;
}
