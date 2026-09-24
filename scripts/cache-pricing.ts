import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PricingFile } from "../src/lib/cache-routing.ts";

// Reads only the public models.dev catalog from OpenCode's local database and
// writes per-model cache prices for the jev-context plugin. Read-only access;
// no account, credential or transcript tables are touched.
const dbPath = argument("db") ?? join(homedir(), ".local", "share", "opencode", "opencode.db");
const outPath = argument("out") ?? join(import.meta.dirname, "..", ".opencode", "jev-pricing.json");

type CatalogModel = {
  cost?: { input?: number; cache_read?: number; cache_write?: number };
  limit?: { context?: number };
};

const db = new DatabaseSync(dbPath, { readOnly: true });
const row = db.prepare("SELECT value FROM kv WHERE key = 'models-dev:catalog'").get() as
  | { value: string }
  | undefined;
db.close();
if (!row) throw new Error("models-dev:catalog is missing from the OpenCode database");

const catalog = JSON.parse(row.value) as { updatedAt?: number; body: string | Record<string, unknown> };
const providers = (typeof catalog.body === "string" ? JSON.parse(catalog.body) : catalog.body) as Record<
  string,
  { models?: Record<string, CatalogModel> }
>;

const models: PricingFile["models"] = {};
for (const [providerID, provider] of Object.entries(providers)) {
  for (const [modelID, model] of Object.entries(provider.models ?? {})) {
    const { input, cache_read: cacheRead, cache_write: cacheWrite } = model.cost ?? {};
    const context = model.limit?.context;
    if (![input, cacheRead, context].every((value) => typeof value === "number" && Number.isFinite(value))) {
      continue;
    }
    models[`${providerID}/${modelID}`] = {
      inputPerM: input,
      cacheReadPerM: cacheRead,
      ...(typeof cacheWrite === "number" ? { cacheWritePerM: cacheWrite } : {}),
      contextLimit: context,
    };
  }
}

const file: PricingFile = {
  updatedAt: new Date(catalog.updatedAt ?? Date.now()).toISOString(),
  models,
};
writeFileSync(outPath, `${JSON.stringify(file)}\n`);

const target = argument("check") ?? "opencode-go/glm-5.3-flash";
console.log(JSON.stringify({
  out: outPath,
  catalogUpdatedAt: file.updatedAt,
  models: Object.keys(models).length,
  [target]: models[target] ?? null,
}, null, 2));

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}
