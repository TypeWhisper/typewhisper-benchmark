/** Shapes of the files scripts/build-data.mjs writes to public/data/generated/. */

export type SuiteTier = "core" | "diagnostic";
export type SuiteOrigin = "public" | "synthetic";

export interface SuiteInfo {
  name: string;
  description: string;
  language: string;
  category: string;
  tier: SuiteTier;
  origin: SuiteOrigin;
  /** Clips in the suite definition. */
  clips: number;
  /** Optional scores some suites produce: p = punctuation, f = formatting, dg = Digits. */
  scores: Array<"p" | "f" | "dg">;
  /** True when bench/tests has the references, so transcripts can be shown next to them. */
  references: boolean;
}

export interface ModelRun {
  provider: string;
  model: string;
  type: "local" | "cloud" | "system";
  /** Result file name under public/data/results/. */
  file: string;
  /** Runs per clip (1 or 3). */
  runs: number;
  lastRun?: string;
}

/** One model on one suite. Means are over ok clips; each has its own count. */
export interface Cell {
  n: number;
  ok: number;
  err?: number;
  skip?: number;
  wer?: number;
  cer?: number;
  ms?: number;
  rtf?: number;
  /** Mean audio seconds per ok clip. */
  sec?: number;
  /** Total API cost of the ok clips, USD. */
  usd?: number;
  p?: number;
  pn?: number;
  f?: number;
  fn?: number;
  dg?: number;
  dn?: number;
}

export interface Summary {
  schema: number;
  version: string;
  generatedAt: string;
  suites: Record<string, SuiteInfo>;
  models: Record<string, ModelRun>;
  cells: Record<string, Record<string, Cell>>;
}

export const ClipStatus = { Ok: 0, Error: 1, Skipped: 2 } as const;
export type ClipStatus = (typeof ClipStatus)[keyof typeof ClipStatus];

/** [transcript (or error text), WER, CER, ms, status, punctuation?, formatting?] */
export type ClipResult = [string, number, number, number, ClipStatus, (number | null)?, (number | null)?];

export interface ClipInfo {
  id: string;
  ref?: string;
  /** Formatted reference (case, punctuation, digits), when it differs from `ref`. */
  fref?: string;
  tags?: string[];
  sec?: number;
}

export interface ClipFile {
  suite: string;
  clips: ClipInfo[];
  /** Per model, one entry per clip in `clips` order; null when the model has no result. */
  results: Record<string, Array<ClipResult | null>>;
}
