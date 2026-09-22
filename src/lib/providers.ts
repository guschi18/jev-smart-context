/** OpenRouter's alpha Decisions API speaks Jev's native request/response shape. */
export const PROVIDER = {
  label: "OpenRouter",
  url: "https://openrouter.ai/api/alpha/decisions",
  model: "typesafe/jev-1.13",
  keysUrl: "https://openrouter.ai/settings/keys",
  keyPlaceholder: "OpenRouter API key",
  docsUrl:
    "https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request",
} as const;
