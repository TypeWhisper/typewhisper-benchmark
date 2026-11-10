import { useEffect, useState } from "react";
import { DATA_BASE, type Loadable } from "./load";

/** Mirrors bench/src/diarization/types.ts, as build-data.mjs keeps it. */
export type DiarizationPlatform = "macos" | "windows" | "ios";
export type DiarizationGroup = "ami-array" | "ami-headset" | "synthetic";
export type DiarizationReferenceId = "only-words" | "forced-alignment" | "exact";

export interface DiarizationScore {
  total: number;
  missed: number;
  falseAlarm: number;
  confusion: number;
  der: number;
}

export interface DiarizationScores {
  collar0: DiarizationScore;
  collar25: DiarizationScore;
}

export interface DiarizationGroupSummary {
  files: number;
  failed: number;
  audioSeconds: number;
  scores: Partial<Record<DiarizationReferenceId, DiarizationScores>>;
  speakerCountAccuracy: number;
  speedFactor: number;
}

export interface DiarizationItem {
  id: string;
  group: DiarizationGroup;
  language: string;
  audioSeconds: number;
  processingMs: number;
  speakers: { reference: number; found: number };
  scores: Partial<Record<DiarizationReferenceId, DiarizationScores>>;
  error?: string;
}

export interface DiarizationEntry {
  /** `<platform>:<engineId>` */
  id: string;
  platform: DiarizationPlatform;
  engineId: string;
  engineName: string;
  runtime: string;
  model: string;
  shipped: boolean;
  settings: Record<string, string | number | boolean | null>;
  machine: { model: string; chip: string; memoryGb: number; os: string; accelerator?: string };
  measuredAt: string;
  prepareMs: number;
  setId: string;
  summary: Record<DiarizationGroup, DiarizationGroupSummary>;
  items: DiarizationItem[];
}

export interface DiarizationData {
  schema: number;
  version: string;
  reports: DiarizationEntry[];
}

export const PLATFORM_NAMES: Record<DiarizationPlatform, string> = { macos: "macOS", windows: "Windows", ios: "iOS" };

export const GROUP_INFO: Record<DiarizationGroup, { name: string; short: string; about: string }> = {
  "ami-array": {
    name: "AMI meetings, table microphone",
    short: "Table mic",
    about: "16 AMI test meetings (9 h) recorded by one microphone of the array on the table: far field, people talk over each other. Closest to a phone or laptop lying on a meeting table.",
  },
  "ami-headset": {
    name: "AMI meetings, headsets",
    short: "Headsets",
    about: "The same 16 meetings from the mixed close-talk headsets: clean audio, the same overlap. Most published AMI numbers use this mix.",
  },
  synthetic: {
    name: "Synthetic conversations",
    short: "Synthetic",
    about: "22 conversations from VoxPopuli parliament speech in German, English, French, Spanish, Italian and German/English, 2 to 6 speakers, 1 to 8 minutes, no overlap. Tests speaker counts and languages.",
  },
};

export const REFERENCE_INFO: Record<DiarizationReferenceId, { name: string; about: string }> = {
  "only-words": {
    name: "pyannote only_words",
    about: "Manual word annotation; short pauses inside a turn count as speech. pyannote-based engines are trained on this convention.",
  },
  "forced-alignment": {
    name: "Forced alignment",
    about: "NTT's Montreal Forced Aligner labels with tight word boundaries; the protocol of NVIDIA's Nemotron model card.",
  },
  exact: { name: "Exact", about: "Utterance boundaries of the concatenated recordings." },
};

let promise: Promise<DiarizationData> | null = null;

export function loadDiarization(): Promise<DiarizationData> {
  promise ??= fetch(`${DATA_BASE}generated/diarization.json?v=${__DATA_VERSION__}`).then(async (response) => {
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return (await response.json()) as DiarizationData;
  });
  promise.catch(() => {
    promise = null;
  });
  return promise;
}

export function useDiarization(): Loadable<DiarizationData> {
  const [state, setState] = useState<Loadable<DiarizationData>>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    loadDiarization().then(
      (data) => !cancelled && setState({ status: "ready", data }),
      (error: unknown) => !cancelled && setState({ status: "error", error: String(error) })
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/** The reference a group is scored against: AMI uses the chosen one, synthetic its exact one. */
export function referenceFor(group: DiarizationGroup, amiReference: DiarizationReferenceId): DiarizationReferenceId {
  return group === "synthetic" ? "exact" : amiReference;
}

/** Entries ranked by DER (collar 0) on a group; entries without that group are left out. */
export function rankEntries(entries: DiarizationEntry[], group: DiarizationGroup, reference: DiarizationReferenceId) {
  return entries
    .filter((entry) => entry.summary[group]?.files && entry.summary[group].scores[reference])
    .sort((a, b) => a.summary[group].scores[reference]!.collar0.der - b.summary[group].scores[reference]!.collar0.der);
}

export function share(part: number, total: number): number | null {
  return total > 0 ? part / total : null;
}

export function percent(value: number | null | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? "–" : `${(value * 100).toFixed(digits)}%`;
}
