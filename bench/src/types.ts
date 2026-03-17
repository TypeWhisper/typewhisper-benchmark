// === Provider Types ===

export type ProviderType = "cloud" | "local" | "system";
export type BenchmarkTier = "core" | "diagnostic";
export type BenchmarkOrigin = "public" | "synthetic";
export type ResultStatus = "ok" | "error" | "skipped";

export interface TestCaseMetadata {
  speaker?: string;
  noiseType?: string;
  snrDb?: number;
  wordsPerMinute?: number;
  accent?: string;
  degradationType?: string;
  numberType?:
    | "cardinal"
    | "ordinal"
    | "date"
    | "time"
    | "phone"
    | "currency"
    | "percentage"
    | "mixed";
}

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
  supportsLanguage(model: string, language: string): boolean;
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
  | "low-quality-audio"
  | "code-switching"
  | "punctuation-formatting"
  | "number-formatting"
  | "long-form-speech";

export interface TestCase {
  id: string;
  audioFile: string;
  groundTruth: string;
  normalizedTruth?: string;
  codeGroundTruth?: string;
  tags: string[];
  source:
    | "custom"
    | "librispeech"
    | "common-voice"
    | "fleurs"
    | "recorded"
    | "voxpopuli";
  metadata?: TestCaseMetadata;
  alternativeGroundTruths?: string[];
  formattedGroundTruth?: string;
}

export interface TestSuite {
  id: string;
  name: string;
  description: string;
  language: string;
  category: TestCategory;
  benchmarkTier?: BenchmarkTier;
  tests: TestCase[];
}

export interface SuiteMetadata {
  name: string;
  description: string;
  language: string;
  category: TestCategory;
  tier: BenchmarkTier;
  origin: BenchmarkOrigin;
  testCount: number;
}

// === Result Types ===

export interface TestResult {
  testId: string;
  suiteId: string;
  providerId: string;
  model: string;
  run: number;
  suiteCategory: TestCategory;
  suiteLanguage: string;
  testTags: string[];
  testSource: TestCase["source"];
  testMetadata?: TestCaseMetadata;
  status: ResultStatus;

  // Raw
  transcription: string;

  // Accuracy
  werRaw: number;
  werNormalized: number;
  cer: number;
  codeWerNormalized?: number;
  codeCer?: number;
  punctuationScore?: number;
  formattingScore?: number;
  bestAlternativeWer?: number;
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
  skipReason?: string;
}

export interface ModelRanking {
  providerId: string;
  model: string;
  providerType: ProviderType;

  // Accuracy (averages)
  avgWerNormalized: number;
  avgCer: number;
  avgSemanticScore?: number;
  avgPunctuationScore?: number;
  avgFormattingScore?: number;

  // Speed
  avgRealtimeFactor: number;
  avgDurationMs: number;

  // Cost
  costPerHourAudio?: number;

  // Counts
  totalTests: number;
  errorCount: number;
  errorRate: number;
  skipCount: number;
}

export interface BenchmarkSummary {
  rankings: ModelRanking[];
  suiteMetadata: Record<string, SuiteMetadata>;
  rankingsBySuite: Record<string, ModelRanking[]>;
  rankingsByCategory: Record<string, ModelRanking[]>;
  rankingsBySlice: Record<string, ModelRanking[]>;
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
