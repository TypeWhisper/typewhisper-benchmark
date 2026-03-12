// === Provider Types ===

export type ProviderType = "cloud" | "local" | "system";

export interface AudioInput {
  filePath: string;
  format: "wav" | "mp3" | "m4a" | "flac" | "ogg" | "webm";
  sampleRate: number;
  durationSeconds: number;
  language: string; // ISO 639-1: "de", "en", etc.
}

export interface TranscriptionResult {
  text: string;
  durationMs: number;
  cost?: number;
  model: string;
  metadata?: Record<string, unknown>;
}

export interface STTProvider {
  id: string;
  name: string;
  type: ProviderType;
  models: string[];
  transcribe(audio: AudioInput, model: string): Promise<TranscriptionResult>;
  isAvailable(): Promise<boolean>;
}

// === Test Suite Types ===

export type TestCategory =
  | "clean-speech"
  | "noisy-environment"
  | "accented-speech"
  | "fast-speech"
  | "technical-jargon"
  | "code-dictation"
  | "numbers-dates"
  | "proper-nouns"
  | "whispered-speech"
  | "low-quality-audio";

export interface TestCase {
  id: string;
  audioFile: string;
  groundTruth: string;
  normalizedTruth?: string;
  codeGroundTruth?: string;
  tags: string[];
  source: "custom" | "librispeech" | "common-voice" | "fleurs" | "recorded";
  metadata?: {
    speaker?: string;
    noiseType?: string;
    snrDb?: number;
    wordsPerMinute?: number;
    accent?: string;
    degradationType?: string;
  };
}

export interface TestSuite {
  id: string;
  name: string;
  description: string;
  language: string;
  category: TestCategory;
  tests: TestCase[];
}

// === Result Types ===

export interface TestResult {
  testId: string;
  suiteId: string;
  providerId: string;
  model: string;
  run: number;

  // Raw
  transcription: string;

  // Accuracy
  werRaw: number;
  werNormalized: number;
  cer: number;
  codeWerNormalized?: number;
  codeCer?: number;
  semanticScore?: number;

  // Performance
  durationMs: number;
  realtimeFactor: number;
  audioDurationMs: number;

  // Cost
  costUsd?: number;

  // Meta
  timestamp: string;
  error?: string;
}

export interface ModelRanking {
  providerId: string;
  model: string;
  providerType: ProviderType;

  // Accuracy (averages)
  avgWerNormalized: number;
  avgCer: number;
  avgSemanticScore?: number;

  // Speed
  avgRealtimeFactor: number;
  avgDurationMs: number;

  // Cost
  costPerHourAudio?: number;

  // Counts
  totalTests: number;
  errorCount: number;
  errorRate: number;
}

export interface BenchmarkSummary {
  rankings: ModelRanking[];
  metadata: {
    timestamp: string;
    version: string;
    totalModels: number;
    totalTests: number;
    suites: string[];
    languages: string[];
    categories: TestCategory[];
  };
  resultsBySuite: Record<string, TestResult[]>;
}

// === Config Types ===

export interface BenchmarkConfig {
  runsPerModel: number;
  maxConcurrency: number;
  timeoutSeconds: number;
  staggerDelayMs: number;
  outputDirectory: string;
  enableSemanticScoring: boolean;
}

export const DEFAULT_CONFIG: BenchmarkConfig = {
  runsPerModel: 3,
  maxConcurrency: 10,
  timeoutSeconds: 120,
  staggerDelayMs: 200,
  outputDirectory: "./results",
  enableSemanticScoring: false,
};
