import assert from "node:assert/strict";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildSelectorRequest,
  buildSummarySelectorRequest,
  closeDependencies,
  compileSelection,
  compileSummarySelection,
  containsSecret,
  createSummaryVariants,
  fallbackCompilation,
  normalizeTranscript,
  prefilterChunks,
  readContinuity,
  readSummaryDecisions,
  redactSecrets,
  type CompilationResult,
  type CompileInput,
  type ContextChunk,
  type TranscriptEntry,
} from "./context.ts";
import { evaluateReplay } from "./context-evaluation.ts";
import { SelectorAnswerCache } from "./selector-cache.ts";
import { REPLAY_FIXTURES, type ReplayFixture } from "./context-fixture.ts";
import {
  DEFAULT_ROUTING,
  cacheWarmth,
  decideRoute,
  decideTurnRoute,
  normalizeUsage,
  refreshPays,
  parseRoutingState,
  pricingKey,
  readPricing,
  type RouteInput,
} from "./cache-routing.ts";
import jevContextPlugin, {
  applySummaryLevels,
  buildReuseMessages,
  describeEvent,
  describeSent,
  outgoingBreak,
  probeSessionContext,
  compileTimeoutMs,
  splitChunks,
  stubMessages,
  TOOL_OUTPUT_REMOVED,
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

test("recent tool results stay full even when their calls preceded multiple results", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "Read the guide, then edit." }] },
    { role: "assistant", content: [
      { type: "tool-call", id: "rules", name: "read", input: { path: "AGENTS.md" } },
      { type: "tool-call", id: "guide", name: "read", input: { path: "route.md" } },
    ] },
    { role: "tool", content: [{ type: "tool-result", id: "rules", result: "Repository rules ".repeat(100) }] },
    { role: "tool", content: [{ type: "tool-result", id: "guide", result: "Route guide ".repeat(100) }] },
  ];
  const prepared = prepareContext(messages, "repo");
  const tools = prepared.input.chunks.filter((chunk) => chunk.kind === "tool_transaction");
  assert.equal(tools.length, 2);
  assert.ok(tools.every((chunk) => chunk.pinned && chunk.pinReason === "recent context"));
  assert.equal(buildSummarySelectorRequest(prepared.input, "model").candidates.length, 0);
  const result = compileSummarySelection(prepared.input, {}, 0);
  assert.deepEqual(applySummaryLevels(messages, prepared, result).messages, messages);
});

test("OpenCode V2 tool parts keep failed test output as a pinned transaction", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "Run the context tests." }] },
    { role: "assistant", content: [{
      type: "tool", id: "test-run", name: "shell",
      state: {
        status: "completed", input: { command: "run-flagged-test.cmd" },
        content: [{ type: "text", text: "1\n14 pass, 1 fail; actual 3, expected 2" }],
        metadata: { exit: 1 },
      },
    }] },
    { role: "assistant", content: [{ type: "text", text: "Investigating." }] },
    { role: "user", content: [{ type: "text", text: "What failed?" }] },
  ];
  const prepared = prepareContext(messages, "repo");
  const result = prepared.input.chunks.find((chunk) => chunk.id === "tool:test-run");
  assert.equal(result?.kind, "error");
  assert.equal(result?.pinned, true);
  assert.match(result?.content ?? "", /run-flagged-test\.cmd[\s\S]*14 pass, 1 fail/);
  assert.equal(buildSummarySelectorRequest(prepared.input, "model").candidates.some(
    ({ chunk }) => chunk.id === "tool:test-run",
  ), false);
});

test("earlier tool steps of the current user turn stay pinned as active work", () => {
  const step = (id: string, name: string, output: string) => ({
    role: "assistant",
    content: [{ type: "tool", id, name, state: { status: "completed", input: { path: "route.ts" }, content: [{ type: "text", text: output }] } }],
  });
  const messages = [
    { role: "user", content: [{ type: "text", text: "Read route.ts." }] },
    step("old-read", "read", "old parseInput code ".repeat(60)),
    { role: "user", content: [{ type: "text", text: "Refactor parseInput, then run the tests." }] },
    step("edit", "edit", "Edited route.ts (1 replacement) ".repeat(20)),
    step("check-1", "read", "run-clear-test.cmd contents ".repeat(20)),
    step("check-2", "read", "package.json contents ".repeat(20)),
    step("check-3", "read", "new parseInput code ".repeat(20)),
  ];
  const prepared = prepareContext(messages, "repo");
  const edit = prepared.input.chunks.find((chunk) => chunk.id === "tool:edit");
  assert.equal(edit?.pinned, true);
  assert.equal(edit?.pinReason, "current task work");
  const candidates = buildSummarySelectorRequest(prepared.input, "model").candidates.map(({ chunk }) => chunk.id);
  assert.deepEqual(candidates, ["tool:old-read"]);
});

test("hyphenated provider keys are detected and redacted", () => {
  // Fake values in the shape of OpenRouter, OpenAI project and Anthropic keys.
  for (const key of ["sk-or-v1-0000fake0000fake0000fake", "sk-proj-FAKEfakeFAKEfake00", "sk-ant-api03-fakeFAKEfake00"]) {
    assert.equal(containsSecret(`OPENROUTER_API_KEY=${key}`), true, key);
    assert.equal(containsSecret(`key ${key} end`), true, key);
    assert.equal(redactSecrets(`OPENROUTER_API_KEY=${key}`).includes(key), false, key);
  }
  assert.equal(containsSecret("use the task-list and sk-short"), false);
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

const HOOK_MESSAGES = [
  { role: "user", content: [{ type: "text", text: "Old task" }] },
  { role: "assistant", content: [{ type: "text", text: "Old answer" }] },
  { role: "user", content: [{ type: "text", text: "Current task" }] },
];

async function runContextHook(env: { apiKey?: string; summaryLevels?: string }) {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalSummaryFlag = process.env.JEV_SUMMARY_LEVELS;
  const originalFetch = globalThis.fetch;
  let hook: ((event: { readonly sessionID: string; messages: typeof HOOK_MESSAGES }) => Promise<void>) | undefined;
  const metrics: Record<string, unknown>[] = [];
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
    if (env.apiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = env.apiKey;
    if (env.summaryLevels === undefined) delete process.env.JEV_SUMMARY_LEVELS;
    else process.env.JEV_SUMMARY_LEVELS = env.summaryLevels;
    // The mock compiler answers with binary decisions only, never summaryDecisions.
    globalThis.fetch = async (_input, init) => {
      const input = JSON.parse(String(init?.body)) as CompileInput;
      assert.equal(input.summaryLevels, env.summaryLevels === "1" ? true : undefined);
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
    const event = { sessionID: "session", messages: [...HOOK_MESSAGES] };
    await hook(event);
    return { messages: event.messages, metric: metrics.at(-1) };
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
    if (originalSummaryFlag === undefined) delete process.env.JEV_SUMMARY_LEVELS;
    else process.env.JEV_SUMMARY_LEVELS = originalSummaryFlag;
  }
}

test("OpenCode context hook filters messages in binary mode", async () => {
  const { messages, metric } = await runContextHook({ apiKey: "test-key" });
  // Status and fallback reason first, so a failure names the fallback cause.
  assert.deepEqual(
    { status: metric?.status, fallbackReason: metric?.fallbackReason },
    { status: "compiled", fallbackReason: undefined },
  );
  assert.deepEqual(messages, HOOK_MESSAGES.slice(1));
  assert.deepEqual(metric?.selection, [
    { kind: "user_turn", tokens: 2, kept: false, relevance: 0.1 },
  ]);
  assert.equal(metric?.inputTokensAfter, 6);
});

test("OpenCode context hook falls back when summary mode gets no summaryDecisions", async () => {
  const { messages, metric } = await runContextHook({ apiKey: "test-key", summaryLevels: "1" });
  assert.deepEqual(
    { status: metric?.status, fallbackReason: metric?.fallbackReason },
    { status: "fallback", fallbackReason: "Compiler returned no summary decisions" },
  );
  assert.deepEqual(messages, HOOK_MESSAGES);
});

test("OpenCode context hook fails safe without a key", async () => {
  const { messages, metric } = await runContextHook({});
  assert.deepEqual(
    { status: metric?.status, fallbackReason: metric?.fallbackReason },
    { status: "fallback", fallbackReason: "OPENROUTER_API_KEY is missing" },
  );
  assert.deepEqual(messages, HOOK_MESSAGES);
  assert.equal(metric?.inputTokensBefore, metric?.inputTokensAfter);
  assert.ok(Number(metric?.inputTokensBefore) > 0);
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

test("selector cache reuses answers only for identical request state and candidate", () => {
  let now = 0;
  const cache = new SelectorAnswerCache(() => now);
  const question = (content: string) => ({ type: "choice", instructions: { candidate: { content } } });
  const request = (current: string, questions: Record<string, unknown>) => ({
    model: "m",
    state: { current_request: current },
    questions,
  });
  const first = request("Refactor parseInput", { summary_0: question("a"), summary_1: question("b") });
  cache.store("summary:key", first, { summary_0: choice("drop", 0.9), summary_1: choice("full", 0.8) });

  // Same turn, new tool step: old candidates shift index but are still found; a new one is asked.
  const next = cache.lookup("summary:key", request("Refactor parseInput", {
    summary_0: question("b"),
    summary_1: question("a"),
    summary_2: question("c"),
  }));
  assert.deepEqual(Object.keys(next.cached), ["summary_0", "summary_1"]);
  assert.equal(next.cached.summary_0?.type === "choice" && next.cached.summary_0.choice, "full");
  assert.deepEqual(Object.keys(next.missing), ["summary_2"]);

  assert.deepEqual(Object.keys(cache.lookup("summary:key", request("New user request", { summary_0: question("a") })).cached), []);
  assert.deepEqual(Object.keys(cache.lookup("binary:key", first).cached), []);
  now = 31 * 60 * 1000;
  assert.deepEqual(Object.keys(cache.lookup("summary:key", first).cached), []);
});

test("pricing lookup needs complete finite prices and defaults cache writes to input", () => {
  const file = {
    updatedAt: "2026-09-23T00:00:00.000Z",
    models: {
      "opencode-go/glm-5.3-flash": { inputPerM: 0.15, cacheReadPerM: 0.03, contextLimit: 1_000_000 },
      "anthropic/claude": { inputPerM: 3, cacheReadPerM: 0.3, cacheWritePerM: 3.75, contextLimit: 200_000 },
      "broken/model": { inputPerM: 1, contextLimit: 1000 },
    },
  };
  const key = pricingKey({ providerID: "opencode-go", id: "glm-5.3-flash" });
  assert.deepEqual(readPricing(file, key), {
    inputPerM: 0.15, cacheReadPerM: 0.03, cacheWritePerM: 0.15, contextLimit: 1_000_000,
  });
  assert.equal(readPricing(file, "anthropic/claude")?.cacheWritePerM, 3.75);
  assert.equal(readPricing(file, "broken/model"), undefined);
  assert.equal(readPricing(file, "missing/model"), undefined);
  assert.equal(readPricing(undefined, key), undefined);
  assert.equal(pricingKey(undefined), undefined);
});

test("usage normalization reads the OpenCode V2 assistant step shape", () => {
  assert.deepEqual(normalizeUsage({
    tokens: { input: 457, output: 404, reasoning: 0, cache: { read: 9472, write: 0 } },
    cost: 0.00055471,
    time: { created: 1, completed: 2 },
  }), { input: 457, output: 404, cacheRead: 9472, cacheWrite: 0, costUsd: 0.00055471, at: 2 });
  assert.equal(normalizeUsage({ tokens: { input: 1, output: 1 } }), undefined);
  assert.equal(normalizeUsage({ role: "assistant", content: "text" }), undefined);
});

test("cache warmth follows the calibrated idle gaps", () => {
  const calibration = { warmMs: 300_000, uncertainMs: 600_000 };
  assert.equal(cacheWarmth(0, calibration), "warm");
  assert.equal(cacheWarmth(300_000, calibration), "warm");
  assert.equal(cacheWarmth(300_001, calibration), "uncertain");
  assert.equal(cacheWarmth(600_001, calibration), "cold");
  assert.equal(cacheWarmth(Number.NaN, calibration), "cold");
  assert.equal(cacheWarmth(-1, calibration), "cold");
});

test("hook diagnostics record field names and types, never values", () => {
  const description = describeEvent({
    sessionID: "ses_secret_value",
    model: { providerID: "opencode-go", id: "glm-5.3-flash" },
    system: [{ type: "text", text: "system secret" }],
    messages: [
      { id: "msg_1", role: "assistant", content: "API_KEY=sk_local_only_123456", tokens: { input: 1, cache: { read: 2 } } },
      { role: "user", content: [{ type: "text", text: "private request" }] },
    ],
  });
  const serialized = JSON.stringify(description);
  assert.doesNotMatch(serialized, /ses_secret|opencode-go|glm|secret|sk_local|private|msg_1/);
  assert.deepEqual(description.eventFields, { sessionID: "string", model: { providerID: "string", id: "string" } });
  assert.deepEqual(description.messagesByRole.assistant, {
    count: 1,
    fields: { id: "string", role: "string", tokens: { input: "number", cache: "object" } },
  });
});

test("session context probe reads provider usage numbers only", async () => {
  const event = {
    sessionID: "ses_probe",
    messages: [{ id: "msg_a", role: "assistant", content: "private answer" }],
  };
  const ctx = (context?: (input: { sessionID: string }) => Promise<unknown>) => ({
    location: { directory: ".", project: {} },
    session: { hook: async () => undefined, ...(context ? { context } : {}) },
    storage: { set: async () => undefined },
  });
  assert.deepEqual(await probeSessionContext(ctx(), event), { available: false });

  let asked: unknown;
  const probe = await probeSessionContext(ctx(async (input) => {
    asked = input;
    return [
      { id: "msg_u", type: "user", content: "private request" },
      { id: "msg_a", type: "assistant", content: "private answer", cost: 0.002, tokens: { input: 900, output: 40, reasoning: 0, cache: { read: 8_000, write: 0 } } },
    ];
  }), event);
  assert.deepEqual(asked, { sessionID: "ses_probe" });
  assert.equal(probe.count, 2);
  assert.deepEqual(probe.kinds, { user: 1, assistant: 1 });
  assert.deepEqual(probe.lastAssistantTokens, { input: 900, output: 40, reasoning: 0, cacheRead: 8_000, cacheWrite: 0 });
  assert.equal(probe.lastAssistantCost, 0.002);
  assert.equal(probe.lastAssistantInEvent, true);
  assert.doesNotMatch(JSON.stringify(probe), /private/);

  const failed = await probeSessionContext(ctx(async () => { throw new Error("boom"); }), event);
  assert.equal(failed.error, "boom");
});

test("outgoing break marks the first message that differs from the previous request", () => {
  assert.deepEqual(outgoingBreak(undefined, ["a"]), { firstDifference: undefined, commonPrefix: 0 });
  assert.deepEqual(outgoingBreak(["a", "b"], ["a", "b", "c"]), { firstDifference: 2, commonPrefix: 2 });
  assert.deepEqual(outgoingBreak(["a", "b", "c"], ["a", "c", "d"]), { firstDifference: 1, commonPrefix: 1 });
  assert.deepEqual(outgoingBreak(["a", "b"], ["a", "b"]), { firstDifference: undefined, commonPrefix: 2 });
});

const GLM_PRICING = { inputPerM: 0.15, cacheReadPerM: 0.03, cacheWritePerM: 0.15, contextLimit: 1_000_000 };

function routeInput(overrides: Partial<RouteInput> = {}): RouteInput {
  return {
    prefix: "valid",
    pricing: GLM_PRICING,
    sameUserTurn: false,
    gapMs: 10_000,
    prefixTokens: 10_000,
    appendedTokens: 500,
    fullTokens: 10_500,
    pinnedTokens: 2_000,
    keepRatio: 0.9,
    selectorCostUsd: 0.001,
    ...overrides,
  };
}

test("decideRoute applies rules 1-4 in fixed order", () => {
  assert.deepEqual(
    [
      decideRoute(routeInput({ pricing: undefined })).reason,
      decideRoute(routeInput({ prefix: "none" })).reason,
      decideRoute(routeInput({ prefix: "invalid" })).reason,
      // 0.8 × min(1M, 108k) = 86.4k tokens
      decideRoute(routeInput({ prefixTokens: 86_000, appendedTokens: 400, sameUserTurn: true })).reason,
      decideRoute(routeInput({ sameUserTurn: true, gapMs: 1_000 })).reason,
      decideRoute(routeInput({ sameUserTurn: true, gapMs: 900_000 })).reason,
      decideRoute(routeInput({ gapMs: 900_000 })).reason,
    ],
    [
      "no pricing",
      "first dispatch",
      "invalid prefix",
      "context pressure",
      "tool loop, warm cache",
      "cold cache",
      "cold cache",
    ],
  );
  assert.equal(decideRoute(routeInput({ pricing: undefined })).route, "rebuild");
  assert.equal(decideRoute(routeInput({ sameUserTurn: true, gapMs: 1_000 })).route, "reuse");
  assert.equal(decideRoute(routeInput({ prefixTokens: 86_000, appendedTokens: 400 })).route, "rebuild");
});

test("decideRoute compares costs, asks Jev only in the gray zone of a new user turn", () => {
  const reuse = decideRoute(routeInput());
  assert.deepEqual([reuse.route, reuse.reason], ["reuse", "reuse cheaper"]);
  assert.ok(reuse.reuseUsdEstimated! < reuse.rebuildUsdEstimated!);

  const rebuild = decideRoute(routeInput({
    prefixTokens: 50_000, fullTokens: 50_500, keepRatio: 0.1, selectorCostUsd: 0.0001,
  }));
  assert.deepEqual([rebuild.route, rebuild.reason, rebuild.rebuildTokensEstimated], ["rebuild", "rebuild cheaper", 5_050]);

  // Balance the selector cost so both sides cost the same: gray zone.
  const free = decideRoute(routeInput({ selectorCostUsd: 0, gapMs: 400_000 }));
  const balanced = routeInput({
    gapMs: 400_000,
    selectorCostUsd: free.reuseUsdEstimated! - free.rebuildUsdEstimated!,
  });
  const gray = decideRoute(balanced);
  assert.deepEqual([gray.route, gray.reason, gray.warmth, gray.needsContinuity], ["rebuild", "gray zone", "uncertain", true]);
  assert.equal(decideRoute({ ...balanced, sameUserTurn: true }).needsContinuity, undefined);
  assert.deepEqual(
    [0.8, 0.3, 0.5].map((continuity) => decideRoute({ ...balanced, continuity }).reason),
    ["continuing task", "new task", "uncertain continuity"],
  );
  assert.equal(decideRoute({ ...balanced, continuity: 0.8 }).route, "reuse");
});

test("decideRoute rule 6 re-checks with the real rebuild size and a sunk selector cost", () => {
  const estimated = routeInput({ prefixTokens: 50_000, fullTokens: 50_500, keepRatio: 0.1 });
  assert.equal(decideRoute(estimated).route, "rebuild");
  const actual = decideRoute({ ...estimated, rebuildTokensActual: 49_000 });
  assert.deepEqual([actual.route, actual.rebuildTokensEstimated], ["reuse", 49_000]);
});

test("decideRoute is deterministic and uses the exported defaults", () => {
  const input = routeInput({ gapMs: 450_000 });
  assert.deepEqual(decideRoute(input), decideRoute(structuredClone(input)));
  assert.deepEqual(decideRoute(input), decideRoute(input, DEFAULT_ROUTING));
  assert.equal(decideRoute(input, { ...DEFAULT_ROUTING, uncertainMs: 400_000 }).reason, "cold cache");
});

test("routing state parser rejects malformed shapes", () => {
  const state = {
    version: 1, sent: [{ key: "m1", hash: "h" }, { summaryOf: "tool:x", level: "short", hash: "h2" }],
    lastSeenKey: "m1", sentTokens: 10, lastDispatchAt: 1, lastUserKey: "m1", pricingModel: "p/m",
  };
  assert.deepEqual(parseRoutingState(state), state);
  assert.equal(parseRoutingState({ ...state, version: 2 }), undefined);
  assert.equal(parseRoutingState({ ...state, sent: [{ key: "m1" }] }), undefined);
  assert.equal(parseRoutingState({ ...state, sent: [{ summaryOf: "x", level: "full", hash: "h" }] }), undefined);
  assert.equal(parseRoutingState({ ...state, sentTokens: -1 }), undefined);
  assert.equal(parseRoutingState("state"), undefined);
});

type RoutedMessage = { id?: string; role: string; content?: unknown };
const text = (id: string, role: string, value: string): RoutedMessage =>
  ({ id, role, content: [{ type: "text", text: value }] });
type ToolPart = { type: "tool"; id: string; name: string; state: { status: string; input: unknown; content: Array<{ type: "text"; text: string }> } };
/** An OpenCode V2 assistant step with one completed read. */
const read = (id: string, path: string, output: string): RoutedMessage => ({
  id,
  role: "assistant",
  content: [{ type: "tool", id: `t-${id}`, name: "read", state: { status: "completed", input: { path }, content: [{ type: "text", text: output }] } }],
});
const outputOf = (message: RoutedMessage) => (message.content as ToolPart[])[0].state.content[0].text;
const TOOL_HISTORY = [
  text("u0", "user", "Old task"),
  read("r0", "src/old.ts", "Unrelated old file ".repeat(40)),
  text("a0", "assistant", "The old file has three helpers."),
  text("u0b", "user", "Another old task"),
  text("a0b", "assistant", "Short answer"),
  text("u1", "user", "Current task"),
];

test("reuse rebuilds the exact sent prefix and appends new messages", () => {
  const messages = [
    text("u0", "user", "Old task"),
    text("a0", "assistant", "Old answer ".repeat(60)),
    text("u1", "user", "Current task"),
  ];
  const state = { sent: describeSent(messages, [messages[0], messages[2]]), lastSeenKey: "u1" };
  const next = [...messages, text("a1", "assistant", "Working")];
  const reuse = buildReuseMessages(next, prepareContext(next, "repo"), state);
  assert.deepEqual(reuse?.messages, [messages[0], messages[2], next[3]]);
  assert.deepEqual(reuse?.appended, [next[3]]);

  // Compaction or an edited message changes the hash; a missing message breaks the prefix.
  const edited = [text("u0", "user", "Compacted"), ...next.slice(1)];
  assert.equal(buildReuseMessages(edited, prepareContext(edited, "repo"), state), undefined);
  const missing = next.slice(1);
  assert.equal(buildReuseMessages(missing, prepareContext(missing, "repo"), state), undefined);
  assert.equal(buildReuseMessages(next, prepareContext(next, "repo"), { ...state, lastSeenKey: "gone" }), undefined);
  assert.throws(() => describeSent(messages, [{ role: "assistant", content: "unknown" }]), /no known origin/);
});

test("reuse reproduces summary extracts byte-identically and never orphans tool pairs", () => {
  const messages: RoutedMessage[] = [
    { id: "calls", role: "assistant", content: [
      { type: "tool-call", id: "summarize", name: "read", input: { path: "src/a.ts" } },
      { type: "tool-call", id: "drop", name: "read", input: { path: "src/b.ts" } },
    ] },
    { id: "r1", role: "tool", content: [{ type: "tool-result", id: "summarize", result: "needed ".repeat(300) }] },
    { id: "r2", role: "tool", content: [{ type: "tool-result", id: "drop", result: "noise ".repeat(300) }] },
    text("a1", "assistant", "constraint ".repeat(300)),
    text("u1", "user", "Earlier instruction"),
    text("a2", "assistant", "Recent answer"),
    text("u2", "user", "Current task"),
  ];
  const prepared = prepareContext(messages, "repo");
  const { candidates } = buildSummarySelectorRequest(prepared.input, "typesafe/jev-1.13");
  const answers = Object.fromEntries(candidates.map(({ chunk: item }, index) => [
    `summary_${index}`,
    item.id === "tool:summarize" ? choice("short", 0.9) : item.id === "message:3" ? choice("long", 0.9) : choice("drop", 0.9),
  ]));
  const compiled = applySummaryLevels(messages, prepared, compileSummarySelection(prepared.input, answers, 1)).messages;
  const state = { sent: describeSent(messages, compiled), lastSeenKey: "u2" };
  assert.ok(state.sent.some((entry) => "summaryOf" in entry));
  assert.doesNotMatch(JSON.stringify(state), /needed|constraint|Current task/);

  const next = [...messages, text("a3", "assistant", "Next step")];
  const reuse = buildReuseMessages(next, prepareContext(next, "repo"), state);
  assert.equal(JSON.stringify(reuse?.messages), JSON.stringify([...compiled, next.at(-1)]));

  // A prefix that kept a tool call without its result is rejected.
  const pairs: RoutedMessage[] = [
    text("u", "user", "Read"),
    { id: "call", role: "assistant", content: [{ type: "tool-call", id: "x", name: "read", input: {} }] },
    { id: "result", role: "tool", content: [{ type: "tool-result", id: "x", result: "body" }] },
    text("u3", "user", "Next"),
  ];
  const orphan = { sent: describeSent(pairs, pairs.slice(0, 2)), lastSeenKey: "result" };
  assert.equal(buildReuseMessages(pairs, prepareContext(pairs, "repo"), orphan), undefined);
});

type HookEvent = {
  readonly sessionID: string;
  readonly agent?: string;
  readonly model?: { providerID: string; id: string };
  messages: RoutedMessage[];
};

async function routingHarness(options: {
  routing?: string;
  pricing?: boolean;
  storage?: "broken";
  dropIds?: string[];
  compilerFails?: boolean;
  continuity?: number;
  store?: Map<string, Record<string, unknown>>;
  policy?: string;
  sessionContext?: unknown[];
}) {
  const saved = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    JEV_CACHE_ROUTING: process.env.JEV_CACHE_ROUTING,
    JEV_PRICING_FILE: process.env.JEV_PRICING_FILE,
    JEV_SUMMARY_LEVELS: process.env.JEV_SUMMARY_LEVELS,
    JEV_CACHE_POLICY: process.env.JEV_CACHE_POLICY,
  };
  const pricingPath = join(tmpdir(), `jev-routing-${crypto.randomUUID()}.json`);
  writeFileSync(pricingPath, JSON.stringify({
    updatedAt: "2026-09-23T00:00:00.000Z",
    models: options.pricing === false ? {} : { "opencode-go/glm-5.3-flash": GLM_PRICING },
  }));
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.JEV_PRICING_FILE = pricingPath;
  delete process.env.JEV_SUMMARY_LEVELS;
  if (options.routing === undefined) delete process.env.JEV_CACHE_ROUTING;
  else process.env.JEV_CACHE_ROUTING = options.routing;
  if (options.policy === undefined) delete process.env.JEV_CACHE_POLICY;
  else process.env.JEV_CACHE_POLICY = options.policy;

  const store = options.store ?? new Map<string, Record<string, unknown>>();
  const metrics: Record<string, unknown>[] = [];
  const bodies: Array<CompileInput & { continuity?: { previousRequest: string } }> = [];
  let hook: ((event: HookEvent) => Promise<void>) | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const input = JSON.parse(String(init?.body)) as CompileInput & { continuity?: { previousRequest: string } };
    bodies.push(input);
    if (options.compilerFails) return new Response("down", { status: 503 });
    const drop = new Set((options.dropIds ?? []).filter((id) =>
      input.chunks.some((item) => item.id === id && !item.pinned)));
    return Response.json({
      mode: "rebuild",
      chunks: input.chunks,
      decisions: input.chunks.map((item) => ({ id: item.id, kept: !drop.has(item.id), reason: "test" })),
      keptChunkIds: input.chunks.filter((item) => !drop.has(item.id)).map((item) => item.id),
      droppedChunkIds: [...drop],
      compiledContext: "",
      inputTokensBefore: 0,
      inputTokensAfter: 0,
      selectorLatencyMs: 1,
      selectorUsage: { inputTokens: 10, outputTokens: 1, costUsd: 0.0001 },
      ...(input.continuity && options.continuity !== undefined ? { continuity: options.continuity } : {}),
    } satisfies CompilationResult);
  };
  await jevContextPlugin.setup({
    location: { directory: "repo", project: { canonical: "repo" } },
    session: {
      async hook(_name: "context", callback: typeof hook) { hook = callback; },
      ...(options.sessionContext ? { context: async () => options.sessionContext } : {}),
    },
    storage: {
      async set(key: string, value: Record<string, unknown>) {
        if (key.startsWith("metrics/")) metrics.push(value);
        else if (options.storage === "broken" && key.startsWith("routing/")) throw new Error("disk full");
        else store.set(key, structuredClone(value));
      },
      async get(key: string) {
        if (options.storage === "broken") throw new Error("disk unreadable");
        return store.get(key);
      },
    },
  });
  const restore = () => {
    globalThis.fetch = originalFetch;
    unlinkSync(pricingPath);
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  const dispatch = async (messages: RoutedMessage[]) => {
    const event: HookEvent = {
      sessionID: "session",
      agent: "build",
      model: { providerID: "opencode-go", id: "glm-5.3-flash" },
      messages: [...messages],
    };
    await hook!(event);
    return { messages: event.messages, metric: metrics.at(-1)! };
  };
  return { dispatch, restore, bodies, store };
}

test("turn policy appends in the tool loop and stubs the last turn's tool outputs at the next user turn", async () => {
  const harness = await routingHarness({ routing: "1", policy: "turn", dropIds: ["tool:t-r0", "tool:t-r1"] });
  try {
    const first = await harness.dispatch(TOOL_HISTORY);
    assert.deepEqual([first.metric.turnRoute, first.metric.routeReason], ["full", "first dispatch"]);
    // Nothing is removed: the old read keeps its call, only the output is stubbed.
    assert.deepEqual(ids(first.messages), ids(TOOL_HISTORY));
    assert.equal(outputOf(first.messages[1]), TOOL_OUTPUT_REMOVED);
    assert.equal(first.messages[2], TOOL_HISTORY[2]);
    // Answers and user turns are never pruning candidates.
    assert.equal(harness.bodies[0].chunks.find((chunk) => chunk.id === "message:2")?.pinReason, "turn text stays");

    const loop = [...TOOL_HISTORY, read("r1", "src/scratch.ts", "Scratch output nobody needs again ".repeat(40))];
    const second = await harness.dispatch(loop);
    assert.equal(harness.bodies.length, 1);
    assert.deepEqual([second.metric.turnRoute, second.metric.status, second.metric.breakIndex], ["reuse", "reused", undefined]);
    assert.equal(JSON.stringify(second.messages[1]), JSON.stringify(first.messages[1]));
    assert.match(outputOf(second.messages[6]), /Scratch output/);

    const nextTurn = [...loop, text("a3", "assistant", "Done"), text("u2", "user", "Next task")];
    const third = await harness.dispatch(nextTurn);
    assert.equal(harness.bodies.length, 2);
    // Frozen chunks never travel to the compiler again; only the last turn is judged.
    assert.deepEqual(harness.bodies[1].chunks.map((chunk) => chunk.id), ["tool:t-r1", "message:7", "message:8"]);
    assert.equal(harness.bodies[1].chunks[0].pinned, false);
    assert.deepEqual(ids(third.messages), ids(nextTurn));
    assert.equal(outputOf(third.messages[1]), TOOL_OUTPUT_REMOVED);
    assert.equal(outputOf(third.messages[6]), TOOL_OUTPUT_REMOVED);
    assert.deepEqual((third.messages[6].content as ToolPart[])[0].state.input, { path: "src/scratch.ts" });
    assert.deepEqual(
      [third.metric.turnRoute, third.metric.routeReason, third.metric.breakIndex, third.metric.removedFrozenChunks],
      ["prune", "new user turn", 6, 1],
    );
    assert.equal(
      decideTurnRoute(third.metric.routeInput as Parameters<typeof decideTurnRoute>[0], third.metric.routeConfig as typeof DEFAULT_ROUTING).route,
      third.metric.turnRoute,
    );
    // The routing state stays content-free with stubs, too.
    const routingState = [...harness.store].filter(([key]) => key.startsWith("routing/")).map(([, value]) => value);
    assert.equal(routingState.length, 1);
    assert.doesNotMatch(JSON.stringify(routingState), /Scratch output|Unrelated old file|three helpers/);

    const fourth = await harness.dispatch([...nextTurn, text("a4", "assistant", "Next step")]);
    assert.equal(harness.bodies.length, 2);
    assert.deepEqual(ids(fourth.messages), [...ids(nextTurn), "a4"]);
    assert.equal(JSON.stringify(fourth.messages.slice(0, -1)), JSON.stringify(third.messages));
  } finally {
    harness.restore();
  }
});

test("turn policy keeps stubbed outputs stubbed when a later compile fails", async () => {
  const harness = await routingHarness({
    routing: "1",
    policy: "turn",
    dropIds: ["tool:t-r0"],
    sessionContext: [{ id: "a1", type: "assistant", tokens: { input: 1_000, output: 0, cache: { read: 850_000, write: 0 } } }],
  });
  try {
    await harness.dispatch(TOOL_HISTORY);
    // Pressure asks for a full re-judgement; the compiler is down.
    globalThis.fetch = async () => new Response("down", { status: 503 });
    const next = await harness.dispatch([...TOOL_HISTORY, text("a1", "assistant", "Step"), text("u2", "user", "Next")]);
    assert.deepEqual([next.metric.turnRoute, next.metric.routeReason, next.metric.status], ["refresh", "context pressure", "fallback"]);
    assert.deepEqual(ids(next.messages), [...ids(TOOL_HISTORY), "a1", "u2"]);
    assert.equal(outputOf(next.messages[1]), TOOL_OUTPUT_REMOVED);
  } finally {
    harness.restore();
  }
});

test("turn policy measures pressure with the real provider prompt", async () => {
  const harness = await routingHarness({
    routing: "1",
    policy: "turn",
    sessionContext: [
      { id: "u0", type: "user" },
      { id: "a1", type: "assistant", tokens: { input: 1_000, output: 50, reasoning: 0, cache: { read: 850_000, write: 0 } } },
    ],
  });
  try {
    await harness.dispatch(HISTORY);
    const loop = await harness.dispatch([...HISTORY, text("a1", "assistant", "Tool step")]);
    assert.equal(loop.metric.promptTokensReal, true);
    assert.ok((loop.metric.promptTokens as number) >= 851_050);
    assert.deepEqual([loop.metric.turnRoute, loop.metric.routeReason, loop.metric.refreshApplied], ["refresh", "context pressure", true]);
  } finally {
    harness.restore();
  }
});

test("decideTurnRoute: first dispatch, real-window pressure, tool loop, growth refresh, new turn", () => {
  const base = { prefix: "valid" as const, sameUserTurn: true, gapMs: 1_000, promptTokens: 10_000, promptTokensReal: true, contextLimit: 1_000_000 };
  assert.equal(decideTurnRoute({ ...base, prefix: "none" }).reason, "first dispatch");
  assert.equal(decideTurnRoute({ ...base, prefix: "invalid" }).reason, "invalid prefix");
  // Pressure follows the model's own window, not a fixed compaction size.
  assert.deepEqual(decideTurnRoute({ ...base, promptTokens: 800_000 }), { route: "refresh", reason: "context pressure", warmth: "warm", force: true });
  assert.equal(decideTurnRoute({ ...base, promptTokens: 799_999 }).route, "reuse");
  assert.equal(decideTurnRoute({ ...base, contextLimit: 50_000, promptTokens: 40_000 }).reason, "context pressure");
  // A pause alone never forces a re-judgement: caches can outlive it.
  assert.equal(decideTurnRoute({ ...base, sameUserTurn: false, gapMs: 3_600_000 }).route, "prune");
  const turn = { ...base, sameUserTurn: false };
  assert.equal(decideTurnRoute({ ...turn, promptTokens: 39_999 }).route, "prune");
  assert.equal(decideTurnRoute({ ...turn, promptTokens: 40_000 }).reason, "context growth");
  assert.equal(decideTurnRoute({ ...turn, promptTokens: 44_999, lastRefreshPromptTokens: 30_000 }).route, "prune");
  assert.equal(decideTurnRoute({ ...turn, promptTokens: 45_000, lastRefreshPromptTokens: 30_000 }).route, "refresh");
});

test("refreshPays weighs removed tokens over the horizon against rewriting the tail", () => {
  // glm: read 0.03, write 0.15 per 1M; horizon 10 -> removed * 0.3 >= tail * 0.12.
  assert.equal(refreshPays({ removedTokens: 4_000, tailTokens: 10_000, pricing: GLM_PRICING }), true);
  assert.equal(refreshPays({ removedTokens: 3_999, tailTokens: 10_000, pricing: GLM_PRICING }), false);
  assert.equal(refreshPays({ removedTokens: 1_000, tailTokens: 0, pricing: GLM_PRICING }), true);
  assert.equal(refreshPays({ removedTokens: 0, tailTokens: 0, pricing: GLM_PRICING }), false);
  assert.equal(refreshPays({ removedTokens: 10_000, tailTokens: 1 }), false);
});

test("compileTimeoutMs accepts 500-5000 ms and otherwise keeps 5000", () => {
  assert.equal(compileTimeoutMs(undefined), 5_000);
  assert.equal(compileTimeoutMs(" 1500 "), 1_500);
  assert.equal(compileTimeoutMs("499"), 5_000);
  assert.equal(compileTimeoutMs("5001"), 5_000);
  assert.equal(compileTimeoutMs("1.5e3"), 1_500);
  assert.equal(compileTimeoutMs("abc"), 5_000);
});

test("splitChunks keeps every request below the chunk and payload limits", () => {
  const chunk = (index: number, size: number) => ({
    id: `c${index}`, kind: "assistant_turn" as const, content: "x".repeat(size), turn: index,
    tokenEstimate: size / 4, dependencies: [], pinned: false, source: { agent: "opencode" as const, messageIds: [`m${index}`] },
  });
  const byCount = splitChunks(Array.from({ length: 130 }, (_, index) => chunk(index, 10)));
  assert.deepEqual(byCount.map((batch) => batch.length), [60, 60, 10]);
  const bySize = splitChunks(Array.from({ length: 40 }, (_, index) => chunk(index, 12_000)));
  assert.ok(bySize.length > 1);
  assert.ok(bySize.every((batch) => JSON.stringify(batch).length <= 200_000));
  assert.equal(bySize.flat().length, 40);
});

test("turn policy compiles long histories in batches and still stubs across them", async () => {
  const long = [
    text("u0", "user", "Old task"),
    ...Array.from({ length: 130 }, (_, index) => read(`a${index}`, `src/file-${index}.ts`, `Finding ${index} `.repeat(40))),
    text("u1", "user", "Current task"),
  ];
  const harness = await routingHarness({ routing: "1", policy: "turn", dropIds: ["tool:t-a1", "tool:t-a99"] });
  try {
    const first = await harness.dispatch(long);
    assert.equal(harness.bodies.length, 3);
    assert.ok(harness.bodies.every((body) => body.chunks.length <= 60));
    assert.equal(first.metric.compilerBatches, 3);
    assert.equal(first.messages.length, long.length);
    assert.equal(outputOf(first.messages[2]), TOOL_OUTPUT_REMOVED);
    assert.equal(outputOf(first.messages[100]), TOOL_OUTPUT_REMOVED);
    assert.equal(first.messages[3], long[3]);
  } finally {
    harness.restore();
  }
});

test("turn policy re-judges frozen context when the real prompt has grown and it pays", async () => {
  const dropIds: string[] = [];
  const harness = await routingHarness({
    routing: "1",
    policy: "turn",
    dropIds,
    sessionContext: [{ id: "a1", type: "assistant", tokens: { input: 2_000, output: 0, cache: { read: 48_000, write: 0 } } }],
  });
  try {
    const start = [
      text("u0", "user", "Old task"),
      read("r0", "src/unrelated.ts", "Old investigation of an unrelated module ".repeat(40)),
      text("u1", "user", "Current task"),
    ];
    const first = await harness.dispatch(start);
    assert.equal(outputOf(first.messages[1]), outputOf(start[1]));
    await harness.dispatch([...start, text("a1", "assistant", "Tool step")]);
    // Next user turn: the real prompt grew past the refresh threshold; Jev now
    // drops the old read although it was already frozen.
    dropIds.push("tool:t-r0");
    const next = await harness.dispatch([...start, text("a1", "assistant", "Tool step"), text("a2", "assistant", "Done"), text("u2", "user", "Next task")]);
    assert.deepEqual([next.metric.turnRoute, next.metric.routeReason, next.metric.refreshApplied], ["refresh", "context growth", true]);
    assert.deepEqual(ids(next.messages), ["u0", "r0", "u1", "a1", "a2", "u2"]);
    assert.equal(outputOf(next.messages[1]), TOOL_OUTPUT_REMOVED);
    assert.equal(next.metric.breakIndex, 1);
  } finally {
    harness.restore();
  }
});

test("stubbed tool outputs keep the call, stay byte-identical and survive reuse", () => {
  const messages = [
    text("u0", "user", "Read it"),
    read("r0", "src/a.ts", "body ".repeat(200)),
    text("a0", "assistant", "Found three reasons"),
    text("u1", "user", "Next"),
  ];
  const prepared = prepareContext(messages, "repo");
  const keep = prepared.input.chunks.filter((chunk) => chunk.id !== "tool:t-r0").map((chunk) => chunk.id);
  const sent = stubMessages(messages, prepared, keep);
  assert.equal(sent.length, messages.length);
  assert.deepEqual((sent[1].content as ToolPart[])[0].state.input, { path: "src/a.ts" });
  assert.equal(outputOf(sent[1]), TOOL_OUTPUT_REMOVED);
  assert.equal(sent[2], messages[2]);
  assert.equal(JSON.stringify(stubMessages(messages, prepared, keep)), JSON.stringify(sent));

  const described = describeSent(messages, sent);
  assert.ok("stubOf" in described[1] && described[1].stubOf === "r0");
  assert.doesNotMatch(JSON.stringify(described), /body|Found three/);
  const state = { version: 1, sent: described, lastSeenKey: "u1", sentTokens: 1, lastDispatchAt: 1, lastUserKey: "u1", pricingModel: "m" };
  assert.ok(parseRoutingState(state));
  assert.equal(parseRoutingState({ ...state, sent: [{ stubOf: "r0", parts: [], hash: "h" }] }), undefined);
  assert.equal(parseRoutingState({ ...state, sent: [{ stubOf: "r0", parts: [-1], hash: "h" }] }), undefined);

  const next = [...messages, text("a1", "assistant", "Step")];
  const reuse = buildReuseMessages(next, prepareContext(next, "repo"), state);
  assert.equal(JSON.stringify(reuse?.messages), JSON.stringify([...sent, next[4]]));
  // A changed tool call breaks the prefix.
  const edited = [messages[0], read("r0", "src/b.ts", "body ".repeat(200)), ...next.slice(2)];
  assert.equal(buildReuseMessages(edited, prepareContext(edited, "repo"), state), undefined);
});

test("turn policy stubs AI SDK tool results as OpenCode sends them live", async () => {
  // Live shape (OpenCode 2.0.13): tool-call parts in the assistant step, results
  // in a following `tool` message without an id.
  const call = (id: string, callId: string, path: string): RoutedMessage =>
    ({ id, role: "assistant", content: [{ type: "tool-call", id: callId, name: "read", input: { path } }] });
  const result = (callId: string, value: string): RoutedMessage =>
    ({ role: "tool", content: [{ type: "tool-result", id: callId, name: "read", result: { type: "text", value } }] });
  const valueOf = (message: RoutedMessage) => (message.content as Array<{ result: { value: string } }>)[0].result.value;
  const start = [
    text("u0", "user", "Read the cache"),
    call("c0", "k0", "src/cache.ts"),
    result("k0", "Cache module body ".repeat(60)),
    text("a0", "assistant", "TTL is 30 minutes."),
    text("u1", "user", "New topic"),
  ];
  const harness = await routingHarness({ routing: "1", policy: "turn", dropIds: ["tool:k0", "tool:k1"] });
  try {
    const first = await harness.dispatch(start);
    assert.equal(harness.bodies[0].chunks.find((chunk) => chunk.id === "tool:k0")?.pinned, false);
    assert.equal(harness.bodies[0].chunks.find((chunk) => chunk.id === "message:0")?.pinReason, "turn text stays");
    assert.equal(first.messages.length, start.length);
    assert.equal(first.messages[1], start[1]);
    assert.equal(valueOf(first.messages[2]), TOOL_OUTPUT_REMOVED);
    assert.equal((first.messages[2].content as Array<{ id: string }>)[0].id, "k0");
    assert.equal(first.messages[3], start[3]);

    const loop = [...start, call("c1", "k1", "src/panel.tsx"), result("k1", "Panel body ".repeat(60))];
    const second = await harness.dispatch(loop);
    assert.deepEqual([second.metric.turnRoute, second.metric.breakIndex], ["reuse", undefined]);
    assert.equal(JSON.stringify(second.messages.slice(0, start.length)), JSON.stringify(first.messages));
    assert.match(valueOf(second.messages[6]), /Panel body/);

    const third = await harness.dispatch([...loop, text("a1", "assistant", "It renders runs."), text("u2", "user", "Back to the cache")]);
    assert.deepEqual(harness.bodies[1].chunks.filter((chunk) => !chunk.pinned).map((chunk) => chunk.id), ["tool:k1"]);
    assert.equal(third.metric.turnRoute, "prune");
    assert.equal(valueOf(third.messages[2]), TOOL_OUTPUT_REMOVED);
    assert.equal(valueOf(third.messages[6]), TOOL_OUTPUT_REMOVED);
    assert.equal(third.messages[5], loop[5]);
    const routingState = [...harness.store].filter(([key]) => key.startsWith("routing/")).map(([, value]) => value);
    assert.doesNotMatch(JSON.stringify(routingState), /Cache module body|Panel body/);
  } finally {
    harness.restore();
  }
});

const HISTORY = [
  text("u0", "user", "Old task"),
  text("a0", "assistant", "Unrelated old investigation ".repeat(40)),
  text("u0b", "user", "Another old task"),
  text("a0b", "assistant", "Short answer"),
  text("u1", "user", "Current task"),
];
const ids = (messages: RoutedMessage[]) => messages.map((message) => message.id);

test("routing off keeps the hook unchanged: one compiler call per dispatch, no routing state", async () => {
  const harness = await routingHarness({ dropIds: ["message:1"] });
  try {
    const first = await harness.dispatch(HISTORY);
    const second = await harness.dispatch([...HISTORY, text("a1", "assistant", "Step")]);
    assert.equal(harness.bodies.length, 2);
    assert.deepEqual(ids(first.messages), ["u0", "u0b", "a0b", "u1"]);
    assert.deepEqual(ids(second.messages), ["u0", "u0b", "a0b", "u1", "a1"]);
    assert.equal(first.metric.route, undefined);
    assert.equal([...harness.store.keys()].some((key) => key.startsWith("routing/")), false);
    assert.equal("continuity" in harness.bodies[0], false);
  } finally {
    harness.restore();
  }
});

test("routed tool-loop step on a warm cache reuses the prefix without a compiler call", async () => {
  const harness = await routingHarness({ routing: "1", dropIds: ["message:1"] });
  try {
    const first = await harness.dispatch(HISTORY);
    assert.deepEqual([first.metric.route, first.metric.routeReason], ["rebuild", "first dispatch"]);
    const second = await harness.dispatch([...HISTORY, text("a1", "assistant", "Tool step")]);
    assert.equal(harness.bodies.length, 1);
    assert.deepEqual(ids(second.messages), ["u0", "u0b", "a0b", "u1", "a1"]);
    assert.deepEqual(
      [second.metric.status, second.metric.route, second.metric.routeReason, second.metric.compilerSkipped],
      ["reused", "reuse", "tool loop, warm cache", true],
    );
    // Logged inputs replay to the same decision offline.
    const replay = decideRoute(second.metric.routeInput as RouteInput, second.metric.routeConfig as typeof DEFAULT_ROUTING);
    assert.equal(replay.route, second.metric.route);
    const [key, state] = [...harness.store.entries()].find(([item]) => item.startsWith("routing/"))!;
    assert.equal(key, "routing/session/build");
    assert.doesNotMatch(JSON.stringify(state), /task|investigation|Tool step/i);
  } finally {
    harness.restore();
  }
});

test("routing state survives a new plugin process through storage", async () => {
  const store = new Map<string, Record<string, unknown>>();
  const first = await routingHarness({ routing: "1", store });
  try {
    await first.dispatch(HISTORY);
  } finally {
    first.restore();
  }
  const second = await routingHarness({ routing: "1", store });
  try {
    const result = await second.dispatch([...HISTORY, text("a1", "assistant", "Tool step")]);
    assert.equal(result.metric.route, "reuse");
    assert.equal(second.bodies.length, 0);
  } finally {
    second.restore();
  }
});

test("routing keeps the status quo on changed history, missing prices, storage and compiler errors", async () => {
  const compacted = await routingHarness({ routing: "1" });
  try {
    await compacted.dispatch(HISTORY);
    const edited = [text("u0", "user", "Compacted summary"), ...HISTORY.slice(1), text("a1", "assistant", "Step")];
    const result = await compacted.dispatch(edited);
    assert.deepEqual(
      [result.metric.route, result.metric.routeReason, result.metric.prefixValid],
      ["rebuild", "invalid prefix", false],
    );
    assert.equal(compacted.bodies.length, 2);
  } finally {
    compacted.restore();
  }

  const noPricing = await routingHarness({ routing: "1", pricing: false });
  try {
    await noPricing.dispatch(HISTORY);
    const result = await noPricing.dispatch([...HISTORY, text("a1", "assistant", "Step")]);
    assert.deepEqual([result.metric.route, result.metric.routeReason], ["rebuild", "no pricing"]);
    assert.equal(noPricing.bodies.length, 2);
  } finally {
    noPricing.restore();
  }

  const broken = await routingHarness({ routing: "1", storage: "broken", dropIds: ["message:1"] });
  try {
    const first = await broken.dispatch(HISTORY);
    assert.equal(first.metric.status, "compiled");
    assert.deepEqual(ids(first.messages), ["u0", "u0b", "a0b", "u1"]);
    // Persisting failed, but this process still routes from memory.
    const second = await broken.dispatch([...HISTORY, text("a1", "assistant", "Step")]);
    assert.equal(second.metric.route, "reuse");
  } finally {
    broken.restore();
  }

  const down = await routingHarness({ routing: "1", compilerFails: true });
  try {
    const first = await down.dispatch(HISTORY);
    assert.deepEqual([first.metric.status, first.metric.route], ["fallback", "rebuild"]);
    assert.deepEqual(first.messages, HISTORY);
  } finally {
    down.restore();
  }
});

test("continuity question is added only on request, redacted, and parsed strictly", () => {
  const input = {
    currentRequest: "Now add tests",
    activeGoal: "Now add tests",
    repository: "repo",
    chunks: [{ ...chunk("candidate"), tokenEstimate: 100 }],
  };
  assert.equal("continuity" in buildSelectorRequest(input, "m").request.questions, false);
  assert.equal("continuity" in buildSummarySelectorRequest(input, "m").request.questions, false);

  const asked = { ...input, continuity: { previousRequest: "Refactor with API_KEY=sk_previous_secret_123456" } };
  for (const { request } of [buildSelectorRequest(asked, "m"), buildSummarySelectorRequest(asked, "m")]) {
    const question = (request.questions as Record<string, { type: string }>).continuity;
    assert.equal(question.type, "noul");
    assert.match(JSON.stringify(question), /Refactor with/);
    assert.doesNotMatch(JSON.stringify(request), /sk_previous_secret/);
  }
  // The extra question does not disturb candidate answers.
  const result = compileSelection(asked, { relevance_0: { type: "noul", noul: 0.9 }, continuity: { type: "noul", noul: 0.2 } }, 1);
  assert.deepEqual(result.keptChunkIds, ["candidate"]);

  assert.equal(readContinuity({ continuity: { type: "noul", noul: 0.7 } }), 0.7);
  assert.equal(readContinuity({ continuity: { type: "noul", noul: 1.5 } }), undefined);
  assert.equal(readContinuity({}), undefined);
});

test("decideRoute prices a rebuild with its measured cache hits and a keep-ratio prior", () => {
  // Observed in the v1 live run: new user turn, 11k warm prefix, 12k full context.
  const newTurn = routeInput({
    prefixTokens: 11_000, appendedTokens: 1_000, fullTokens: 12_000, pinnedTokens: 3_000,
    keepRatio: undefined, selectorCostUsd: 0.0002,
  });
  // Prior keep ratio 0.64 → R̂ = 7,680; both sides cost about the same: ask Jev.
  const gray = decideRoute(newTurn);
  assert.deepEqual(
    [gray.route, gray.reason, gray.needsContinuity, gray.rebuildTokensEstimated],
    ["rebuild", "gray zone", true, 7_680],
  );
  // Ignoring the rebuild's cache hits (the v1 model) would have forced reuse.
  assert.equal(decideRoute(newTurn, { ...DEFAULT_ROUTING, pHitRebuild: 0 }).reason, "reuse cheaper");
  // A learned low keep ratio makes the smaller context clearly cheaper.
  assert.equal(decideRoute({ ...newTurn, keepRatio: 0.3 }).reason, "rebuild cheaper");
});
