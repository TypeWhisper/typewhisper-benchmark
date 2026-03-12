import { calculateWER, calculateCER } from "./wer.js";
import { normalizeText, normalizeCodeText } from "./normalize.js";

export { calculateWER, calculateCER } from "./wer.js";
export { normalizeText, normalizeCodeText } from "./normalize.js";

export interface MetricsInput {
  reference: string;
  hypothesis: string;
  language: string;
  codeReference?: string;
}

export interface MetricsResult {
  werRaw: number;
  werNormalized: number;
  cer: number;
  codeWerNormalized?: number;
  codeCer?: number;
}

export function computeMetrics(input: MetricsInput): MetricsResult {
  const { reference, hypothesis, language, codeReference } = input;

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

  const result: MetricsResult = { werRaw, werNormalized, cer };

  // Code-dictation metrics: compare against code ground truth
  if (codeReference) {
    const normalizedCodeRef = normalizeCodeText(codeReference);
    const normalizedCodeHyp = normalizeCodeText(hypothesis);

    result.codeWerNormalized = calculateWER(normalizedCodeRef, normalizedCodeHyp);
    result.codeCer = calculateCER(normalizedCodeRef, normalizedCodeHyp);
  }

  return result;
}
