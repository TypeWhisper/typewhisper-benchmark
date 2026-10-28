import { useEffect, useState } from "react";
import type { ClipFile, Summary } from "./types";

/** Respects Vite's base path (/typewhisper-benchmark/ on GitHub Pages). */
export const DATA_BASE = `${import.meta.env.BASE_URL}data/`;

export const RESULTS_BASE = `${DATA_BASE}results/`;

export type Loadable<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: T };

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

let summaryPromise: Promise<Summary> | null = null;

export function loadSummary(): Promise<Summary> {
  // The build-time version busts GitHub Pages' cache after every deploy.
  summaryPromise ??= fetchJson<Summary>(`${DATA_BASE}generated/summary.json?v=${__DATA_VERSION__}`);
  summaryPromise.catch(() => {
    summaryPromise = null;
  });
  return summaryPromise;
}

const clipCache = new Map<string, Promise<ClipFile>>();

export function loadClips(suiteId: string, version: string): Promise<ClipFile> {
  const key = `${suiteId}@${version}`;
  let promise = clipCache.get(key);
  if (!promise) {
    promise = fetchJson<ClipFile>(`${DATA_BASE}generated/clips/${encodeURIComponent(suiteId)}.json?v=${version}`);
    promise.catch(() => clipCache.delete(key));
    clipCache.set(key, promise);
  }
  return promise;
}

export function useSummary(attempt: number): Loadable<Summary> {
  const [state, setState] = useState<Loadable<Summary>>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    loadSummary().then(
      (data) => !cancelled && setState({ status: "ready", data }),
      (error: unknown) => !cancelled && setState({ status: "error", error: String(error) })
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  return state;
}

/** Per-suite transcripts, fetched on first use and kept for the session. */
export function useClips(suiteId: string | null, version: string): Loadable<ClipFile> | null {
  const [state, setState] = useState<{ key: string; value: Loadable<ClipFile> } | null>(null);
  const key = suiteId ? `${suiteId}@${version}` : null;
  useEffect(() => {
    if (!suiteId || !key) return;
    let cancelled = false;
    loadClips(suiteId, version).then(
      (data) => !cancelled && setState({ key, value: { status: "ready", data } }),
      (error: unknown) => !cancelled && setState({ key, value: { status: "error", error: String(error) } })
    );
    return () => {
      cancelled = true;
    };
  }, [suiteId, version, key]);
  if (!key) return null;
  return state?.key === key ? state.value : { status: "loading" };
}
