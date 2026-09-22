import "server-only";

import { PROVIDER } from "./providers";
import type { JevRequest, ProxyResult } from "./types";

export async function forwardJev(
  apiKey: string,
  payload: JevRequest,
): Promise<ProxyResult> {
  const started = performance.now();
  let upstream: Response;
  try {
    upstream = await fetch(PROVIDER.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Math.round(performance.now() - started),
      requestId: null,
      body: `Network error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const text = await upstream.text();
  let body: ProxyResult["body"];
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  const responseId =
    typeof body === "object" && body && "id" in body && typeof body.id === "string"
      ? body.id
      : null;
  return {
    ok: upstream.ok,
    status: upstream.status,
    latencyMs: Math.round(performance.now() - started),
    requestId: responseId,
    body,
  };
}
