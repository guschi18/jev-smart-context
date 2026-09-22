import { NextRequest, NextResponse } from "next/server";
import {
  buildSelectorRequest,
  buildSummarySelectorRequest,
  compileSelection,
  compileSummarySelection,
  containsSecret,
  estimateTokens,
  fallbackCompilation,
  type CompileInput,
  type ContextChunk,
} from "@/lib/context";
import { forwardJev } from "@/lib/jev-server";
import { PROVIDER } from "@/lib/providers";
import type { JevResponse } from "@/lib/types";

const MAX_BODY_BYTES = 256_000;
const MAX_CHUNKS = 200;
const MAX_CHUNK_CHARS = 20_000;

function isChunk(value: unknown): value is ContextChunk {
  if (!value || typeof value !== "object") return false;
  const chunk = value as Partial<ContextChunk>;
  return (
    typeof chunk.id === "string" &&
    typeof chunk.kind === "string" &&
    typeof chunk.content === "string" &&
    chunk.content.length <= MAX_CHUNK_CHARS &&
    typeof chunk.turn === "number" &&
    Array.isArray(chunk.dependencies) &&
    chunk.dependencies.every((id) => typeof id === "string") &&
    typeof chunk.pinned === "boolean"
  );
}

function parseInput(value: unknown): CompileInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<CompileInput>;
  if (
    typeof input.currentRequest !== "string" ||
    typeof input.activeGoal !== "string" ||
    typeof input.repository !== "string" ||
    !Array.isArray(input.chunks) ||
    input.chunks.length > MAX_CHUNKS ||
    !input.chunks.every(isChunk) ||
    (input.summaryLevels !== undefined && typeof input.summaryLevels !== "boolean")
  ) {
    return null;
  }
  return {
    currentRequest: input.currentRequest,
    activeGoal: input.activeGoal,
    repository: input.repository,
    ...(input.summaryLevels ? { summaryLevels: true } : {}),
    chunks: input.chunks.map((chunk) => ({
      ...chunk,
      tokenEstimate: estimateTokens(chunk.content),
      pinned: chunk.pinned || containsSecret(chunk.content),
      pinReason: containsSecret(chunk.content)
        ? "sensitive content stays local"
        : chunk.pinReason,
    })),
  };
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-openrouter-api-key");
  if (!apiKey) {
    return NextResponse.json({ error: "Missing API key" }, { status: 400 });
  }

  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const input = parseInput(parsed);
  if (!input) {
    return NextResponse.json({ error: "Invalid compiler input" }, { status: 422 });
  }

  const summarize = input.summaryLevels === true;
  const { candidates, request } = summarize
    ? buildSummarySelectorRequest(input, PROVIDER.model)
    : buildSelectorRequest(input, PROVIDER.model);
  if (candidates.length === 0) {
    return NextResponse.json(
      summarize ? compileSummarySelection(input, {}, 0) : compileSelection(input, {}, 0),
    );
  }

  const upstream = await forwardJev(apiKey, request);
  if (
    !upstream.ok ||
    typeof upstream.body === "string" ||
    !("answers" in upstream.body)
  ) {
    return NextResponse.json(
      fallbackCompilation(input.chunks, `Selector failed (HTTP ${upstream.status}).`, upstream.latencyMs),
    );
  }

  try {
    const response = upstream.body as JevResponse;
    return NextResponse.json(
      (summarize ? compileSummarySelection : compileSelection)(input, response.answers, upstream.latencyMs, {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        costUsd: response.usage.cost,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      fallbackCompilation(
        input.chunks,
        error instanceof Error ? error.message : "Invalid selector response.",
        upstream.latencyMs,
      ),
    );
  }
}
