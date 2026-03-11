export type ProviderType = "cloud" | "local" | "system";

export interface ModelRanking {
  providerId: string;
  model: string;
  providerType: ProviderType;
  avgWerNormalized: number;
  avgCer: number;
  avgSemanticScore?: number;
  avgRealtimeFactor: number;
  avgDurationMs: number;
  costPerHourAudio?: number;
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
    categories: string[];
  };
  resultsBySuite: Record<string, unknown[]>;
}
