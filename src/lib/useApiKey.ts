"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "jev-explained:openrouter-api-key";
const SETTINGS_KEY = "jev-explained:settings";
const LEGACY_KEY = "jev-explained:api-key";
const listeners = new Set<() => void>();

let cache: string | null = null;

function read() {
  if (cache !== null) return cache;
  try {
    const existing = localStorage.getItem(KEY);
    if (existing !== null) return (cache = existing);
    const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as {
      provider?: string;
      keys?: Record<string, string>;
    };
    cache =
      settings.keys?.openrouter ??
      (settings.provider ? settings.keys?.[settings.provider] : undefined) ??
      localStorage.getItem(LEGACY_KEY) ??
      "";
    if (cache) localStorage.setItem(KEY, cache);
  } catch {
    cache = "";
  }
  return cache;
}

function write(next: string) {
  cache = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {}
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = () => {
    cache = null;
    cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** OpenRouter key persisted in localStorage. Server snapshot is empty so hydration matches. */
export function useApiKey() {
  const apiKey = useSyncExternalStore(subscribe, read, () => "");
  const setApiKey = useCallback((key: string) => write(key), []);
  return { apiKey, setApiKey };
}
