import { NextRequest, NextResponse } from "next/server";
import { forwardJev } from "@/lib/jev-server";

// The OpenRouter key is passed per request and is never stored on the server.
export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-openrouter-api-key");
  if (!apiKey) {
    return NextResponse.json({ error: "Missing API key" }, { status: 400 });
  }
  const payload = await req.json();
  return NextResponse.json(await forwardJev(apiKey, payload));
}
