"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  formatContext,
  normalizeTranscript,
  type CompilationResult,
  type CompileInput,
} from "@/lib/context";
import { REPLAY_ATTEMPTS, evaluateReplay, type ReplayRun } from "@/lib/context-evaluation";
import { OPEN_CODE_FIXTURE, REPLAY_FIXTURES } from "@/lib/context-fixture";
import { PROVIDER } from "@/lib/providers";
import { useApiKey } from "@/lib/useApiKey";

export function ContextLab() {
  const { apiKey, setApiKey } = useApiKey();
  const [currentRequest, setCurrentRequest] = useState(OPEN_CODE_FIXTURE.currentRequest);
  const [result, setResult] = useState<CompilationResult>();
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [evaluationRuns, setEvaluationRuns] = useState<ReplayRun[]>([]);
  const [evaluationError, setEvaluationError] = useState("");
  const [evaluationRunning, setEvaluationRunning] = useState(false);
  const [agentInputPrice, setAgentInputPrice] = useState(3);
  const chunks = useMemo(
    () =>
      normalizeTranscript(
        OPEN_CODE_FIXTURE.transcript.map((entry) =>
          entry.id === OPEN_CODE_FIXTURE.currentEntryId ? { ...entry, content: currentRequest } : entry,
        ),
        OPEN_CODE_FIXTURE.currentEntryId,
      ),
    [currentRequest],
  );
  const fullContext = formatContext(chunks);
  const before = chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0);
  const after = result?.inputTokensAfter ?? before;
  const savings = before ? Math.round((1 - after / before) * 100) : 0;
  const evaluation = useMemo(
    () => evaluateReplay(REPLAY_FIXTURES, evaluationRuns, agentInputPrice, REPLAY_ATTEMPTS),
    [agentInputPrice, evaluationRuns],
  );

  async function requestCompilation(input: CompileInput) {
    const response = await fetch("/api/context", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-openrouter-api-key": apiKey.trim(),
      },
      body: JSON.stringify(input),
    });
    const body = (await response.json()) as CompilationResult | { error?: string };
    if (!response.ok || !("compiledContext" in body)) {
      throw new Error("error" in body ? body.error : `HTTP ${response.status}`);
    }
    return body;
  }

  async function compile() {
    setRunning(true);
    setError("");
    try {
      setResult(await requestCompilation({
        currentRequest,
        activeGoal: OPEN_CODE_FIXTURE.activeGoal,
        repository: OPEN_CODE_FIXTURE.repository,
        chunks,
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setResult(undefined);
    } finally {
      setRunning(false);
    }
  }

  async function runEvaluation() {
    setEvaluationRunning(true);
    setEvaluationError("");
    setEvaluationRuns([]);
    const completed: ReplayRun[] = [];
    try {
      for (let attempt = 1; attempt <= REPLAY_ATTEMPTS; attempt++) {
        for (const fixture of REPLAY_FIXTURES) {
          const result = await requestCompilation({
            currentRequest: fixture.currentRequest,
            activeGoal: fixture.activeGoal,
            repository: fixture.repository,
            chunks: normalizeTranscript(fixture.transcript, fixture.currentEntryId),
          });
          completed.push({ fixtureId: fixture.id, attempt, result });
          setEvaluationRuns([...completed]);
        }
      }
    } catch (caught) {
      setEvaluationError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setEvaluationRunning(false);
    }
  }

  return (
    <main className="h-screen overflow-y-auto bg-bg">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-bg-elev px-6 py-4">
        <div>
          <div className="text-[13px] uppercase tracking-wider text-accent">Context Lab</div>
          <h1 className="text-xl font-semibold">OpenCode replay compiler</h1>
        </div>
        <Link href="/" className="text-sm text-fg-muted hover:text-fg">
          ← Jev playground
        </Link>
      </header>

      <section className="grid gap-5 border-b border-border px-6 py-5 lg:grid-cols-[1fr_1.6fr_auto]">
        <div>
          <div className="mb-2 text-[13px] uppercase tracking-wider text-fg-dim">Provider</div>
          <div className="rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-accent">
            {PROVIDER.label} · {PROVIDER.model}
          </div>
          <label className="mt-3 block text-[13px] uppercase tracking-wider text-fg-dim" htmlFor="context-api-key">
            API key · browser only
          </label>
          <input
            id="context-api-key"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            autoComplete="off"
            placeholder={PROVIDER.keyPlaceholder}
            className="mt-2 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-border-strong"
          />
        </div>

        <label className="block text-[13px] uppercase tracking-wider text-fg-dim">
          Current request
          <textarea
            value={currentRequest}
            onChange={(event) => {
              setCurrentRequest(event.target.value);
              setResult(undefined);
            }}
            className="mt-2 h-28 w-full resize-y rounded-md border border-border bg-bg p-3 text-sm normal-case leading-relaxed text-fg outline-none focus:border-border-strong"
          />
        </label>

        <div className="flex items-end">
          <button
            type="button"
            onClick={compile}
            disabled={running || !apiKey.trim() || !currentRequest.trim()}
            className="rounded-md border border-accent bg-accent px-5 py-2.5 text-sm font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? "Compiling…" : "Compile context"}
          </button>
        </div>
      </section>

      <section className="grid gap-px bg-border xl:grid-cols-2">
        <ContextPanel title="Full context" subtitle={`${before} estimated tokens`} value={fullContext} />
        <ContextPanel
          title="Compiled context"
          subtitle={result ? `${after} estimated tokens · ${savings}% smaller` : "Run the selector to compare"}
          value={result?.compiledContext ?? "No compilation yet."}
        />
      </section>

      <section className="border-t border-border px-6 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Selection trace</h2>
            <p className="text-sm text-fg-muted">
              Tool calls and results are one chunk. Pins and dependencies are deterministic; Jev only scores semantic candidates.
            </p>
          </div>
          {result && (
            <div className="text-sm text-fg-dim">
              {result.selectorLatencyMs} ms · {result.keptChunkIds.length} kept · {result.droppedChunkIds.length} dropped
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-bad/40 bg-bad-soft px-4 py-3 text-sm text-bad">
            {error} Full context remains unchanged.
          </div>
        )}
        {result?.fallbackReason && (
          <div className="mb-4 rounded-md border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
            {result.fallbackReason} Fail-safe kept every chunk.
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {chunks.map((chunk) => {
            const decision = result?.decisions.find((item) => item.id === chunk.id);
            const kept = decision?.kept ?? true;
            return (
              <article key={chunk.id} className="rounded-md border border-border bg-bg-panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{chunk.id}</div>
                    <div className="mt-0.5 text-[12px] uppercase text-fg-dim">
                      {chunk.kind} · turn {chunk.turn} · ~{chunk.tokenEstimate} tokens
                    </div>
                  </div>
                  <span className={`rounded border px-2 py-0.5 text-[12px] ${
                    kept ? "border-ok/40 bg-ok-soft text-ok" : "border-bad/40 bg-bad-soft text-bad"
                  }`}>
                    {kept ? "keep" : "drop"}
                  </span>
                </div>
                <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-fg-muted">{chunk.content}</p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-fg-dim">
                  <span>{decision?.reason ?? chunk.pinReason ?? "awaiting selector"}</span>
                  {decision?.relevance !== undefined && <span>relevance {decision.relevance.toFixed(2)}</span>}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="border-t border-border px-6 py-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[13px] uppercase tracking-wider text-accent">Phase 2</div>
            <h2 className="text-lg font-semibold">Replay evaluation</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Six calibration and four holdout scenarios run five times each for a meaningful latency distribution.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[12px] uppercase text-fg-dim">
              Agent input $ / 1M tokens
              <input
                type="number"
                min="0"
                step="0.1"
                value={agentInputPrice}
                onChange={(event) => setAgentInputPrice(Math.max(0, Number(event.target.value) || 0))}
                className="mt-1 block w-32 rounded-md border border-border bg-bg px-3 py-2 text-sm normal-case text-fg outline-none focus:border-border-strong"
              />
            </label>
            <button
              type="button"
              onClick={runEvaluation}
              disabled={evaluationRunning || !apiKey.trim()}
              className="rounded-md border border-accent bg-accent px-5 py-2.5 text-sm font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-40"
            >
              {evaluationRunning
                ? `Running ${evaluationRuns.length}/${REPLAY_FIXTURES.length * REPLAY_ATTEMPTS}…`
                : `Run ${REPLAY_FIXTURES.length * REPLAY_ATTEMPTS} replays`}
            </button>
          </div>
        </div>

        {evaluationError && (
          <div className="mt-4 rounded-md border border-bad/40 bg-bad-soft px-4 py-3 text-sm text-bad">
            {evaluationError} Completed runs remain visible.
          </div>
        )}

        {evaluationRuns.length > 0 && (
          <>
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard title="Full baseline" metrics={evaluation.baseline} />
              <MetricCard title="Deterministic prefilter" metrics={evaluation.prefilter} />
              <MetricCard title="Jev pipeline" metrics={evaluation.jev} />
              <MetricCard title="Holdout validation" metrics={evaluation.holdout} />
            </div>

            <div className={`mt-4 rounded-md border px-4 py-3 text-sm ${
              evaluation.decision === "go"
                ? "border-ok/40 bg-ok-soft text-ok"
                : evaluation.decision === "no-go"
                  ? "border-bad/40 bg-bad-soft text-bad"
                  : "border-warn/40 bg-warn-soft text-warn"
            }`}>
              <div className="font-semibold uppercase">{evaluation.decision}</div>
              <div className="mt-1">
                relevance threshold {evaluation.thresholds.relevance.toFixed(2)}
                {` · ${evaluation.runCount} runs · p50 ${evaluation.selectorLatencyP50Ms} ms · p95 ${evaluation.selectorLatencyP95Ms} ms · selector ${formatUsd(evaluation.selectorCostUsd)} · estimated net ${formatUsd(evaluation.netSavingsUsd)}`}
              </div>
              {evaluation.reasons.length > 0 && <div className="mt-1">{evaluation.reasons.join(" ")}</div>}
            </div>

            <div className="mt-4 overflow-x-auto rounded-md border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-bg-elev text-[12px] uppercase text-fg-dim">
                  <tr>
                    <th className="px-3 py-2">Fixture</th>
                    <th className="px-3 py-2">Set</th>
                    <th className="px-3 py-2">Runs</th>
                    <th className="px-3 py-2">Full</th>
                    <th className="px-3 py-2">Prefilter</th>
                    <th className="px-3 py-2">Jev</th>
                    <th className="px-3 py-2">Must-keep</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluation.fixtures.map((fixture) => (
                    <tr key={fixture.fixtureId} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{fixture.title}</td>
                      <td className="px-3 py-2 text-fg-muted">{fixture.set}</td>
                      <td className="px-3 py-2 text-fg-muted">{fixture.runs}</td>
                      <td className="px-3 py-2 text-fg-muted">{percent(fixture.baselineReduction)}</td>
                      <td className="px-3 py-2 text-fg-muted">{percent(fixture.prefilterReduction)}</td>
                      <td className="px-3 py-2 text-fg-muted">{percent(fixture.jevReduction)}</td>
                      <td className="px-3 py-2 text-fg-muted">{percent(fixture.mustKeepRecall)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function MetricCard({ title, metrics }: { title: string; metrics: ReturnType<typeof evaluateReplay>["jev"] }) {
  return (
    <article className="rounded-md border border-border bg-bg-panel p-4">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-2 text-2xl font-semibold">{percent(metrics.medianReduction)}</div>
      <div className="mt-1 text-[12px] text-fg-dim">
        median reduction · {percent(metrics.mustKeepRecall)} recall · {percent(metrics.precision)} precision
      </div>
    </article>
  );
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatUsd(value?: number) {
  return value === undefined ? "unknown" : `$${value.toFixed(6)}`;
}

function ContextPanel({ title, subtitle, value }: { title: string; subtitle: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }
  return (
    <article className="min-w-0 bg-bg px-6 py-5">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <div className="text-[13px] text-fg-dim">{subtitle}</div>
        </div>
        <button type="button" onClick={copy} className="text-[13px] text-fg-dim hover:text-fg">
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="h-[420px] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg-elev p-4 text-[13px] leading-relaxed text-fg-muted">
        {value}
      </pre>
    </article>
  );
}
