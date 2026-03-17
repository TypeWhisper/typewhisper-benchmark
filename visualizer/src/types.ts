export type ProviderType = "cloud" | "local" | "system";
export type BenchmarkTier = "core" | "diagnostic";
export type BenchmarkOrigin = "public" | "synthetic";
export type ResultStatus = "ok" | "error" | "skipped";

export interface ModelRanking {
  providerId: string;
  model: string;
  providerType: ProviderType;
  avgWerNormalized: number;
  avgCer: number;
  avgSemanticScore?: number;
  avgPunctuationScore?: number;
  avgFormattingScore?: number;
  avgRealtimeFactor: number;
  avgDurationMs: number;
  costPerHourAudio?: number;
  totalTests: number;
  errorCount: number;
  errorRate: number;
  skipCount: number;
}

export interface SuiteMetadata {
  name: string;
  description: string;
  language: string;
  category: string;
  tier: BenchmarkTier;
  origin: BenchmarkOrigin;
  testCount: number;
}

export interface TestResult {
  testId: string;
  suiteId: string;
  providerId: string;
  model: string;
  run: number;
  suiteCategory: string;
  suiteLanguage: string;
  testTags: string[];
  testSource: string;
  status: ResultStatus;
  transcription: string;
  werRaw: number;
  werNormalized: number;
  cer: number;
  codeWerNormalized?: number;
  codeCer?: number;
  punctuationScore?: number;
  formattingScore?: number;
  bestAlternativeWer?: number;
  durationMs: number;
  realtimeFactor: number;
  audioDurationMs: number;
  costUsd?: number;
  timestamp: string;
  error?: string;
  skipReason?: string;
}

export interface BenchmarkSummary {
  rankings: ModelRanking[];
  suiteMetadata?: Record<string, SuiteMetadata>;
  rankingsBySuite?: Record<string, ModelRanking[]>;
  rankingsByCategory?: Record<string, ModelRanking[]>;
  rankingsBySlice?: Record<string, ModelRanking[]>;
  metadata: {
    timestamp: string;
    version: string;
    totalModels: number;
    totalTests: number;
    suites: string[];
    languages: string[];
    categories: string[];
  };
  resultsBySuite: Record<string, TestResult[]>;
}
