import { normalizeText } from "./normalize.js";

/**
 * Share of a clip's key terms (drug names, diagnoses, anatomy) that the transcript contains.
 *
 * Both sides go through the WER normalization, so case, punctuation and spelled numbers do not
 * matter, and a hyphen counts as a space ("Thorax-CT" matches "Thorax CT"). Otherwise the term's
 * words must appear in the transcript as the same run of whole words: "Biso Prolol" does not count
 * for Bisoprolol, and "Insulinpumpe" does not count for Insulin. A term that occurs twice in a clip
 * counts once. In German, the f and ph spellings Duden lists side by side count as the same
 * ("Sonografie" matches "Sonographie"). Returns undefined when the clip has no key terms.
 */
/** German allows "graf"/"graph" and "fot"/"phot" in the same word; both sides use the f form. */
function foldSpelling(text: string, language: string): string {
  return language === "de" ? text.replace(/graph/g, "graf").replace(/phot/g, "fot") : text;
}

export function calculateTermRecall(
  terms: string[] | undefined,
  hypothesis: string,
  language: string
): number | undefined {
  const unique = [
    ...new Set((terms ?? []).map((term) => foldSpelling(normalizeText(term, language), language)).filter(Boolean)),
  ];
  if (unique.length === 0) return undefined;

  const padded = ` ${foldSpelling(normalizeText(hypothesis, language), language).split(/\s+/).filter(Boolean).join(" ")} `;
  const found = unique.filter((term) => padded.includes(` ${term.split(/\s+/).join(" ")} `));
  return found.length / unique.length;
}
