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
import { SelectorAnswerCache } from "./selector-cache.ts";
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
