import type {
  AdapterDefinition,
  JsonValue,
  TargetDefinition,
} from "./schema.js";

export interface AdapterAvailability {
  available: boolean;
  reason?: string;
  runtimeVersions: Record<string, string>;
}

export interface TranscriptionRequest {
  audioPath: string;
  language: string;
  target: TargetDefinition;
}

export interface TranscriptionResponse {
  transcript: string;
  durationMs: number;
  firstTokenMs?: number;
  metadata?: Record<string, JsonValue>;
}

export interface BenchmarkAdapter {
  readonly definition: AdapterDefinition;
  checkAvailability(): Promise<AdapterAvailability>;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse>;
}
