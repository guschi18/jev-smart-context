import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSelectorRequest,
  buildSummarySelectorRequest,
  closeDependencies,
  compileSelection,
  compileSummarySelection,
  createSummaryVariants,
  fallbackCompilation,
  normalizeTranscript,
  prefilterChunks,
  readSummaryDecisions,
  type CompilationResult,
  type CompileInput,
  type ContextChunk,
  type TranscriptEntry,
} from "./context.ts";
import { evaluateReplay } from "./context-evaluation.ts";
import { REPLAY_FIXTURES, type ReplayFixture } from "./context-fixture.ts";
import jevContextPlugin, {
  applySummaryLevels,
  prepareContext,
  selectMessages,
  storeSummaryVariants,
} from "../../.opencode/plugins/jev-context.ts";

const transcript: TranscriptEntry[] = [
  { id: "rules", turn: 0, role: "system", content: "Keep this rule." },
  { id: "call", turn: 1, role: "tool_call", toolCallId: "one", content: "read file" },
  { id: "result", turn: 1, role: "tool_result", toolCallId: "one", content: "file body" },
  {
    id: "decision",
    turn: 2,
    role: "decision",
    content: "Use the shared parser.",
    dependencies: ["tool:one"],
  },
  { id: "secret", turn: 2, role: "assistant", content: "API_KEY=sk_local_only_123456" },
  { id: "current", turn: 3, role: "user", content: "Implement it." },
];

test("normalization groups tools and pins protected context", () => {
  const chunks = normalizeTranscript(transcript, "current");
  const tool = chunks.find((chunk) => chunk.id === "tool:one");
  assert.equal(chunks.some((chunk) => chunk.id === "result"), false);
  assert.match(tool?.content ?? "", /Tool call:[\s\S]*Tool result:/);
  assert.equal(chunks.find((chunk) => chunk.id === "rules")?.pinned, true);
  assert.equal(chunks.find((chunk) => chunk.id === "secret")?.pinned, true);
  assert.equal(chunks.find((chunk) => chunk.id === "current")?.pinned, true);
});

test("dependency closure is transitive", () => {
  const chunks: ContextChunk[] = [
    chunk("a", ["b"]),
    chunk("b", ["c"]),
    chunk("c"),
  ];
  assert.deepEqual([...closeDependencies(chunks, new Set(["a"]))], ["a", "b", "c"]);
});

test("selection cannot drop a dependency", () => {
  const parent = { ...chunk("parent", ["dependency"]), pinned: true };
  const dependency = { ...chunk("dependency"), tokenEstimate: 100 };
  const unrelated = { ...chunk("unrelated"), tokenEstimate: 100 };
  const result = compileSelection(
    {
      currentRequest: "fix it",
      activeGoal: "finish",
      repository: "repo",
      chunks: [parent, dependency, unrelated],
    },
    {
      relevance_0: { type: "noul", noul: 0 },
      relevance_1: { type: "noul", noul: 0 },
    },
    1,
  );
  assert.deepEqual(result.keptChunkIds, ["parent", "dependency"]);
  assert.deepEqual(result.droppedChunkIds, ["unrelated"]);
});

test("selector payload redacts secrets", () => {
  const { request } = buildSelectorRequest(
    {
      currentRequest: "Use API_KEY=sk_current_secret_123456",
      activeGoal: "finish",
      repository: "repo",
      chunks: [{ ...chunk("candidate"), tokenEstimate: 100 }],
    },
    "typesafe/jev-1.13",
  );
  assert.doesNotMatch(JSON.stringify(request), /sk_current_secret/);
  assert.equal(Object.keys(request.questions).length, 1);
});

test("small chunks are kept without selector questions", () => {
  const input = {
    currentRequest: "fix it",
    activeGoal: "finish",
    repository: "repo",
    chunks: [chunk("small")],
  };
  assert.deepEqual(buildSelectorRequest(input, "typesafe/jev-1.13").request.questions, {});
  assert.deepEqual(compileSelection(input, {}, 0).keptChunkIds, ["small"]);
});

test("fallback keeps every chunk", () => {
  const chunks = normalizeTranscript(transcript, "current");
  const result = fallbackCompilation(chunks, "offline");
  assert.equal(result.droppedChunkIds.length, 0);
  assert.equal(result.keptChunkIds.length, chunks.length);
});

test("summary variants compress only safe, durable chunks and persist locally", async () => {
  const source = {
    ...chunk("durable"),
    content: `${"opening context ".repeat(100)}required conclusion`,
    tokenEstimate: 380,
  };
  const summary = createSummaryVariants(source)!;
  assert.ok(summary.short.tokenEstimate < summary.long.tokenEstimate);
  assert.ok(summary.long.tokenEstimate < summary.full.tokenEstimate);
  assert.match(summary.short.content, /required conclusion$/);
  assert.equal(createSummaryVariants({ ...source, pinned: true }), undefined);
  assert.equal(
    createSummaryVariants({ ...source, content: "API_KEY=sk_local_only_123456" }),
    undefined,
  );

  const stored: Array<{ key: string; value: Record<string, unknown> }> = [];
  assert.equal(
    await storeSummaryVariants(
      { async set(key, value) { stored.push({ key, value }); } },
      "session/one",
      [source, { ...source, id: "pinned", pinned: true }],
    ),
    1,
  );
  assert.equal(stored[0].key, "summaries/session%2Fone/durable");
  assert.deepEqual(stored[0].value, summary);
  assert.equal(
    await storeSummaryVariants({ async set() { throw new Error("disk full"); } }, "session", [source]),
    0,
  );
});

test("summary selector asks for the minimum safe level and parses choices", () => {
  const candidate = {
    ...chunk("candidate"),
    content: `${"investigation detail ".repeat(100)}required conclusion`,
    tokenEstimate: 520,
  };
  const input = {
    currentRequest: "Use the required conclusion",
    activeGoal: "Finish safely",
    repository: "repo",
    chunks: [candidate, { ...chunk("pinned"), pinned: true, tokenEstimate: 520 }],
  };
  const { candidates, request } = buildSummarySelectorRequest(input, "typesafe/jev-1.13");
  assert.deepEqual(candidates.map(({ chunk: item }) => item.id), ["candidate"]);
  assert.deepEqual(Object.keys(request.questions.summary_0.criteria), ["drop", "short", "long", "full"]);
  assert.match(JSON.stringify(request.questions.summary_0.instructions), /required conclusion/);
  assert.deepEqual(
    readSummaryDecisions(candidates, {
      summary_0: {
        type: "choice",
        choice: "long",
        probabilities: { drop: 0.1, short: 0.2, long: 0.6, full: 0.1 },
        confidence: 0.7,
      },
    }),
    [{
      id: "candidate",
      rawLevel: "long",
      level: "long",
      probabilities: { drop: 0.1, short: 0.2, long: 0.6, full: 0.1 },
      confidence: 0.7,
    }],
  );
  assert.equal(readSummaryDecisions(candidates, {
    summary_0: {
      type: "choice",
      choice: "short",
      probabilities: { drop: 0.01, short: 0.51, long: 0.17, full: 0.31 },
      confidence: 0.34,
    },
  })[0].level, "long");
  assert.throws(() => readSummaryDecisions(candidates, {}), /candidate/);
});

test("replay labels cover every normalized chunk", () => {
  for (const fixture of REPLAY_FIXTURES) {
    const chunks = normalizeTranscript(fixture.transcript, fixture.currentEntryId);
    const labels = [...fixture.mustKeepChunkIds, ...fixture.safeToDropChunkIds];
    assert.deepEqual(new Set(labels), new Set(chunks.map((chunk) => chunk.id)), fixture.id);
    assert.equal(labels.length, new Set(labels).size, `${fixture.id} has duplicate labels`);
    if (fixture.summaryTargets) {
      const candidates = buildSummarySelectorRequest({
        currentRequest: fixture.currentRequest,
        activeGoal: fixture.activeGoal,
        repository: fixture.repository,
        chunks,
      }, "typesafe/jev-1.13").candidates;
      assert.deepEqual(
        new Set(candidates.map(({ chunk: item }) => item.id)),
        new Set(Object.keys(fixture.summaryTargets)),
        `${fixture.id} has incomplete summary labels`,
      );
    }
  }
  assert.equal(REPLAY_FIXTURES.filter((fixture) => fixture.set === "calibration").length, 6);
  assert.equal(REPLAY_FIXTURES.filter((fixture) => fixture.set === "holdout").length, 4);
});

test("prefilter removes only the unreferenced repeated inspection", () => {
  const fixture = REPLAY_FIXTURES.find((item) => item.id === "repeated-inspection")!;
  const chunks = normalizeTranscript(fixture.transcript, fixture.currentEntryId);
  const filtered = prefilterChunks(chunks);
  assert.deepEqual([...filtered.dropped], [["tool:read-1", "exact duplicate"]]);
  assert.equal(filtered.chunks.some((item) => item.id === "tool:read-2"), true);
});

test("evaluation calibrates scores and produces a go decision", () => {
  const chunks = [
    { ...chunk("rules"), pinned: true },
    { ...chunk("needed"), tokenEstimate: 100 },
    { ...chunk("noise"), tokenEstimate: 1000 },
    { ...chunk("current"), pinned: true },
  ];
  const fixture: ReplayFixture = {
    id: "synthetic",
    set: "calibration",
    title: "Synthetic",
    scenario: "test",
    repository: "repo",
    activeGoal: "goal",
    currentRequest: "request",
    currentEntryId: "current",
    transcript: [],
    mustKeepChunkIds: ["rules", "needed", "current"],
    safeToDropChunkIds: ["noise"],
    safetyCriticalChunkIds: ["rules"],
  };
  const result: CompilationResult = {
    mode: "rebuild",
    chunks,
    decisions: [
      { id: "rules", kept: true, reason: "pinned" },
      { id: "needed", kept: true, reason: "relevant", relevance: 0.2 },
      { id: "noise", kept: false, reason: "irrelevant", relevance: 0.1 },
      { id: "current", kept: true, reason: "pinned" },
    ],
    keptChunkIds: ["rules", "needed", "current"],
    droppedChunkIds: ["noise"],
    compiledContext: "",
    inputTokensBefore: 13,
    inputTokensAfter: 3,
    selectorLatencyMs: 100,
    selectorUsage: { inputTokens: 10, outputTokens: 2, costUsd: 0.000001 },
  };
  const holdout = { ...fixture, id: "holdout", set: "holdout" as const };
  const report = evaluateReplay(
    [fixture, holdout],
    [
      { fixtureId: fixture.id, attempt: 1, result },
      { fixtureId: holdout.id, attempt: 1, result },
    ],
    3,
  );
  assert.equal(report.decision, "go");
  assert.equal(report.jev.mustKeepRecall, 1);
  assert.equal(report.holdout.mustKeepRecall, 1);
  assert.ok(report.thresholds.relevance > 0.1);
});

test("OpenCode adapter keeps complete tool transactions while dropping unrelated messages", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "Old task" }] },
    {
      role: "assistant",
      content: [
        { type: "tool-call", id: "keep", name: "read", input: { path: "src/a.ts" } },
        { type: "tool-call", id: "drop", name: "read", input: { path: "src/b.ts" } },
      ],
    },
    { role: "tool", content: [{ type: "tool-result", id: "keep", result: "needed" }] },
    { role: "tool", content: [{ type: "tool-result", id: "drop", result: "noise" }] },
    { role: "assistant", content: [{ type: "text", text: "Unrelated chatter" }] },
    { role: "user", content: [{ type: "text", text: "Current task" }] },
  ];
  const prepared = prepareContext(messages, "repo");
  const keptChunkIds = prepared.input.chunks
    .filter((chunk) => chunk.id === "tool:keep" || chunk.id === "message:5")
    .map((chunk) => chunk.id);

  assert.deepEqual(selectMessages(messages, prepared, keptChunkIds), [
    messages[1],
    messages[2],
    messages[3],
    messages[5],
  ]);
});

test("summary dispatch replaces whole tool transactions, keeps pins, and applies confidence policy", () => {
  const messages = [
    {
      role: "assistant",
      content: [
        { type: "tool-call", id: "summarize", name: "read", input: { path: "src/a.ts" } },
        { type: "tool-call", id: "drop", name: "read", input: { path: "src/b.ts" } },
      ],
    },
    { role: "tool", content: [{ type: "tool-result", id: "summarize", result: "needed ".repeat(300) }] },
    { role: "tool", content: [{ type: "tool-result", id: "drop", result: "noise ".repeat(300) }] },
    { role: "assistant", content: [{ type: "text", text: "constraint ".repeat(300) }] },
    { role: "user", content: [{ type: "text", text: "Earlier instruction" }] },
    { role: "assistant", content: [{ type: "text", text: "Recent answer" }] },
    { role: "user", content: [{ type: "text", text: "Current task" }] },
  ];
  const prepared = prepareContext(messages, "repo");
  const { candidates } = buildSummarySelectorRequest(prepared.input, "typesafe/jev-1.13");
  const answers = Object.fromEntries(candidates.map(({ chunk: item }, index) => [
    `summary_${index}`,
    item.id === "tool:summarize"
      ? choice("short", 0.9)
      : item.id === "message:3"
        ? choice("short", 0.3)
        : choice("drop", 0.9),
  ]));
  const result = compileSummarySelection(prepared.input, answers, 1);
  const compiled = applySummaryLevels(messages, prepared, result).messages;
  const serialized = JSON.stringify(compiled);

  assert.equal(compiled.some((message) =>
    Array.isArray(message.content) && message.content.some((part) =>
      part && typeof part === "object" && "type" in part && ["tool-call", "tool-result"].includes(String(part.type))
    )
  ), false);
  assert.match(serialized, /tool_transaction: short extract/);
  assert.match(serialized, /assistant_turn: long extract/);
  assert.equal(compiled.at(-1), messages.at(-1));
  assert.equal(result.summaryDecisions?.find(({ id }) => id === "message:3")?.level, "long");
});

test("OpenCode context hook replaces messages and fails safe without a key", async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalSummaryFlag = process.env.JEV_SUMMARY_LEVELS;
  const originalFetch = globalThis.fetch;
  let hook: ((event: { readonly sessionID: string; messages: typeof messages }) => Promise<void>) | undefined;
  const metrics: Record<string, unknown>[] = [];
  const messages = [
    { role: "user", content: [{ type: "text", text: "Old task" }] },
    { role: "assistant", content: [{ type: "text", text: "Old answer" }] },
    { role: "user", content: [{ type: "text", text: "Current task" }] },
  ];
  const ctx = {
    location: { directory: "repo", project: { canonical: "repo" } },
    session: {
      async hook(_name: "context", callback: typeof hook) {
        hook = callback;
      },
    },
    storage: {
      async set(_key: string, value: Record<string, unknown>) {
        metrics.push(value);
      },
    },
  };

  try {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = async (_input, init) => {
      const input = JSON.parse(String(init?.body)) as CompileInput;
      assert.equal(input.summaryLevels, process.env.JEV_SUMMARY_LEVELS === "1" ? true : undefined);
      return Response.json({
        mode: "rebuild",
        chunks: input.chunks,
        decisions: [
          { id: "message:0", kept: false, reason: "clearly irrelevant", relevance: 0.1 },
          { id: "message:1", kept: true, reason: "recent context" },
          { id: "message:2", kept: true, reason: "current user turn" },
        ],
        keptChunkIds: ["message:1", "message:2"],
        droppedChunkIds: ["message:0"],
        compiledContext: "",
        inputTokensBefore: 10,
        inputTokensAfter: 6,
        selectorLatencyMs: 2,
      } satisfies CompilationResult);
    };
    await jevContextPlugin.setup(ctx);
    assert.ok(hook);

    const event = { sessionID: "session", messages: [...messages] };
    await hook(event);
    assert.deepEqual(event.messages, messages.slice(1));
    assert.equal(metrics.at(-1)?.status, "compiled");
    assert.deepEqual(metrics.at(-1)?.selection, [
      { kind: "user_turn", tokens: 2, kept: false, relevance: 0.1 },
    ]);
    assert.equal(metrics.at(-1)?.inputTokensAfter, 6);

    process.env.JEV_SUMMARY_LEVELS = "1";
    const invalidSummary = { sessionID: "session", messages: [...messages] };
    await hook(invalidSummary);
    assert.deepEqual(invalidSummary.messages, messages);
    assert.equal(metrics.at(-1)?.status, "fallback");
    assert.equal(metrics.at(-1)?.fallbackReason, "Compiler returned no summary decisions");
    delete process.env.JEV_SUMMARY_LEVELS;

    delete process.env.OPENROUTER_API_KEY;
    const fallback = { sessionID: "session", messages: [...messages] };
    await hook(fallback);
    assert.deepEqual(fallback.messages, messages);
    assert.equal(metrics.at(-1)?.status, "fallback");
    assert.equal(metrics.at(-1)?.inputTokensBefore, metrics.at(-1)?.inputTokensAfter);
    assert.ok(Number(metrics.at(-1)?.inputTokensBefore) > 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
    if (originalSummaryFlag === undefined) delete process.env.JEV_SUMMARY_LEVELS;
    else process.env.JEV_SUMMARY_LEVELS = originalSummaryFlag;
  }
});

function choice(level: "drop" | "short" | "long" | "full", confidence: number) {
  return {
    type: "choice" as const,
    choice: level,
    probabilities: { drop: 0.1, short: 0.4, long: 0.3, full: 0.2 },
    confidence,
  };
}

function chunk(id: string, dependencies: string[] = []): ContextChunk {
  return {
    id,
    kind: "decision",
    content: id,
    turn: 1,
    tokenEstimate: 1,
    dependencies,
    pinned: false,
    source: { agent: "fixture", messageIds: [id] },
  };
}
