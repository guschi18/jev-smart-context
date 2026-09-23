import { createHash } from "node:crypto";
import type { Answer } from "./types";

// Reuses Jev answers for byte-identical questions. The key covers the model,
// the whole request state (current request included) and the full question,
// so an answer is only reused while the user request and the candidate stay
// unchanged — e.g. across the tool steps of one agent turn.
const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 5_000;

type Entry = { answer: Answer; expires: number };
type SelectorRequest = { model: string; state: unknown; questions: Record<string, unknown> };

export class SelectorAnswerCache {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private key(scope: string, request: SelectorRequest, question: unknown) {
    return createHash("sha256")
      .update(JSON.stringify([scope, request.model, request.state, question]))
      .digest("hex");
  }

  /** Splits a request into cached answers and the questions still to ask. */
  lookup(scope: string, request: SelectorRequest) {
    const cached: Record<string, Answer> = {};
    const missing: Record<string, unknown> = {};
    for (const [id, question] of Object.entries(request.questions)) {
      const key = this.key(scope, request, question);
      const entry = this.entries.get(key);
      if (entry && entry.expires > this.now()) {
        cached[id] = entry.answer;
      } else {
        if (entry) this.entries.delete(key);
        missing[id] = question;
      }
    }
    return { cached, missing };
  }

  store(scope: string, request: SelectorRequest, answers: Record<string, Answer>) {
    for (const [id, question] of Object.entries(request.questions)) {
      const answer = answers[id];
      if (!answer) continue;
      const key = this.key(scope, request, question);
      this.entries.delete(key);
      this.entries.set(key, { answer, expires: this.now() + TTL_MS });
    }
    while (this.entries.size > MAX_ENTRIES) {
      this.entries.delete(this.entries.keys().next().value!);
    }
  }
}
