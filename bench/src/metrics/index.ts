import { calculateWER, calculateCER } from "./wer.js";
import { normalizeText } from "./normalize.js";

export { calculateWER, calculateCER } from "./wer.js";
export { normalizeText } from "./normalize.js";

export interface MetricsInput {
  reference: string;
  hypothesis: string;
  language: string;
}

export interface MetricsResult {
  werRaw: number;
  werNormalized: number;
  cer: number;
}

export function computeMetrics(input: MetricsInput): MetricsResult {
  const { reference, hypothesis, language } = input;

  // Raw WER: just lowercase, no other normalization
  const werRaw = calculateWER(
    reference.toLowerCase(),
    hypothesis.toLowerCase()
  );

  // Normalized: full normalization pipeline
  const normalizedRef = normalizeText(reference, language);
  const normalizedHyp = normalizeText(hypothesis, language);

  const werNormalized = calculateWER(normalizedRef, normalizedHyp);
  const cer = calculateCER(normalizedRef, normalizedHyp);

  return { werRaw, werNormalized, cer };
}
