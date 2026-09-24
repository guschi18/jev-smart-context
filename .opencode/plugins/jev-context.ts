import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_ROUTING,
  decideRoute,
  decideTurnRoute,
  movingAverage,
  refreshPays,
  parseRoutingState,
  pricingKey,
  readPricing,
  type RouteDecision,
  type RouteInput,
  type RoutingState,
  type SentEntry,
  type TurnRouteDecision,
  type TurnRouteInput,
} from "../../src/lib/cache-routing.ts";
import {
  buildSummarySelectorRequest,
  closeDependencies,
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
type ContextEvent = {
  readonly sessionID: string;
  readonly agent?: string;
  readonly model?: { providerID: string; id: string; variant?: string };
  messages: Message[];
};
type PluginContext = {
  location: { directory: string; project: { canonical?: string } };
  session: {
    hook(name: "context", callback: (event: ContextEvent) => Promise<void>): Promise<unknown>;
    context?(input: { sessionID: string }): Promise<unknown>;
  };
  storage: {
    set(key: string, value: Record<string, unknown>): Promise<void>;
    get?(key: string): Promise<unknown>;
  };
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
    const cacheRouting = process.env.JEV_CACHE_ROUTING?.trim() === "1";
    const pricingFile = cacheRouting ? loadPricingFile() : undefined;
    const routingStates = new Map<string, RoutingState>();
    const diagnostic = process.env.JEV_HOOK_DIAGNOSTIC?.trim() === "1";
    const turnPolicy = process.env.JEV_CACHE_POLICY?.trim() === "turn";
    const lastOutgoing = new Map<string, string[]>();

    const handle = async (event: ContextEvent) => {
      const started = performance.now();
      if (diagnostic) {
        await recordDiagnostic(ctx, event);
      }
      const messagesBefore = event.messages.length;
      const original = event.messages;
      const repository = ctx.location.project.canonical || ctx.location.directory;
      const prepared = prepareContext(event.messages, repository);
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

      const routing = cacheRouting
        ? await planRoute(ctx.storage, routingStates, pricingFile, event, prepared, repository)
        : undefined;
      const turn = routing && turnPolicy && !useSummaryLevels
        ? await planTurn(ctx, event, routing, prepared, repository)
        : undefined;
      if (routing && turn) routing.decision = turn.routeDecision;
      if (routing?.decision.route === "reuse" && routing.reuseMessages) {
        // Warm prefix plus appended messages: no compiler or Jev call.
        event.messages = routing.reuseMessages;
        const saved = await saveRoute(ctx.storage, routingStates, routing, original, event.messages, repository);
        await recordMetric(ctx, event.sessionID, started, {
          status: "reused",
          messagesBefore,
          messagesAfter: event.messages.length,
          inputTokensBefore,
          inputTokensAfter: saved?.sentTokens ?? routing.decision.reuseTokens,
          summariesStored: await summariesStored,
          summaryLevels: useSummaryLevels || undefined,
          ...routeMetric(routing, routing.decision, true, saved),
          ...(turn ? turnMetric(turn, routing.reuseMessages, event.messages, repository) : {}),
        });
        return;
      }

      if (routing && turn) {
        // Turn policy: only open chunks (or, on a refresh, the kept frozen ones
        // too) go to Jev, in bounded batches; the frozen prefix stays as sent.
        let status: "compiled" | "fallback" = "compiled";
        let fallbackReason: string | undefined;
        let compiledResult: Awaited<ReturnType<typeof compileBatched>> | undefined;
        let refreshApplied: boolean | undefined;
        let refreshRemovedTokens: number | undefined;
        try {
          if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing");
          if (!isLoopback(ENDPOINT)) throw new Error("JEV_CONTEXT_ENDPOINT must be local");
          const frozen = turn.frozen;
          const judged = !frozen || turn.route === "full"
            ? prepared.input.chunks
            : turn.route === "refresh" ? frozen.refresh.input.chunks : frozen.openChunks;
          compiledResult = await compileBatched({ ...prepared.input, chunks: protectTurnText(judged) }, apiKey);
          if (compiledResult.fallbackReason) throw new Error(compiledResult.fallbackReason);
          const kept = new Set(compiledResult.keptChunkIds);
          // Messages are never removed: dropped tool outputs become fixed stubs,
          // earlier stubs stay stubs, and all turn text stays as it was.
          let compiled: Message[];
          if (!frozen || turn.route === "full") {
            compiled = stubMessages(event.messages, prepared, kept);
          } else {
            const pruned = stubMessages(event.messages, prepared, [
              ...frozen.frozenIds,
              ...frozen.openChunks.filter((chunk) => kept.has(chunk.id)).map((chunk) => chunk.id),
            ]);
            compiled = pruned;
            if (turn.route === "refresh") {
              const refreshed = stubMessages(event.messages, prepared, kept);
              refreshRemovedTokens = Math.max(0, estimateMessages(pruned, repository) - estimateMessages(refreshed, repository));
              const { firstDifference } = outgoingBreak(pruned.map(messageHash), refreshed.map(messageHash));
              const tailTokens = firstDifference === undefined ? 0 : estimateMessages(refreshed.slice(firstDifference), repository);
              refreshApplied = Boolean(turn.force) ||
                refreshPays({ removedTokens: refreshRemovedTokens, tailTokens, pricing: routing.input.pricing }, DEFAULT_ROUTING);
              if (refreshApplied) compiled = refreshed;
            }
          }
          validateToolPairs(event.messages, compiled);
          event.messages = compiled;
        } catch (error) {
          status = "fallback";
          fallbackReason = error instanceof Error ? error.message : String(error);
          // Never re-add context the turn policy already removed.
          if (routing.reuseMessages) event.messages = routing.reuseMessages;
        }
        const saved = await saveRoute(
          ctx.storage, routingStates, routing, original, event.messages, repository,
          status === "compiled"
            ? {
              selectorCostUsd: compiledResult?.selectorCostUsd ?? 0,
              judged: true,
              ...(turn.route === "prune" ? {} : { refreshPromptTokens: turn.input.promptTokens }),
            }
            : {},
        );
        await recordMetric(ctx, event.sessionID, started, {
          ...routeMetric(routing, routing.decision, false, saved),
          ...turnMetric(turn, routing.reuseMessages, event.messages, repository),
          status,
          messagesBefore,
          messagesAfter: event.messages.length,
          inputTokensBefore,
          inputTokensAfter: estimateMessages(event.messages, repository),
          selectorLatencyMs: compiledResult?.selectorLatencyMs,
          selectorCostUsd: compiledResult?.selectorCostUsd,
          selectorCachedQuestions: compiledResult?.selectorCachedQuestions,
          compilerBatches: compiledResult?.batches,
          refreshApplied,
          refreshRemovedTokensEstimate: refreshRemovedTokens,
          summariesStored: await summariesStored,
          fallbackReason,
          selection: (compiledResult?.decisions ?? []).filter((decision) => decision.relevance !== undefined).map((decision) => {
            const chunk = prepared.input.chunks.find((item) => item.id === decision.id);
            return {
              kind: chunk?.kind ?? "unknown",
              tokens: chunk?.tokenEstimate ?? 0,
              kept: decision.kept,
              relevance: decision.relevance,
            };
          }),
        });
        return;
      }

      try {
        if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing");
        if (!isLoopback(ENDPOINT)) throw new Error("JEV_CONTEXT_ENDPOINT must be local");
        if (prepared.input.chunks.length > MAX_CHUNKS) throw new Error("Context has more than 200 chunks");

        const previousRequest = routing?.decision.needsContinuity ? routing.previousRequest : undefined;
        const result = await requestCompile(
          previousRequest
            ? {
              ...prepared.input,
              ...(useSummaryLevels ? { summaryLevels: true } : {}),
              continuity: { previousRequest },
            }
            : useSummaryLevels ? { ...prepared.input, summaryLevels: true } : prepared.input,
          apiKey,
        );
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
        const inputTokensAfter = estimateMessages(compiled, repository);
        if (!result.fallbackReason && (useSummaryLevels || compiled.length < event.messages.length)) {
          event.messages = compiled;
        }

        let routeFinal = routing?.decision;
        let saved: RoutingState | undefined;
        if (routing) {
          const continuity = validContinuity(result.continuity);
          if (routing.reuseMessages && routeFinal?.route === "rebuild" && !result.fallbackReason) {
            // Rule 6: with the real compiled size (selector cost now sunk) the
            // warm prefix may still be cheaper; then send it instead.
            routing.input = {
              ...routing.input,
              rebuildTokensActual: inputTokensAfter,
              ...(continuity !== undefined ? { continuity } : {}),
            };
            routeFinal = decideRoute(routing.input, DEFAULT_ROUTING);
            if (routeFinal.route === "reuse") event.messages = routing.reuseMessages;
          }
          saved = await saveRoute(
            ctx.storage, routingStates, routing, original, event.messages, repository,
            result.fallbackReason
              ? {}
              : {
                // Only compiles in which Jev decided something say how much a
                // rebuild saves; a compile without candidates would bias to 1.
                keepRatio: inputTokensBefore && (useSummaryLevels
                  ? (result.summaryDecisions?.length ?? 0) > 0
                  : result.decisions.some((decision) => decision.relevance !== undefined))
                  ? inputTokensAfter / inputTokensBefore
                  : undefined,
                selectorCostUsd: result.selectorUsage?.costUsd ?? 0,
                judged: true,
              },
          );
        }

        await recordMetric(ctx, event.sessionID, started, {
          ...(routing && routeFinal ? routeMetric(routing, routeFinal, false, saved) : {}),
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
        // The full original context goes out; it becomes the next warm prefix.
        const saved = routing
          ? await saveRoute(ctx.storage, routingStates, routing, original, event.messages, repository)
          : undefined;
        await recordMetric(ctx, event.sessionID, started, {
          ...(routing ? routeMetric(routing, routing.decision, false, saved) : {}),
          status: "fallback",
          messagesBefore,
          messagesAfter: event.messages.length,
          inputTokensBefore,
          inputTokensAfter: inputTokensBefore,
          summariesStored: summariesStoredCount ?? await summariesStored,
          summaryLevels: useSummaryLevels || undefined,
          fallbackReason: error instanceof Error ? error.message : String(error),
        });
      }
    };

    await ctx.session.hook("context", async (event) => {
      await handle(event);
      if (diagnostic) {
        const repository = ctx.location.project.canonical || ctx.location.directory;
        await recordOutgoing(ctx, lastOutgoing, event, repository);
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
      if (level === "full") throw new Error(`Unexpected full level for ${chunk.id}`);
      return [summaryMessage(chunk, level)];
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

// Remembers which chunk a synthetic summary message stands for, so the routing
// state can describe it without storing its content.
const summaryOrigins = new WeakMap<Message, { chunkId: string; level: "short" | "long" }>();

function summaryMessage(chunk: ContextChunk, level: "short" | "long"): Message {
  const variants = createSummaryVariants(chunk);
  if (!variants) throw new Error(`Missing ${level} summary for ${chunk.id}`);
  const message = {
    role: "assistant",
    content: [{
      type: "text",
      text: `[Previous ${chunk.kind}: ${level} extract]\n${variants[level].content}`,
    }],
  } satisfies Message;
  summaryOrigins.set(message, { chunkId: chunk.id, level });
  return message;
}

/**
 * Replaces a pruned tool output. The call stays visible, so the model still
 * sees that the result came from a tool and can run it again; the text is
 * fixed, so the stubbed message is byte-identical on every dispatch.
 */
export const TOOL_OUTPUT_REMOVED =
  "[Tool output removed by Jev context pruning to save tokens. Run the tool again if you need this content.]";

// Remembers which original a stubbed message stands for (key and stubbed parts).
const stubOrigins = new WeakMap<Message, { key: string; parts: number[] }>();

/**
 * The original message with the given tool outputs replaced by the stub: V2
 * `tool` parts (`state.output`) or AI SDK `tool-result` parts (`result`).
 */
export function stubMessage(message: Message, parts: number[]): Message {
  if (!Array.isArray(message.content)) throw new Error("Only tool parts can be stubbed");
  const indices = [...new Set(parts)].sort((a, b) => a - b);
  const content = message.content.map((part, index) => {
    if (!indices.includes(index)) return part;
    if (partType(part) === "tool-result" && part && typeof part === "object") {
      const result = part as Record<string, unknown>;
      // Keep the output's shape: plain string or `{ type: "text", value }`.
      const stub = (value: unknown) => typeof value === "string" ? TOOL_OUTPUT_REMOVED : { type: "text", value: TOOL_OUTPUT_REMOVED };
      return {
        ...result,
        ...("output" in result ? { output: stub(result.output) } : {}),
        ...("result" in result || !("output" in result) ? { result: stub(result.result) } : {}),
      };
    }
    if (partType(part) !== "tool" || !part || typeof part !== "object") throw new Error("Stub target is not a tool part");
    const tool = part as Record<string, unknown>;
    const state = tool.state && typeof tool.state === "object" ? tool.state as Record<string, unknown> : {};
    return {
      ...tool,
      state: {
        ...state,
        ...("output" in state ? { output: TOOL_OUTPUT_REMOVED } : {}),
        ...("content" in state || !("output" in state) ? { content: [{ type: "text", text: TOOL_OUTPUT_REMOVED }] } : {}),
      },
    };
  });
  const stubbed = { ...message, content };
  stubOrigins.set(stubbed, { key: messageKey(message), parts: indices });
  return stubbed;
}

/**
 * Message and part index of a complete tool transaction's output. The result
 * is the chunk's second source: a V2 tool part (`message:<i>:part:<j>:result`)
 * or an AI SDK `tool-result` part of a later `tool` message (`message:<i>:part:<j>`).
 */
function toolPartOf(chunk: ContextChunk) {
  if (chunk.kind !== "tool_transaction") return undefined;
  const result = chunk.source.messageIds[1];
  const match = result === undefined ? null : /^message:(\d+):part:(\d+)(?::result)?$/.exec(result);
  return match ? { message: Number(match[1]), part: Number(match[2]) } : undefined;
}

/**
 * Turn-policy selection: messages are never removed. Only outputs of tool
 * transactions that are not kept are replaced by the stub; user and assistant
 * text, reasoning and every tool call stay as they are.
 */
export function stubMessages(messages: Message[], prepared: PreparedContext, keptChunkIds: Iterable<string>) {
  const kept = new Set(keptChunkIds);
  const byMessage = new Map<number, number[]>();
  for (const chunk of prepared.input.chunks) {
    if (kept.has(chunk.id)) continue;
    const target = toolPartOf(chunk);
    if (!target || !messages[target.message]) continue;
    byMessage.set(target.message, [...byMessage.get(target.message) ?? [], target.part]);
  }
  return messages.map((message, index) => {
    const parts = byMessage.get(index);
    return parts ? stubMessage(message, parts) : message;
  });
}

/** Only tool outputs are pruning candidates; answers and user turns stay pinned. */
function protectTurnText(chunks: ContextChunk[]) {
  return chunks.map((chunk) => chunk.pinned || toolPartOf(chunk)
    ? chunk
    : { ...chunk, pinned: true, pinReason: "turn text stays" });
}

type RoutePlan = {
  storageKey: string;
  pricingModel: string;
  now: number;
  input: RouteInput;
  decision: RouteDecision;
  state?: RoutingState;
  reuseMessages?: Message[];
  previousRequest?: string;
};

function loadPricingFile() {
  try {
    const path = process.env.JEV_PRICING_FILE?.trim() ||
      fileURLToPath(new URL("../jev-pricing.json", import.meta.url));
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    // Missing prices keep the status quo: rebuild on every dispatch.
    return undefined;
  }
}

function messageHash(message: Message) {
  return createHash("sha256").update(JSON.stringify(message)).digest("hex");
}

function messageKey(message: Message, hash = messageHash(message)) {
  return typeof message.id === "string" && message.id ? message.id : hash;
}

function lastUserKey(messages: Message[]) {
  const user = messages.findLast((message) => message.role === "user");
  return user ? messageKey(user) : "";
}

function estimateMessages(messages: Message[], repository: string) {
  return prepareContext(messages, repository).input.chunks.reduce(
    (sum, chunk) => sum + chunk.tokenEstimate,
    0,
  );
}

function validContinuity(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;
}

/** Describes what was actually sent: originals by key/hash, summaries by chunk. */
export function describeSent(original: Message[], sent: Message[]): SentEntry[] {
  const originals = new Set(original);
  return sent.map((message) => {
    const hash = messageHash(message);
    if (originals.has(message)) return { key: messageKey(message, hash), hash };
    const stub = stubOrigins.get(message);
    if (stub) return { stubOf: stub.key, parts: stub.parts, hash };
    const origin = summaryOrigins.get(message);
    if (!origin) throw new Error("Sent message has no known origin");
    return { summaryOf: origin.chunkId, level: origin.level, hash };
  });
}

/**
 * Rebuilds the previously sent context from the current messages and appends
 * everything that arrived since. Any mismatch (compaction, edited history,
 * orphaned tool pair) makes the prefix invalid.
 */
export function buildReuseMessages(
  messages: Message[],
  prepared: PreparedContext,
  state: Pick<RoutingState, "sent" | "lastSeenKey">,
) {
  try {
    const hashes = messages.map(messageHash);
    const byKey = new Map(messages.map((message, index) => [messageKey(message, hashes[index]), index]));
    const chunks = new Map(prepared.input.chunks.map((chunk) => [chunk.id, chunk]));
    const reuse: Message[] = [];
    let last = -1;
    for (const entry of state.sent) {
      if ("key" in entry) {
        const index = byKey.get(entry.key);
        if (index === undefined || index <= last || hashes[index] !== entry.hash) return undefined;
        last = index;
        reuse.push(messages[index]);
      } else if ("stubOf" in entry) {
        const index = byKey.get(entry.stubOf);
        if (index === undefined || index <= last) return undefined;
        const stubbed = stubMessage(messages[index], entry.parts);
        if (messageHash(stubbed) !== entry.hash) return undefined;
        last = index;
        reuse.push(stubbed);
      } else {
        const chunk = chunks.get(entry.summaryOf);
        if (!chunk) return undefined;
        const summary = summaryMessage(chunk, entry.level);
        if (messageHash(summary) !== entry.hash) return undefined;
        reuse.push(summary);
      }
    }
    const seen = byKey.get(state.lastSeenKey);
    if (seen === undefined || seen < last || !reuse.length) return undefined;
    const appended = messages.slice(seen + 1);
    const result = [...reuse, ...appended];
    validateToolPairs(messages, result);
    return { messages: result, appended };
  } catch {
    return undefined;
  }
}

function routingStorageKey(event: ContextEvent) {
  return `routing/${encodeURIComponent(event.sessionID)}/${encodeURIComponent(event.agent || "default")}`;
}

async function planRoute(
  storage: PluginContext["storage"],
  states: Map<string, RoutingState>,
  pricingFile: unknown,
  event: ContextEvent,
  prepared: PreparedContext,
  repository: string,
): Promise<RoutePlan> {
  const now = Date.now();
  const storageKey = routingStorageKey(event);
  const pricingModel = pricingKey(event.model) ?? "unknown";
  const fullTokens = prepared.input.chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0);
  const pinnedTokens = prepared.input.chunks
    .filter((chunk) => chunk.pinned)
    .reduce((sum, chunk) => sum + chunk.tokenEstimate, 0);
  let input: RouteInput = {
    prefix: "none",
    pricing: readPricing(pricingFile, pricingKey(event.model)),
    sameUserTurn: false,
    gapMs: 0,
    prefixTokens: 0,
    appendedTokens: 0,
    fullTokens,
    pinnedTokens,
  };
  try {
    let state = states.get(storageKey);
    if (!state && storage.get) {
      try {
        state = parseRoutingState(await storage.get(storageKey));
      } catch {
        // Unreadable routing state: behave like a first dispatch.
      }
    }
    if (!state) return { storageKey, pricingModel, now, input, decision: decideRoute(input, DEFAULT_ROUTING) };

    const reuse = state.pricingModel === pricingModel
      ? buildReuseMessages(event.messages, prepared, state)
      : undefined;
    const sameUserTurn = lastUserKey(event.messages) === state.lastUserKey;
    input = {
      ...input,
      prefix: reuse ? "valid" : "invalid",
      sameUserTurn,
      gapMs: Math.max(0, now - state.lastDispatchAt),
      prefixTokens: state.sentTokens,
      appendedTokens: reuse ? estimateMessages(reuse.appended, repository) : 0,
      ...(state.keepRatio !== undefined ? { keepRatio: state.keepRatio } : {}),
      ...(state.selectorCostUsd !== undefined ? { selectorCostUsd: state.selectorCostUsd } : {}),
    };
    const previous = sameUserTurn
      ? undefined
      : event.messages.find((message) => messageKey(message) === state.lastUserKey);
    return {
      storageKey,
      pricingModel,
      now,
      input,
      state,
      decision: decideRoute(input, DEFAULT_ROUTING),
      reuseMessages: reuse?.messages,
      previousRequest: previous
        ? prepareContext([previous], repository).input.currentRequest || undefined
        : undefined,
    };
  } catch {
    input = { ...input, prefix: "invalid" };
    return { storageKey, pricingModel, now, input, decision: { ...decideRoute(input, DEFAULT_ROUTING), reason: "routing error" } };
  }
}

async function saveRoute(
  storage: PluginContext["storage"],
  states: Map<string, RoutingState>,
  plan: RoutePlan,
  original: Message[],
  sent: Message[],
  repository: string,
  update: { keepRatio?: number; selectorCostUsd?: number; judged?: boolean; refreshPromptTokens?: number } = {},
): Promise<RoutingState | undefined> {
  try {
    const alpha = DEFAULT_ROUTING.emaAlpha;
    const keepRatio = update.keepRatio === undefined
      ? plan.state?.keepRatio
      : movingAverage(plan.state?.keepRatio, update.keepRatio, alpha);
    const selectorCostUsd = update.selectorCostUsd === undefined
      ? plan.state?.selectorCostUsd
      : movingAverage(plan.state?.selectorCostUsd, update.selectorCostUsd, alpha);
    const last = original.at(-1);
    const lastKey = last ? messageKey(last) : "";
    const judgedKey = update.judged ? lastKey : plan.state?.judgedKey;
    const refreshPromptTokens = update.refreshPromptTokens ?? plan.state?.refreshPromptTokens;
    const state: RoutingState = {
      version: 1,
      sent: describeSent(original, sent),
      lastSeenKey: lastKey,
      ...(judgedKey !== undefined ? { judgedKey } : {}),
      ...(refreshPromptTokens !== undefined ? { refreshPromptTokens } : {}),
      sentTokens: estimateMessages(sent, repository),
      lastDispatchAt: plan.now,
      lastUserKey: lastUserKey(original),
      pricingModel: plan.pricingModel,
      ...(keepRatio !== undefined ? { keepRatio } : {}),
      ...(selectorCostUsd !== undefined ? { selectorCostUsd } : {}),
    };
    states.set(plan.storageKey, state);
    try {
      await storage.set(plan.storageKey, state);
    } catch {
      // The in-memory state still serves this process.
    }
    return state;
  } catch {
    // Without a trustworthy state the next dispatch rebuilds (status quo).
    states.delete(plan.storageKey);
    return undefined;
  }
}

function routeMetric(
  plan: RoutePlan,
  decision: RouteDecision,
  compilerSkipped: boolean,
  saved: RoutingState | undefined,
) {
  return {
    route: decision.route,
    routeReason: decision.reason,
    warmth: decision.warmth,
    gapMs: plan.input.gapMs,
    prefixValid: plan.input.prefix === "valid",
    reuseTokens: decision.reuseTokens,
    rebuildTokensEstimated: decision.rebuildTokensEstimated,
    rebuildTokensActual: plan.input.rebuildTokensActual,
    reuseUsdEstimated: decision.reuseUsdEstimated,
    rebuildUsdEstimated: decision.rebuildUsdEstimated,
    compilerSkipped,
    continuity: plan.input.continuity,
    continuityAsked: plan.decision.needsContinuity || undefined,
    pricingModel: plan.pricingModel,
    routingStateSaved: saved !== undefined,
    // Content-free inputs so every live decision can be replayed offline.
    routeInput: plan.input,
    routeConfig: DEFAULT_ROUTING,
  };
}

type TurnPlan = TurnRouteDecision & {
  input: TurnRouteInput;
  routeDecision: RouteDecision;
  frozenMessages?: number;
  frozen?: NonNullable<ReturnType<typeof freezePrefix>>;
};

/**
 * Freezes what was already sent: chunks that went out stay pinned, chunks that
 * were removed stay removed. Only chunks after the last seen message are left
 * for Jev, so a prune can only change the request behind the frozen prefix.
 */
export function freezePrefix(
  messages: Message[],
  prepared: PreparedContext,
  state: Pick<RoutingState, "sent" | "lastSeenKey" | "judgedKey">,
) {
  if (state.sent.some((entry) => "summaryOf" in entry)) return undefined;
  const keys = messages.map((message) => messageKey(message));
  // Tool-loop steps were only appended, never judged: they stay open for Jev
  // until the next user turn.
  const seen = keys.lastIndexOf(state.judgedKey ?? state.lastSeenKey);
  if (seen < 0) return undefined;
  const sent = new Set(state.sent.flatMap((entry) => "key" in entry ? [entry.key] : "stubOf" in entry ? [entry.stubOf] : []));
  // Tool outputs that went out as stubs count as removed.
  const stubbed = new Map(state.sent.flatMap((entry) => "stubOf" in entry ? [[entry.stubOf, new Set(entry.parts)] as const] : []));
  const wasStubbed = (chunk: ContextChunk) => {
    const target = toolPartOf(chunk);
    return target !== undefined && Boolean(stubbed.get(keys[target.message])?.has(target.part));
  };
  const chunks: ContextChunk[] = [];
  const open: ContextChunk[] = [];
  const kept: ContextChunk[] = [];
  let removedChunks = 0;
  for (const chunk of prepared.input.chunks) {
    const indices = chunk.source.messageIds
      .map((id) => prepared.entryToMessage.get(id))
      .filter((index): index is number => index !== undefined);
    if (!indices.length || Math.min(...indices) > seen) {
      chunks.push(chunk);
      open.push(chunk);
    } else if (indices.some((index) => sent.has(keys[index])) && !wasStubbed(chunk)) {
      chunks.push({ ...chunk, pinned: true, pinReason: "frozen prefix" });
      kept.push(chunk);
    } else {
      removedChunks += 1;
    }
  }
  return {
    // Selection view: frozen chunks pinned, open chunks as compiled.
    input: { ...prepared.input, chunks },
    entryToMessage: prepared.entryToMessage,
    /** Only these go to Jev on a new user turn; frozen content never travels again. */
    openChunks: open,
    frozenIds: kept.map((chunk) => chunk.id),
    /** A re-judgement sees frozen kept chunks with their own pins again, never removed ones. */
    refresh: { input: { ...prepared.input, chunks: [...kept, ...open] }, entryToMessage: prepared.entryToMessage },
    frozenChunks: kept.length,
    removedChunks,
  };
}

const MAX_BATCH_CHUNKS = 60;
const MAX_BATCH_BYTES = 200_000;

/** Splits chunks into compiler requests below the route's chunk and payload limits. */
export function splitChunks(chunks: ContextChunk[], maxChunks = MAX_BATCH_CHUNKS, maxBytes = MAX_BATCH_BYTES) {
  const batches: ContextChunk[][] = [];
  let current: ContextChunk[] = [];
  let bytes = 0;
  for (const chunk of chunks) {
    const size = new TextEncoder().encode(JSON.stringify(chunk)).length;
    if (current.length && (current.length >= maxChunks || bytes + size > maxBytes)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(chunk);
    bytes += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

/**
 * Upper bound for one compiler request (JEV_COMPILE_TIMEOUT_MS, 500–5000 ms,
 * default 5000). On timeout the hook falls back to the frozen prefix, so a
 * short bound caps provider latency spikes at the price of one skipped prune.
 */
export function compileTimeoutMs(value = process.env.JEV_COMPILE_TIMEOUT_MS) {
  const parsed = Number(value?.trim());
  return Number.isInteger(parsed) && parsed >= 500 && parsed <= 5_000 ? parsed : 5_000;
}

async function requestCompile(body: object, apiKey: string) {
  const payload = JSON.stringify(body);
  if (new TextEncoder().encode(payload).length > MAX_BODY_BYTES) throw new Error("Context payload is too large");
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-openrouter-api-key": apiKey,
    },
    body: payload,
    signal: AbortSignal.timeout(compileTimeoutMs()),
  });
  if (!response.ok) throw new Error(`Compiler failed (HTTP ${response.status})`);
  return await response.json() as CompilationResult;
}

/**
 * Compiles any amount of context in bounded requests. Jev judges each chunk on
 * its own against the current request, so batches lose nothing; dependencies
 * are closed over the whole set afterwards.
 */
async function compileBatched(input: CompileInput, apiKey: string) {
  const batches = splitChunks(input.chunks);
  const results = await Promise.all(batches.map((chunks) => requestCompile({ ...input, chunks }, apiKey)));
  results.forEach((result, index) => validateResult(batches[index], result));
  const kept = closeDependencies(input.chunks, new Set(results.flatMap((result) => result.keptChunkIds)));
  const costs = results.map((result) => result.selectorUsage?.costUsd).filter((cost): cost is number => typeof cost === "number");
  return {
    keptChunkIds: input.chunks.filter((chunk) => kept.has(chunk.id)).map((chunk) => chunk.id),
    decisions: results.flatMap((result) => result.decisions),
    selectorLatencyMs: Math.max(0, ...results.map((result) => result.selectorLatencyMs ?? 0)),
    selectorCostUsd: costs.length ? costs.reduce((sum, cost) => sum + cost, 0) : undefined,
    selectorCachedQuestions: results.reduce((sum, result) => sum + (result.selectorCachedQuestions ?? 0), 0),
    fallbackReason: results.find((result) => result.fallbackReason)?.fallbackReason,
    batches: batches.length,
  };
}

/** Real provider usage of the last model step, read from OpenCode's own session context. */
export async function lastProviderUsage(ctx: PluginContext, sessionID: string) {
  if (typeof ctx.session.context !== "function") return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      ctx.session.context({ sessionID }),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), 500);
      }),
    ]);
    if (!Array.isArray(value)) return undefined;
    const last = value.findLast((item) =>
      item && typeof item === "object" && (item as Record<string, unknown>).type === "assistant" &&
      (item as Record<string, unknown>).tokens && typeof (item as Record<string, unknown>).tokens === "object"
    ) as { id?: unknown; tokens: { input?: unknown; output?: unknown; reasoning?: unknown; cache?: { read?: unknown; write?: unknown } } } | undefined;
    if (!last) return undefined;
    const number = (item: unknown) => typeof item === "number" && Number.isFinite(item) && item >= 0 ? item : 0;
    const prompt = number(last.tokens.input) + number(last.tokens.cache?.read) + number(last.tokens.cache?.write);
    if (prompt <= 0) return undefined;
    return {
      id: typeof last.id === "string" ? last.id : undefined,
      prompt,
      output: number(last.tokens.output) + number(last.tokens.reasoning),
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function planTurn(
  ctx: PluginContext,
  event: ContextEvent,
  routing: RoutePlan,
  prepared: PreparedContext,
  repository: string,
): Promise<TurnPlan> {
  const outgoing = routing.reuseMessages ?? event.messages;
  const usage = await lastProviderUsage(ctx, event.sessionID);
  const after = usage?.id ? event.messages.findIndex((message) => message.id === usage.id) : -1;
  const input: TurnRouteInput = {
    prefix: routing.input.prefix,
    sameUserTurn: routing.input.sameUserTurn,
    gapMs: routing.input.gapMs,
    // Real prompt of the last step plus its answer and what arrived since;
    // only that small tail is estimated.
    promptTokens: usage && after >= 0
      ? usage.prompt + usage.output + estimateMessages(event.messages.slice(after + 1), repository)
      : estimateMessages(outgoing, repository),
    promptTokensReal: Boolean(usage && after >= 0),
    ...(routing.input.pricing ? { contextLimit: routing.input.pricing.contextLimit } : {}),
  };
  if (routing.state?.refreshPromptTokens !== undefined) input.lastRefreshPromptTokens = routing.state.refreshPromptTokens;
  const decision = decideTurnRoute(input, DEFAULT_ROUTING);
  const needsFrozen = decision.route === "prune" || decision.route === "refresh";
  const frozen = needsFrozen && routing.state
    ? freezePrefix(event.messages, prepared, routing.state)
    : undefined;
  const final = needsFrozen && !frozen
    ? { ...decision, route: "full" as const, reason: "prefix not freezable" }
    : decision;
  return {
    ...final,
    input,
    frozen,
    frozenMessages: routing.state?.sent.length,
    routeDecision: {
      route: final.route === "reuse" ? "reuse" : "rebuild",
      reason: final.reason,
      warmth: final.warmth,
      reuseTokens: routing.input.prefixTokens + routing.input.appendedTokens,
    },
  };
}

/** Where the outgoing request leaves the warm prefix, and what that costs. */
function turnMetric(turn: TurnPlan, previous: Message[] | undefined, sent: Message[], repository: string) {
  const hashes = sent.map(messageHash);
  const { firstDifference } = outgoingBreak(previous?.map(messageHash), hashes);
  const breakIndex = firstDifference !== undefined && firstDifference < hashes.length ? firstDifference : undefined;
  return {
    routePolicy: "turn",
    turnRoute: turn.route,
    promptTokens: turn.input.promptTokens,
    promptTokensReal: turn.input.promptTokensReal,
    frozenMessages: turn.frozenMessages,
    frozenChunks: turn.frozen?.frozenChunks,
    removedFrozenChunks: turn.frozen?.removedChunks,
    breakIndex,
    breakTokensEstimate: breakIndex !== undefined ? estimateMessages(sent.slice(breakIndex), repository) : 0,
    prunedTokensEstimate: previous ? Math.max(0, estimateMessages(previous, repository) - estimateMessages(sent, repository)) : undefined,
    // Replay input for decideTurnRoute.
    routeInput: turn.input,
    routeConfig: DEFAULT_ROUTING,
  };
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

/** Field names and value types only — never values or message contents. */
export function describeEvent(event: object) {
  const shape = (value: unknown, depth: number): unknown =>
    Array.isArray(value)
      ? "array"
      : value && typeof value === "object" && depth > 0
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item, depth - 1)]))
        : value === null ? "null" : typeof value;
  const record = event as Record<string, unknown>;
  const messages = Array.isArray(record.messages) ? record.messages as Message[] : [];
  const byRole: Record<string, { count: number; fields: Record<string, unknown> }> = {};
  for (const message of messages) {
    const role = typeof message.role === "string" ? message.role : "unknown";
    const entry = byRole[role] ??= { count: 0, fields: {} };
    entry.count += 1;
    Object.assign(entry.fields, shape(Object.fromEntries(
      Object.entries(message).filter(([key]) => key !== "content"),
    ), 2) as Record<string, unknown>);
  }
  return {
    eventFields: shape(Object.fromEntries(
      Object.entries(record).filter(([key]) => !["messages", "system"].includes(key)),
    ), 2),
    messageCount: messages.length,
    messagesByRole: byRole,
  };
}

async function recordDiagnostic(ctx: PluginContext, event: ContextEvent) {
  try {
    const timestamp = new Date().toISOString();
    await ctx.storage.set(`diagnostic/${timestamp}-${crypto.randomUUID()}`, {
      timestamp,
      ...describeEvent(event),
      sessionContext: await probeSessionContext(ctx, event),
    });
  } catch {
    // Diagnostics must never block a model request.
  }
}

/**
 * Checks whether `ctx.session.context` exposes the provider usage of the last
 * model step. Records shapes, counts and token numbers only — never contents.
 */
export async function probeSessionContext(ctx: PluginContext, event: ContextEvent) {
  if (typeof ctx.session.context !== "function") return { available: false };
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      ctx.session.context({ sessionID: event.sessionID }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), 2_000);
      }),
    ]);
    const list = Array.isArray(value)
      ? value
      : Array.isArray((value as { data?: unknown })?.data) ? (value as { data: unknown[] }).data : undefined;
    const records = (list ?? []).filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
    const kind = (item: Record<string, unknown>) => String(item.type ?? item.role ?? "unknown");
    const assistants = records.filter((item) => kind(item) === "assistant");
    const last = assistants.at(-1);
    const tokens = last?.tokens as { input?: unknown; output?: unknown; reasoning?: unknown; cache?: { read?: unknown; write?: unknown } } | undefined;
    const number = (item: unknown) => typeof item === "number" && Number.isFinite(item) ? item : undefined;
    const eventIds = new Set(event.messages.map((message) => message.id).filter((id) => typeof id === "string"));
    return {
      available: true,
      latencyMs: Math.round(performance.now() - started),
      resultType: Array.isArray(value) ? "array" : value === null ? "null" : typeof value,
      count: records.length,
      kinds: records.reduce<Record<string, number>>((acc, item) => {
        acc[kind(item)] = (acc[kind(item)] ?? 0) + 1;
        return acc;
      }, {}),
      lastAssistantFields: last ? Object.keys(last).filter((key) => key !== "content").sort() : [],
      lastAssistantTokens: tokens
        ? {
          input: number(tokens.input),
          output: number(tokens.output),
          reasoning: number(tokens.reasoning),
          cacheRead: number(tokens.cache?.read),
          cacheWrite: number(tokens.cache?.write),
        }
        : undefined,
      lastAssistantCost: number(last?.cost),
      lastAssistantInEvent: typeof last?.id === "string" ? eventIds.has(last.id) : undefined,
      assistantsWithTokens: assistants.filter((item) => item.tokens && typeof item.tokens === "object").length,
    };
  } catch (error) {
    return {
      available: true,
      latencyMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message.slice(0, 120) : "unknown",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Where does the outgoing request stop matching the previous one? Everything
 * before that point can still be a provider cache hit.
 */
export function outgoingBreak(previous: string[] | undefined, current: string[]) {
  if (!previous) return { firstDifference: undefined, commonPrefix: 0 };
  let index = 0;
  while (index < previous.length && index < current.length && previous[index] === current[index]) index++;
  return { firstDifference: index < current.length || index < previous.length ? index : undefined, commonPrefix: index };
}

async function recordOutgoing(ctx: PluginContext, lastOutgoing: Map<string, string[]>, event: ContextEvent, repository: string) {
  try {
    const key = `${event.sessionID}/${event.agent ?? "default"}`;
    const hashes = event.messages.map(messageHash);
    const { firstDifference, commonPrefix } = outgoingBreak(lastOutgoing.get(key), hashes);
    lastOutgoing.set(key, hashes);
    const timestamp = new Date().toISOString();
    await ctx.storage.set(`diagnostic/${timestamp}-${crypto.randomUUID()}`, {
      timestamp,
      kind: "outgoing",
      sessionID: event.sessionID,
      agent: event.agent,
      messages: hashes.length,
      firstDifference,
      commonPrefixMessages: commonPrefix,
      commonPrefixTokensEstimate: estimateMessages(event.messages.slice(0, commonPrefix), repository),
      outgoingTokensEstimate: estimateMessages(event.messages, repository),
    });
  } catch {
    // Diagnostics must never block a model request.
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
