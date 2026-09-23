import {
  buildSummarySelectorRequest,
  createSummaryVariants,
  normalizeTranscript,
  prefilterChunks,
  type CompilationResult,
  type CompileInput,
  type ContextChunk,
  type SummaryLevel,
  type TranscriptEntry,
} from "../../src/lib/context.ts";

type Message = { id?: string; role: string; content?: unknown; [key: string]: unknown };
type ContextEvent = { readonly sessionID: string; messages: Message[] };
type PluginContext = {
  location: { directory: string; project: { canonical?: string } };
  session: {
    hook(name: "context", callback: (event: ContextEvent) => Promise<void>): Promise<unknown>;
  };
  storage: { set(key: string, value: Record<string, unknown>): Promise<void> };
};

type PreparedContext = {
  input: CompileInput;
  entryToMessage: Map<string, number>;
};

const ENDPOINT = process.env.JEV_CONTEXT_ENDPOINT?.trim() || "http://127.0.0.1:3000/api/context";
const MAX_CHUNKS = 200;
const MAX_BODY_BYTES = 256_000;

export function prepareContext(messages: Message[], repository: string): PreparedContext {
  const entries: TranscriptEntry[] = [];
  const entryToMessage = new Map<string, number>();
  let currentEntryId = "";

  messages.forEach((message, turn) => {
    const parts = Array.isArray(message.content) ? message.content : [message.content ?? ""];
    const general: unknown[] = [];

    parts.forEach((part, partIndex) => {
      const type = partType(part);
      const toolCallId = toolId(part) ?? toolId(message);
      if (type === "tool" && toolCallId && part && typeof part === "object") {
        const tool = part as Record<string, unknown>;
        const state = tool.state && typeof tool.state === "object"
          ? tool.state as Record<string, unknown>
          : {};
        const id = `message:${turn}:part:${partIndex}`;
        entries.push({
          id: `${id}:call`, turn, role: "tool_call", toolCallId,
          content: compact({ name: tool.name, input: state.input }),
        });
        entryToMessage.set(`${id}:call`, turn);
        if (state.status === "completed" || state.status === "error") {
          entries.push({
            id: `${id}:result`, turn, role: "tool_result", toolCallId,
            content: compact(state.content ?? state.output ?? ""),
            error: isToolError(part),
          });
          entryToMessage.set(`${id}:result`, turn);
        }
        return;
      }
      const role = type === "tool-call" || type === "tool-use"
        ? "tool_call"
        : type === "tool-result" || message.role === "tool"
          ? "tool_result"
          : undefined;

      if (!role || !toolCallId) {
        general.push(part);
        return;
      }

      const id = `message:${turn}:part:${partIndex}`;
      entries.push({
        id,
        turn,
        role,
        toolCallId,
        content: compact(part),
        error: role === "tool_result" && isToolError(part),
      });
      entryToMessage.set(id, turn);
    });

    if (general.length || !parts.length) {
      const id = `message:${turn}`;
      const knownRole = message.role === "system"
        ? "system"
        : message.role === "user"
          ? "user"
          : "assistant";
      entries.push({
        id,
        turn,
        role: knownRole,
        content: compact(general.length === 1 ? general[0] : general),
        pinned: !["system", "user", "assistant"].includes(message.role),
      });
      entryToMessage.set(id, turn);
      if (message.role === "user") currentEntryId = id;
    }
  });

  const currentRequest = currentEntryId
    ? entries.find((entry) => entry.id === currentEntryId)?.content ?? ""
    : "Continue the current agent task.";

  return {
    input: {
      currentRequest,
      activeGoal: currentRequest,
      repository,
      chunks: normalizeTranscript(entries, currentEntryId),
    },
    entryToMessage,
  };
}

export function selectMessages(
  messages: Message[],
  prepared: PreparedContext,
  keptChunkIds: string[],
) {
  const keptChunks = new Set(keptChunkIds);
  const keptMessages = new Set<number>();

  for (const chunk of prepared.input.chunks) {
    if (!keptChunks.has(chunk.id)) continue;
    for (const id of chunk.source.messageIds) {
      const index = prepared.entryToMessage.get(id);
      if (index !== undefined) keptMessages.add(index);
    }
  }

  // A model message may contain several tool calls. Keeping any part keeps every
  // linked result so the provider never receives an orphaned tool transaction.
  let changed = true;
  while (changed) {
    changed = false;
    for (const chunk of prepared.input.chunks) {
      const indices = chunk.source.messageIds
        .map((id) => prepared.entryToMessage.get(id))
        .filter((index): index is number => index !== undefined);
      if (!indices.some((index) => keptMessages.has(index))) continue;
      for (const index of indices) {
        if (!keptMessages.has(index)) {
          keptMessages.add(index);
          changed = true;
        }
      }
    }
  }

  return messages.filter((_, index) => keptMessages.has(index));
}

const plugin = {
  id: "jev-context",
  async setup(ctx: PluginContext) {
    await ctx.session.hook("context", async (event) => {
      const started = performance.now();
      const messagesBefore = event.messages.length;
      const prepared = prepareContext(
        event.messages,
        ctx.location.project.canonical || ctx.location.directory,
      );
      const useSummaryLevels = process.env.JEV_SUMMARY_LEVELS?.trim() === "1";
      const summariesExpected = prepared.input.chunks.filter(createSummaryVariants).length;
      const summariesStored = storeSummaryVariants(
        ctx.storage,
        event.sessionID,
        prepared.input.chunks,
      );
      const inputTokensBefore = prepared.input.chunks.reduce(
        (sum, chunk) => sum + chunk.tokenEstimate,
        0,
      );
      const apiKey = process.env.OPENROUTER_API_KEY?.trim();
      let summariesStoredCount: number | undefined;

      try {
        if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing");
        if (!isLoopback(ENDPOINT)) throw new Error("JEV_CONTEXT_ENDPOINT must be local");
        if (prepared.input.chunks.length > MAX_CHUNKS) throw new Error("Context has more than 200 chunks");

        const body = JSON.stringify(
          useSummaryLevels ? { ...prepared.input, summaryLevels: true } : prepared.input,
        );
        if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) throw new Error("Context payload is too large");

        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-openrouter-api-key": apiKey,
          },
          body,
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) throw new Error(`Compiler failed (HTTP ${response.status})`);

        const result = await response.json() as CompilationResult;
        validateResult(prepared.input.chunks, result);
        if (useSummaryLevels) {
          summariesStoredCount = await summariesStored;
          if (summariesStoredCount !== summariesExpected) throw new Error("Summary storage failed");
        }
        if (useSummaryLevels && !result.fallbackReason) {
          validateSummaryResult(prepared.input, result);
        }
        const applied = useSummaryLevels && !result.fallbackReason
          ? applySummaryLevels(event.messages, prepared, result)
          : { messages: selectMessages(event.messages, prepared, result.keptChunkIds), appliedLevels: new Map<string, SummaryLevel>() };
        const compiled = applied.messages;
        const inputTokensAfter = prepareContext(
          compiled,
          ctx.location.project.canonical || ctx.location.directory,
        ).input.chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0);
        if (!result.fallbackReason && (useSummaryLevels || compiled.length < event.messages.length)) {
          event.messages = compiled;
        }

        await recordMetric(ctx, event.sessionID, started, {
          status: result.fallbackReason ? "fallback" : "compiled",
          messagesBefore,
          messagesAfter: result.fallbackReason ? event.messages.length : compiled.length,
          inputTokensBefore,
          inputTokensAfter: result.fallbackReason ? result.inputTokensBefore : inputTokensAfter,
          selectorLatencyMs: result.selectorLatencyMs,
          selectorCostUsd: result.selectorUsage?.costUsd,
          selectorCachedQuestions: result.selectorCachedQuestions,
          summariesStored: summariesStoredCount ?? await summariesStored,
          summaryLevels: useSummaryLevels || undefined,
          fallbackReason: result.fallbackReason,
          selection: useSummaryLevels
            ? (result.summaryDecisions ?? []).map((decision) => {
              const chunk = prepared.input.chunks.find((item) => item.id === decision.id);
              return {
                kind: chunk?.kind ?? "unknown",
                tokens: chunk?.tokenEstimate ?? 0,
                rawLevel: decision.rawLevel,
                level: decision.level,
                appliedLevel: applied.appliedLevels.get(decision.id) ?? decision.level,
                confidence: decision.confidence,
                probabilities: decision.probabilities,
              };
            })
            : result.decisions.filter((decision) => decision.relevance !== undefined).map((decision) => {
              const chunk = prepared.input.chunks.find((item) => item.id === decision.id);
              return {
                kind: chunk?.kind ?? "unknown",
                tokens: chunk?.tokenEstimate ?? 0,
                kept: decision.kept,
                relevance: decision.relevance,
              };
            }),
        });
      } catch (error) {
        await recordMetric(ctx, event.sessionID, started, {
          status: "fallback",
          messagesBefore: event.messages.length,
          messagesAfter: event.messages.length,
          inputTokensBefore,
          inputTokensAfter: inputTokensBefore,
          summariesStored: summariesStoredCount ?? await summariesStored,
          summaryLevels: useSummaryLevels || undefined,
          fallbackReason: error instanceof Error ? error.message : String(error),
        });
      }
    });
  },
};

export default plugin;

export async function storeSummaryVariants(
  storage: PluginContext["storage"],
  sessionID: string,
  chunks: ContextChunk[],
) {
  try {
    const summaries = chunks.map(createSummaryVariants).filter((value) => value !== undefined);
    const stored = await Promise.all(
      summaries.map(async (summary) => {
        try {
          await storage.set(
            `summaries/${encodeURIComponent(sessionID)}/${encodeURIComponent(summary.chunkId)}`,
            summary,
          );
          return true;
        } catch {
          // Summary persistence must never block a model request.
          return false;
        }
      }),
    );
    return stored.filter(Boolean).length;
  } catch {
    return 0;
  }
}

export function applySummaryLevels(
  messages: Message[],
  prepared: PreparedContext,
  result: CompilationResult,
) {
  const levels = new Map(prepared.input.chunks.map((chunk) => [chunk.id, "full" as SummaryLevel]));
  for (const id of result.droppedChunkIds) levels.set(id, "drop");
  for (const decision of result.summaryDecisions ?? []) levels.set(decision.id, decision.level);

  const byId = new Map(prepared.input.chunks.map((chunk) => [chunk.id, chunk]));
  const byMessage = new Map<number, string[]>();
  for (const chunk of prepared.input.chunks) {
    for (const id of chunk.source.messageIds) {
      const index = prepared.entryToMessage.get(id);
      if (index === undefined) continue;
      byMessage.set(index, [...(byMessage.get(index) ?? []), chunk.id]);
    }
  }

  const visited = new Set<string>();
  const removed = new Set<number>();
  const replacements = new Map<number, Message[]>();
  const appliedLevels = new Map<string, SummaryLevel>();

  for (const first of prepared.input.chunks) {
    if (visited.has(first.id)) continue;
    const component: ContextChunk[] = [];
    const indices = new Set<number>();
    const queue = [first.id];
    while (queue.length) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const chunk = byId.get(id);
      if (!chunk) continue;
      component.push(chunk);
      for (const sourceId of chunk.source.messageIds) {
        const index = prepared.entryToMessage.get(sourceId);
        if (index === undefined) continue;
        indices.add(index);
        queue.push(...(byMessage.get(index) ?? []));
      }
    }

    if (component.some((chunk) => levels.get(chunk.id) === "full")) {
      component.forEach((chunk) => appliedLevels.set(chunk.id, "full"));
      continue;
    }
    if (!indices.size) throw new Error("Summary chunk has no source message");

    const anchor = Math.min(...indices);
    const replacement = component.flatMap((chunk) => {
      const level = levels.get(chunk.id)!;
      appliedLevels.set(chunk.id, level);
      if (level === "drop") return [];
      const variants = createSummaryVariants(chunk);
      if (!variants) throw new Error(`Missing ${level} summary for ${chunk.id}`);
      return [{
        role: "assistant",
        content: [{
          type: "text",
          text: `[Previous ${chunk.kind}: ${level} extract]\n${variants[level].content}`,
        }],
      } satisfies Message];
    });
    indices.forEach((index) => removed.add(index));
    replacements.set(anchor, replacement);
  }

  const compiled = messages.flatMap((message, index) =>
    removed.has(index) ? replacements.get(index) ?? [] : [message]
  );
  if (!compiled.length) throw new Error("Summary selection removed every message");
  validateToolPairs(messages, compiled);
  return { messages: compiled, appliedLevels };
}

function validateResult(chunks: ContextChunk[], result: CompilationResult) {
  if (!Array.isArray(result.keptChunkIds) || !Array.isArray(result.droppedChunkIds)) {
    throw new Error("Compiler returned an invalid result");
  }
  const decided = new Set([...result.keptChunkIds, ...result.droppedChunkIds]);
  const kept = new Set(result.keptChunkIds);
  if (
    decided.size !== chunks.length ||
    result.keptChunkIds.length + result.droppedChunkIds.length !== chunks.length ||
    chunks.some((chunk) => !decided.has(chunk.id) || (chunk.pinned && !kept.has(chunk.id)))
  ) {
    throw new Error("Compiler returned an incomplete or unsafe selection");
  }
}

function validateSummaryResult(input: CompileInput, result: CompilationResult) {
  if (!Array.isArray(result.summaryDecisions)) {
    throw new Error("Compiler returned no summary decisions");
  }
  const expected = buildSummarySelectorRequest(input, "").candidates.map(({ chunk }) => chunk.id);
  const expectedSet = new Set(expected);
  const deterministicallyDropped = new Set(prefilterChunks(input.chunks).dropped.keys());
  const decisions = new Map(result.summaryDecisions.map((decision) => [decision.id, decision]));
  const levels: SummaryLevel[] = ["drop", "short", "long", "full"];
  if (
    result.summaryDecisions.length !== expected.length ||
    decisions.size !== expected.length ||
    expected.some((id) => !decisions.has(id))
  ) {
    throw new Error("Compiler returned incomplete summary decisions");
  }
  const kept = new Set(result.keptChunkIds);
  const dropped = new Set(result.droppedChunkIds);
  if (input.chunks.some((chunk) =>
    !expectedSet.has(chunk.id) &&
    !deterministicallyDropped.has(chunk.id) &&
    !kept.has(chunk.id)
  )) {
    throw new Error("Compiler changed a protected summary chunk");
  }
  for (const decision of decisions.values()) {
    const minimum = decision.rawLevel === "short" && decision.confidence < 0.5
      ? "long"
      : decision.rawLevel;
    if (
      !levels.includes(decision.rawLevel) ||
      !levels.includes(decision.level) ||
      levels.indexOf(decision.level) < levels.indexOf(minimum) ||
      !Number.isFinite(decision.confidence) ||
      decision.confidence < 0 ||
      decision.confidence > 1 ||
      levels.some((level) => !Number.isFinite(decision.probabilities?.[level])) ||
      (decision.level === "drop" ? !dropped.has(decision.id) : !kept.has(decision.id))
    ) {
      throw new Error("Compiler returned an invalid summary decision");
    }
  }
}

function validateToolPairs(before: Message[], after: Message[]) {
  const original = toolSides(before);
  const compiled = toolSides(after);
  for (const id of new Set([...original.calls, ...original.results])) {
    const wasComplete = original.calls.has(id) && original.results.has(id);
    const isComplete = compiled.calls.has(id) && compiled.results.has(id);
    const wasRemoved = !compiled.calls.has(id) && !compiled.results.has(id);
    if (wasComplete && !isComplete && !wasRemoved) {
      throw new Error(`Summary selection orphaned tool transaction ${id}`);
    }
  }
}

function toolSides(messages: Message[]) {
  const calls = new Set<string>();
  const results = new Set<string>();
  for (const message of messages) {
    const parts = Array.isArray(message.content) ? message.content : [message.content];
    for (const part of parts) {
      const id = toolId(part) ?? toolId(message);
      if (!id) continue;
      const type = partType(part);
      if (type === "tool-call" || type === "tool-use" || type === "tool") calls.add(id);
      if (type === "tool-result" || message.role === "tool" ||
        (type === "tool" && ["completed", "error"].includes(String((part as { state?: { status?: string } }).state?.status)))) results.add(id);
    }
  }
  return { calls, results };
}

async function recordMetric(
  ctx: PluginContext,
  sessionID: string,
  started: number,
  metric: Record<string, unknown>,
) {
  try {
    const timestamp = new Date().toISOString();
    await ctx.storage.set(`metrics/${timestamp}-${crypto.randomUUID()}`, {
      timestamp,
      sessionID,
      totalLatencyMs: Math.round(performance.now() - started),
      ...Object.fromEntries(Object.entries(metric).filter(([, value]) => value !== undefined)),
    });
  } catch {
    // Metrics must never block a model request.
  }
}

function compact(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "text" in value &&
    typeof value.text === "string" &&
    ["text", "reasoning"].includes(partType(value))
  ) {
    value = value.text;
  }
  let text: string;
  try {
    text = typeof value === "string"
      ? value
      : JSON.stringify(value, (key, item) =>
          key === "data" && typeof item === "string" && item.length > 500
            ? `[binary data omitted: ${item.length} characters]`
            : item,
        ) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length <= 12_000
    ? text
    : `${text.slice(0, 6_000)}\n\n[content truncated]\n\n${text.slice(-6_000)}`;
}

function partType(value: unknown) {
  return typeof value === "object" && value && "type" in value && typeof value.type === "string"
    ? value.type.toLowerCase().replaceAll("_", "-")
    : "";
}

function toolId(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  for (const key of ["toolCallId", "tool_call_id", "callId", "id"]) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "string") return candidate;
  }
}

function isToolError(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const state = record.state as { status?: string; metadata?: { exit?: number; error?: boolean } } | undefined;
  return record.isError === true || record.error === true || partType(record.output) === "error" ||
    state?.status === "error" || state?.metadata?.error === true ||
    (typeof state?.metadata?.exit === "number" && state.metadata.exit !== 0);
}

function isLoopback(value: string) {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}
