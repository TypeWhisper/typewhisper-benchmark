/**
 * Formats of the diarization benchmark. Every platform (the Mac runner here, the Windows app's
 * benchmark tool, the iOS XCTest harness) writes the same hypothesis file; scoring happens only
 * here, so all platforms are scored by the same code. See bench/diarization/README.md.
 */
import type { DerComponents } from "./der.js";

export const DIARIZATION_SET_SCHEMA = 1;
export const DIARIZATION_HYPOTHESIS_SCHEMA = 1;
export const DIARIZATION_REPORT_SCHEMA = 1;

export type DiarizationPlatform = "macos" | "windows" | "ios";
export const DIARIZATION_PLATFORMS: DiarizationPlatform[] = ["macos", "windows", "ios"];

/** `ami-array`: the far-field table microphone; `ami-headset`: mixed close-talk headsets. */
export type DiarizationGroup = "ami-array" | "ami-headset" | "synthetic";
export const DIARIZATION_GROUPS: DiarizationGroup[] = ["ami-array", "ami-headset", "synthetic"];

/**
 * Reference conventions. AMI has two: `only-words` (pyannote/BUT AMI-diarization-setup, word
 * intervals from the manual annotation, short pauses inside a turn count as speech) and
 * `forced-alignment` (NTT's Montreal Forced Aligner labels, tight word boundaries; the protocol of
 * NVIDIA's model card). Engines trained on one convention score better on it, so both are kept.
 * The synthetic conversations have one `exact` reference from the utterance boundaries.
 */
export type DiarizationReferenceId = "only-words" | "forced-alignment" | "exact";
export const DIARIZATION_REFERENCES: DiarizationReferenceId[] = ["only-words", "forced-alignment", "exact"];

export interface DiarizationSetItem {
  /** For example `ami/ES2004a/array` or `synthetic/de-4sp-300s`. */
  id: string;
  group: DiarizationGroup;
  /** ISO 639-1 code, or `de-en` for the mixed conversation. */
  language: string;
  /** Path below bench/audio/datasets/diarization. */
  audio: string;
  /** Where the audio comes from; the synthetic files are in the release asset. */
  url: string;
  sha256: string;
  bytes: number;
  /** 16 kHz mono 16-bit PCM WAV. */
  seconds: number;
  /** RTTM paths below bench/diarization/references; the first one is the primary reference. */
  references: Partial<Record<DiarizationReferenceId, string>>;
  /** Scored region; null scores the whole file. */
  uem: string | null;
  speakers: number;
}

export interface DiarizationSet {
  schema: number;
  id: string;
  description: string;
  items: DiarizationSetItem[];
}

export interface DiarizationMachine {
  /** For example `Mac17,16`, `iPhone18,1`, or the Windows system model. */
  model: string;
  chip: string;
  memoryGb: number;
  os: string;
  /** GPU or NPU the runtime used, when it is not the chip itself. */
  accelerator?: string;
}

/** One file of the set as a platform diarized it. */
export interface DiarizationHypothesisItem {
  id: string;
  /** Turns as [start seconds, end seconds, speaker label]. */
  turns: [number, number, string][];
  /** Wall-clock time from handing over the audio file to getting the turns back. */
  processingMs: number;
  /** Peak resident memory of the process during this file, if the platform can measure it. */
  peakMemoryMb?: number;
  /** Set instead of turns when the file failed. */
  error?: string;
}

/** What a platform hands over: one engine configuration over the whole set. */
export interface DiarizationHypothesisFile {
  schema: number;
  setId: string;
  platform: DiarizationPlatform;
  /** Short id, unique per platform, used in file names: `fluidaudio-offline-0.7`. */
  engineId: string;
  /** Display name: `Nemotron 3 Diarization (offline preset)`. */
  engineName: string;
  /** Runtime and version: `FluidAudio 0.18.0`, `sherpa-onnx 2.0.1`. */
  runtime: string;
  /** Model checkpoint or download it used. */
  model: string;
  /** Whether a TypeWhisper app ships this engine today. */
  shipped: boolean;
  /** Free-form settings that change results: thresholds, presets, compute units. */
  settings: Record<string, string | number | boolean | null>;
  machine: DiarizationMachine;
  measuredAt: string;
  /** Model load (and compile) time before the first file, without downloads. */
  prepareMs: number;
  items: DiarizationHypothesisItem[];
}

export interface DiarizationScore extends DerComponents {
  der: number;
}

/** DER without a collar and with 0.25 s on each side of every reference boundary. */
export interface DiarizationScores {
  collar0: DiarizationScore;
  collar25: DiarizationScore;
}

export interface DiarizationItemReport {
  id: string;
  group: DiarizationGroup;
  language: string;
  audioSeconds: number;
  processingMs: number;
  peakMemoryMb: number | null;
  /** Reference speakers counted in the primary reference. */
  speakers: { reference: number; found: number };
  scores: Partial<Record<DiarizationReferenceId, DiarizationScores>>;
  error?: string;
}

export interface DiarizationGroupSummary {
  files: number;
  failed: number;
  audioSeconds: number;
  /** Pooled over the group's files: summed error time over summed reference speech. */
  scores: Partial<Record<DiarizationReferenceId, DiarizationScores>>;
  /** Share of files whose speaker count is exactly right. */
  speakerCountAccuracy: number;
  /** Audio seconds per second of processing. */
  speedFactor: number;
}

export interface DiarizationReport {
  schema: number;
  setId: string;
  platform: DiarizationPlatform;
  engineId: string;
  engineName: string;
  runtime: string;
  model: string;
  shipped: boolean;
  settings: DiarizationHypothesisFile["settings"];
  machine: DiarizationMachine;
  measuredAt: string;
  prepareMs: number;
  scoring: { overlap: "included"; collars: [0, 0.25]; references: DiarizationReferenceId[] };
  summary: Record<DiarizationGroup, DiarizationGroupSummary>;
  items: DiarizationItemReport[];
}
