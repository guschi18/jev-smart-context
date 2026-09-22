import type { Answer, JsonValue } from "./types";

export type ChunkKind =
  | "instruction"
  | "user_turn"
  | "assistant_turn"
  | "tool_transaction"
  | "decision"
  | "error"
  | "task_state"
  | "summary";

export type TranscriptEntry = {
  id: string;
  turn: number;
  role:
    | "system"
    | "developer"
    | "user"
    | "assistant"
    | "tool_call"
    | "tool_result"
    | "decision"
    | "task_state";
  content: string;
  toolCallId?: string;
  dependencies?: string[];
  pinned?: boolean;
  error?: boolean;
};

export type ContextChunk = {
  id: string;
  kind: ChunkKind;
  content: string;
  turn: number;
  tokenEstimate: number;
  dependencies: string[];
  pinned: boolean;
  pinReason?: string;
  source: {
    agent: "opencode" | "fixture";
    messageIds: string[];
    toolCallId?: string;
  };
};

export type SummaryVariants = {
  version: 1;
  chunkId: string;
  kind: ChunkKind;
  turn: number;
  sourceMessageIds: string[];
  full: { content: string; tokenEstimate: number };
  short: { content: string; tokenEstimate: number };
  long: { content: string; tokenEstimate: number };
};

export type SummaryLevel = "drop" | "short" | "long" | "full";

export type SummaryCandidate = {
  chunk: ContextChunk;
  variants: SummaryVariants;
};

export type SummaryDecision = {
  id: string;
  rawLevel: SummaryLevel;
  level: SummaryLevel;
  confidence: number;
  probabilities: Record<string, number>;
};

export type ChunkDecision = {
  id: string;
  kept: boolean;
  reason: string;
  relevance?: number;
};

export type CompilationResult = {
  mode: "rebuild";
  chunks: ContextChunk[];
  decisions: ChunkDecision[];
  keptChunkIds: string[];
  droppedChunkIds: string[];
  compiledContext: string;
  inputTokensBefore: number;
  inputTokensAfter: number;
  selectorLatencyMs: number;
  selectorUsage?: { inputTokens: number; outputTokens: number; costUsd?: number };
  summaryDecisions?: SummaryDecision[];
  fallbackReason?: string;
};

export type SelectionThresholds = {
  relevance: number;
};

export const DEFAULT_THRESHOLDS: SelectionThresholds = {
  relevance: 0.4,
};

export const MIN_SELECTOR_TOKENS = 100;
export const SUMMARY_SHORT_CONFIDENCE_THRESHOLD = 0.5;

export type CompileInput = {
  currentRequest: string;
  activeGoal: string;
  repository: string;
  chunks: ContextChunk[];
  summaryLevels?: boolean;
};

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*["']?[^\s"']{8,}/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}/i,
];

export function containsSecret(value: string) {
  return secretPatterns.some((pattern) => pattern.test(value));
}

export function redactSecrets(value: string) {
  return secretPatterns.reduce(
    (text, pattern) =>
      text.replace(new RegExp(pattern.source, `${pattern.flags}g`), "[REDACTED]"),
    value,
  );
}

export function estimateTokens(value: string) {
  return Math.max(1, Math.ceil(value.length / 4));
}

export function createSummaryVariants(chunk: ContextChunk): SummaryVariants | undefined {
  if (
    chunk.pinned ||
    chunk.kind === "user_turn" ||
    chunk.tokenEstimate < MIN_SELECTOR_TOKENS ||
    containsSecret(chunk.content)
  ) {
    return undefined;
  }

  const content = chunk.content.replace(/\s+/g, " ").trim();
  if (!content) return undefined;

  // ponytail: extractive head/tail summaries are the Phase 5 baseline; use a
  // generative model only if replay quality proves this loses needed context.
  const summarize = (cap: number, ratio: number) => {
    const marker = " ... [omitted] ... ";
    const length = Math.min(cap, Math.floor(content.length * ratio));
    const available = Math.max(2, length - marker.length);
    const head = Math.ceil(available * 0.65);
    return `${content.slice(0, head).trimEnd()}${marker}${content.slice(-Math.max(1, available - head)).trimStart()}`;
  };
  const short = summarize(240, 0.25);
  const long = summarize(800, 0.7);

  return {
    version: 1,
    chunkId: chunk.id,
    kind: chunk.kind,
    turn: chunk.turn,
    sourceMessageIds: chunk.source.messageIds,
    full: { content: chunk.content, tokenEstimate: chunk.tokenEstimate },
    short: { content: short, tokenEstimate: estimateTokens(short) },
    long: { content: long, tokenEstimate: estimateTokens(long) },
  };
}

export function normalizeTranscript(
  entries: TranscriptEntry[],
  currentEntryId: string,
): ContextChunk[] {
  const consumed = new Set<string>();
  const maxTurn = Math.max(0, ...entries.map((entry) => entry.turn));
  const chunks: ContextChunk[] = [];

  for (const entry of entries) {
    if (consumed.has(entry.id)) continue;

    if (entry.role === "tool_call" && entry.toolCallId) {
      const result = entries.find(
        (candidate) =>
          candidate.role === "tool_result" &&
          candidate.toolCallId === entry.toolCallId,
      );
      if (result) consumed.add(result.id);
      const content = result
        ? `Tool call:\n${entry.content}\n\nTool result:\n${result.content}`
        : `Unfinished tool call:\n${entry.content}`;
      const sensitive = containsSecret(content);
      chunks.push({
        id: `tool:${entry.toolCallId}`,
        kind: result?.error ? "error" : "tool_transaction",
        content,
        turn: entry.turn,
        tokenEstimate: estimateTokens(content),
        dependencies: [...new Set([...(entry.dependencies ?? []), ...(result?.dependencies ?? [])])],
        pinned: !result || Boolean(result.error) || sensitive || entry.turn >= maxTurn - 1,
        pinReason: !result
          ? "unfinished tool transaction"
          : result.error
            ? "last error state"
            : sensitive
            ? "sensitive content stays local"
            : entry.turn >= maxTurn - 1
              ? "recent context"
              : undefined,
        source: {
          agent: "opencode",
          messageIds: [entry.id, ...(result ? [result.id] : [])],
          toolCallId: entry.toolCallId,
        },
      });
      continue;
    }

    if (entry.role === "tool_result") {
      const content = `Orphaned tool result:\n${entry.content}`;
      chunks.push({
        id: entry.id,
        kind: entry.error ? "error" : "tool_transaction",
        content,
        turn: entry.turn,
        tokenEstimate: estimateTokens(content),
        dependencies: entry.dependencies ?? [],
        pinned: true,
        pinReason: "unmatched tool result",
        source: { agent: "opencode", messageIds: [entry.id], toolCallId: entry.toolCallId },
      });
      continue;
    }

    const kind: ChunkKind =
      entry.role === "system" || entry.role === "developer"
        ? "instruction"
        : entry.role === "user"
          ? "user_turn"
          : entry.role === "decision"
            ? "decision"
            : entry.role === "task_state"
              ? "task_state"
              : "assistant_turn";
    const sensitive = containsSecret(entry.content);
    const instruction = kind === "instruction";
    const current = entry.id === currentEntryId;
    const recent = entry.turn >= maxTurn - 1;
    const pinned = Boolean(entry.pinned || instruction || current || sensitive || recent);
    chunks.push({
      id: entry.id,
      kind,
      content: entry.content,
      turn: entry.turn,
      tokenEstimate: estimateTokens(entry.content),
      dependencies: entry.dependencies ?? [],
      pinned,
      pinReason: entry.pinned
        ? "explicitly open work"
        : instruction
          ? "instruction"
          : current
            ? "current user turn"
            : sensitive
              ? "sensitive content stays local"
              : recent
                ? "recent context"
                : undefined,
      source: { agent: "opencode", messageIds: [entry.id] },
    });
  }

  return chunks.sort((a, b) => a.turn - b.turn);
}

export function closeDependencies(chunks: ContextChunk[], initial: Set<string>) {
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const kept = new Set(initial);
  const queue = [...kept];
  while (queue.length) {
    const chunk = byId.get(queue.shift()!);
    for (const dependency of chunk?.dependencies ?? []) {
      if (byId.has(dependency) && !kept.has(dependency)) {
        kept.add(dependency);
        queue.push(dependency);
      }
    }
  }
  return kept;
}

export function prefilterChunks(chunks: ContextChunk[]) {
  const referenced = new Set(chunks.flatMap((chunk) => chunk.dependencies));
  const seen = new Set<string>();
  const kept = new Set<string>();
  const dropped = new Map<string, string>();

  for (const chunk of [...chunks].reverse()) {
    const content = chunk.content.trim();
    const key = `${chunk.kind}\0${content}`;
    if (!chunk.pinned && !referenced.has(chunk.id) && !content) {
      dropped.set(chunk.id, "empty context");
    } else if (!chunk.pinned && !referenced.has(chunk.id) && seen.has(key)) {
      dropped.set(chunk.id, "exact duplicate");
    } else {
      kept.add(chunk.id);
      seen.add(key);
    }
  }

  return {
    chunks: chunks.filter((chunk) => kept.has(chunk.id)),
    dropped,
  };
}

export function buildSelectorRequest(input: CompileInput, model: string) {
  const candidates = prefilterChunks(input.chunks).chunks.filter(
    (chunk) =>
      !chunk.pinned &&
      chunk.kind !== "user_turn" &&
      chunk.tokenEstimate >= MIN_SELECTOR_TOKENS &&
      !containsSecret(chunk.content),
  );
  const questions = Object.fromEntries(
    candidates.map((chunk, index) => [
      `relevance_${index}`,
      {
        type: "noul" as const,
        instructions: {
          question: "Is this candidate needed to complete the current request correctly?",
          candidate: { kind: chunk.kind, content: redactSecrets(chunk.content) },
        },
        criteria: {
          true: "Removing it could change the implementation, violate a requirement, repeat work, or hide a necessary fact.",
          false: "It is unrelated, superseded, already reflected elsewhere, or unnecessary for the current request.",
        },
      },
    ]),
  );

  return {
    candidates,
    request: {
      model,
      state: {
        current_request: redactSecrets(input.currentRequest),
        active_goal: redactSecrets(input.activeGoal),
        repository: redactSecrets(input.repository),
      } satisfies JsonValue,
      questions,
    },
  };
}

export function buildSummarySelectorRequest(input: CompileInput, model: string) {
  const candidates = prefilterChunks(input.chunks).chunks.flatMap((chunk) => {
    const variants = createSummaryVariants(chunk);
    return variants ? [{ chunk, variants }] : [];
  });
  const questions = Object.fromEntries(
    candidates.map(({ chunk, variants }, index) => [
      `summary_${index}`,
      {
        type: "choice" as const,
        instructions: {
          question: "What is the smallest representation of this candidate that preserves everything needed to complete the current request correctly?",
          candidate: {
            kind: chunk.kind,
            full: redactSecrets(variants.full.content),
            short: variants.short.content,
            long: variants.long.content,
          },
        },
        criteria: {
          drop: "The candidate is unrelated, superseded, or unnecessary.",
          short: "The short variant preserves every fact needed for the current request.",
          long: "The short variant loses needed detail, but the long variant preserves it.",
          full: "Only the full candidate preserves exact details needed for correct work.",
        },
      },
    ]),
  );

  return {
    candidates,
    request: {
      model,
      state: {
        current_request: redactSecrets(input.currentRequest),
        active_goal: redactSecrets(input.activeGoal),
        repository: redactSecrets(input.repository),
      } satisfies JsonValue,
      questions,
    },
  };
}

export function readSummaryDecisions(
  candidates: SummaryCandidate[],
  answers: Record<string, Answer>,
  shortConfidenceThreshold = SUMMARY_SHORT_CONFIDENCE_THRESHOLD,
): SummaryDecision[] {
  const levels: SummaryLevel[] = ["drop", "short", "long", "full"];
  return candidates.map(({ chunk }, index) => {
    const answer = answers[`summary_${index}`];
    if (
      answer?.type !== "choice" ||
      !levels.includes(answer.choice as SummaryLevel) ||
      !Number.isFinite(answer.confidence) ||
      answer.confidence < 0 ||
      answer.confidence > 1 ||
      !answer.probabilities ||
      levels.some((level) => !Number.isFinite(answer.probabilities[level]))
    ) {
      throw new Error(`Missing summary choice for ${chunk.id}`);
    }
    return {
      id: chunk.id,
      rawLevel: answer.choice as SummaryLevel,
      level: answer.choice === "short" && answer.confidence < shortConfidenceThreshold
        ? "long"
        : answer.choice as SummaryLevel,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
    };
  });
}

export function compileSummarySelection(
  input: CompileInput,
  answers: Record<string, Answer>,
  selectorLatencyMs: number,
  selectorUsage?: { inputTokens: number; outputTokens: number; costUsd?: number },
): CompilationResult {
  const prefiltered = prefilterChunks(input.chunks);
  const { candidates } = buildSummarySelectorRequest(input, "");
  const parsed = readSummaryDecisions(candidates, answers);
  const levels = new Map(input.chunks.map((chunk) => [chunk.id, "full" as SummaryLevel]));
  for (const id of prefiltered.dropped.keys()) levels.set(id, "drop");
  for (const decision of parsed) levels.set(decision.id, decision.level);

  const byId = new Map(input.chunks.map((chunk) => [chunk.id, chunk]));
  const dependencies = new Set<string>();
  const queue = input.chunks.filter((chunk) => levels.get(chunk.id) !== "drop");
  while (queue.length) {
    const chunk = queue.shift()!;
    for (const id of chunk.dependencies) {
      const dependency = byId.get(id);
      if (dependency && !dependencies.has(id)) {
        dependencies.add(id);
        queue.push(dependency);
      }
    }
  }
  for (const id of dependencies) levels.set(id, "full");

  const variants = new Map(candidates.map((candidate) => [candidate.chunk.id, candidate.variants]));
  const summaryDecisions = parsed.map((decision) => ({
    ...decision,
    level: levels.get(decision.id)!,
  }));
  const selected = input.chunks.flatMap((chunk) => {
    const level = levels.get(chunk.id)!;
    if (level === "drop") return [];
    const variant = variants.get(chunk.id)?.[level];
    return [{
      ...chunk,
      content: variant?.content ?? chunk.content,
      tokenEstimate: variant?.tokenEstimate ?? chunk.tokenEstimate,
    }];
  });

  return {
    mode: "rebuild",
    chunks: input.chunks,
    decisions: input.chunks.map((chunk) => {
      const level = levels.get(chunk.id)!;
      return {
        id: chunk.id,
        kept: level !== "drop",
        reason: dependencies.has(chunk.id)
          ? "required dependency"
          : chunk.pinned
            ? chunk.pinReason ?? "pinned"
            : `summary level: ${level}`,
      };
    }),
    keptChunkIds: selected.map((chunk) => chunk.id),
    droppedChunkIds: input.chunks.filter((chunk) => levels.get(chunk.id) === "drop").map((chunk) => chunk.id),
    compiledContext: formatContext(selected),
    inputTokensBefore: input.chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0),
    inputTokensAfter: selected.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0),
    selectorLatencyMs,
    selectorUsage,
    summaryDecisions,
  };
}

export function compileSelection(
  input: CompileInput,
  answers: Record<string, Answer>,
  selectorLatencyMs: number,
  selectorUsage?: { inputTokens: number; outputTokens: number; costUsd?: number },
  thresholds = DEFAULT_THRESHOLDS,
): CompilationResult {
  const prefiltered = prefilterChunks(input.chunks);
  const candidates = prefiltered.chunks.filter(
    (chunk) =>
      !chunk.pinned &&
      chunk.kind !== "user_turn" &&
      chunk.tokenEstimate >= MIN_SELECTOR_TOKENS &&
      !containsSecret(chunk.content),
  );
  const decisions = new Map<string, ChunkDecision>();
  const selected = new Set(
    prefiltered.chunks
      .filter(
        (chunk) =>
          chunk.pinned ||
          chunk.kind === "user_turn" ||
          chunk.tokenEstimate < MIN_SELECTOR_TOKENS,
      )
      .map((chunk) => chunk.id),
  );

  input.chunks.forEach((chunk) => {
    if (chunk.pinned) {
      decisions.set(chunk.id, {
        id: chunk.id,
        kept: true,
        reason: chunk.pinReason ?? "pinned",
      });
    }
  });

  prefiltered.chunks.forEach((chunk) => {
    if (!chunk.pinned && chunk.kind === "user_turn") {
      decisions.set(chunk.id, {
        id: chunk.id,
        kept: true,
        reason: "user instruction",
      });
    } else if (!chunk.pinned && chunk.tokenEstimate < MIN_SELECTOR_TOKENS) {
      decisions.set(chunk.id, {
        id: chunk.id,
        kept: true,
        reason: "cheaper to keep than classify",
      });
    }
  });

  for (const [id, reason] of prefiltered.dropped) {
    decisions.set(id, { id, kept: false, reason: `deterministic prefilter: ${reason}` });
  }

  candidates.forEach((chunk, index) => {
    const relevanceAnswer = answers[`relevance_${index}`];
    if (relevanceAnswer?.type !== "noul") {
      throw new Error(`Missing selector answers for ${chunk.id}`);
    }
    const kept = relevanceAnswer.noul >= thresholds.relevance;
    if (kept) selected.add(chunk.id);
    decisions.set(chunk.id, {
      id: chunk.id,
      kept,
      relevance: relevanceAnswer.noul,
      reason: kept ? "relevant, binding, or uncertain" : "clearly irrelevant",
    });
  });

  const closed = closeDependencies(input.chunks, selected);
  for (const id of closed) {
    if (!selected.has(id)) {
      decisions.set(id, { id, kept: true, reason: "required dependency" });
    }
  }

  return makeResult(input.chunks, closed, [...decisions.values()], selectorLatencyMs, selectorUsage);
}

export function fallbackCompilation(
  chunks: ContextChunk[],
  reason: string,
  selectorLatencyMs = 0,
): CompilationResult {
  return {
    ...makeResult(
      chunks,
      new Set(chunks.map((chunk) => chunk.id)),
      chunks.map((chunk) => ({ id: chunk.id, kept: true, reason: "fail-safe fallback" })),
      selectorLatencyMs,
    ),
    fallbackReason: reason,
  };
}

function makeResult(
  chunks: ContextChunk[],
  kept: Set<string>,
  decisions: ChunkDecision[],
  selectorLatencyMs: number,
  selectorUsage?: { inputTokens: number; outputTokens: number; costUsd?: number },
): CompilationResult {
  const ordered = chunks.filter((chunk) => kept.has(chunk.id));
  return {
    mode: "rebuild",
    chunks,
    decisions,
    keptChunkIds: ordered.map((chunk) => chunk.id),
    droppedChunkIds: chunks.filter((chunk) => !kept.has(chunk.id)).map((chunk) => chunk.id),
    compiledContext: formatContext(ordered),
    inputTokensBefore: chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0),
    inputTokensAfter: ordered.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0),
    selectorLatencyMs,
    selectorUsage,
  };
}

export function formatContext(chunks: ContextChunk[]) {
  return chunks
    .map((chunk) => `[${chunk.kind} | turn ${chunk.turn} | ${chunk.id}]\n${chunk.content}`)
    .join("\n\n---\n\n");
}
