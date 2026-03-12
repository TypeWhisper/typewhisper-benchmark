// Text normalization for STT output comparison.
// Transforms transcription text before WER calculation so formatting
// differences don't affect accuracy scores.

// --- Contraction expansion (English) ---

const CONTRACTIONS: Record<string, string> = {
  "i'm": "i am",
  "i've": "i have",
  "i'll": "i will",
  "i'd": "i would",
  "you're": "you are",
  "you've": "you have",
  "you'll": "you will",
  "you'd": "you would",
  "he's": "he is",
  "he'll": "he will",
  "he'd": "he would",
  "she's": "she is",
  "she'll": "she will",
  "she'd": "she would",
  "it's": "it is",
  "it'll": "it will",
  "it'd": "it would",
  "we're": "we are",
  "we've": "we have",
  "we'll": "we will",
  "we'd": "we would",
  "they're": "they are",
  "they've": "they have",
  "they'll": "they will",
  "they'd": "they would",
  "that's": "that is",
  "that'll": "that will",
  "that'd": "that would",
  "who's": "who is",
  "who'll": "who will",
  "who'd": "who would",
  "what's": "what is",
  "what'll": "what will",
  "what'd": "what would",
  "where's": "where is",
  "where'll": "where will",
  "where'd": "where would",
  "when's": "when is",
  "when'll": "when will",
  "when'd": "when would",
  "why's": "why is",
  "why'll": "why will",
  "why'd": "why would",
  "how's": "how is",
  "how'll": "how will",
  "how'd": "how would",
  "there's": "there is",
  "there'll": "there will",
  "there'd": "there would",
  "here's": "here is",
  "isn't": "is not",
  "aren't": "are not",
  "wasn't": "was not",
  "weren't": "were not",
  "hasn't": "has not",
  "haven't": "have not",
  "hadn't": "had not",
  "doesn't": "does not",
  "don't": "do not",
  "didn't": "did not",
  "won't": "will not",
  "wouldn't": "would not",
  "shan't": "shall not",
  "shouldn't": "should not",
  "can't": "cannot",
  "couldn't": "could not",
  "mustn't": "must not",
  "mightn't": "might not",
  "needn't": "need not",
  "let's": "let us",
  "ain't": "is not",
  "o'clock": "of the clock",
  "ma'am": "madam",
};

// --- Filler words ---

const EN_FILLERS = new Set([
  "uh",
  "uhm",
  "um",
  "umm",
  "er",
  "err",
  "ah",
  "ahh",
  "hm",
  "hmm",
  "huh",
  "mhm",
  "mm",
  "mmm",
]);

const DE_FILLERS = new Set([
  "äh",
  "ähm",
  "öh",
  "öhm",
  "hm",
  "hmm",
  "mhm",
  "mm",
  "mmm",
]);

// --- Number to words (English) ---

const EN_ONES = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];

const EN_TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

function numberToEnglish(n: number): string {
  if (n < 0 || n > 999999 || !Number.isInteger(n)) return String(n);
  if (n === 0) return "zero";

  let result = "";

  if (n >= 1000) {
    const thousands = Math.floor(n / 1000);
    result += hundredsToEnglish(thousands) + " thousand";
    n %= 1000;
    if (n > 0) result += " ";
  }

  if (n > 0) {
    result += hundredsToEnglish(n);
  }

  return result;
}

function hundredsToEnglish(n: number): string {
  let result = "";

  if (n >= 100) {
    result += EN_ONES[Math.floor(n / 100)] + " hundred";
    n %= 100;
    if (n > 0) result += " ";
  }

  if (n >= 20) {
    result += EN_TENS[Math.floor(n / 10)];
    const ones = n % 10;
    if (ones > 0) result += " " + EN_ONES[ones];
  } else if (n > 0) {
    result += EN_ONES[n];
  }

  return result;
}

// --- Number to words (German) ---

const DE_ONES = [
  "",
  "ein",
  "zwei",
  "drei",
  "vier",
  "fünf",
  "sechs",
  "sieben",
  "acht",
  "neun",
  "zehn",
  "elf",
  "zwölf",
  "dreizehn",
  "vierzehn",
  "fünfzehn",
  "sechzehn",
  "siebzehn",
  "achtzehn",
  "neunzehn",
];

const DE_TENS = [
  "",
  "",
  "zwanzig",
  "dreißig",
  "vierzig",
  "fünfzig",
  "sechzig",
  "siebzig",
  "achtzig",
  "neunzig",
];

function numberToGerman(n: number): string {
  if (n < 0 || n > 999999 || !Number.isInteger(n)) return String(n);
  if (n === 0) return "null";

  let result = "";

  if (n >= 1000) {
    const thousands = Math.floor(n / 1000);
    result += hundredsToGerman(thousands) + "tausend";
    n %= 1000;
  }

  if (n > 0) {
    result += hundredsToGerman(n);
  }

  return result;
}

function hundredsToGerman(n: number): string {
  let result = "";

  if (n >= 100) {
    const h = Math.floor(n / 100);
    result += DE_ONES[h] + "hundert";
    n %= 100;
  }

  if (n >= 20) {
    const ones = n % 10;
    const tens = Math.floor(n / 10);
    if (ones > 0) {
      result += DE_ONES[ones] + "und" + DE_TENS[tens];
    } else {
      result += DE_TENS[tens];
    }
  } else if (n > 0) {
    result += DE_ONES[n];
  }

  return result;
}

// Use "eins" only when the number is exactly 1 standing alone,
// but inside compounds we keep "ein" (e.g. "einundzwanzig", "eintausend").
// For standalone "1" -> "eins" in German. Actually the task description
// uses "drei" for 3, and standard German reads "1" as "eins" standalone.
// But in compounds it is "ein". Let's handle at the top level.

function numberToWords(n: number, lang: string): string {
  if (lang === "de") {
    if (n === 1) return "eins";
    return numberToGerman(n);
  }
  return numberToEnglish(n);
}

// --- Code text normalization ---

export function normalizeCodeText(text: string): string {
  if (text === "") return "";

  let result = text;

  // Remove filler words (both EN and DE)
  const allFillers = new Set([...EN_FILLERS, ...DE_FILLERS]);
  result = result
    .split(/\s+/)
    .filter((word) => !allFillers.has(word.toLowerCase()))
    .join(" ");

  // Normalize whitespace
  result = result.replace(/\s+/g, " ").trim();

  return result;
}

// --- Main normalization ---

export function normalizeText(text: string, lang: string = "en"): string {
  if (text === "") return "";

  // 1. Lowercase
  let result = text.toLowerCase();

  // 2. Expand English contractions (before punctuation removal so apostrophes are still present)
  if (lang === "en") {
    // Use word-boundary-aware replacement. We match the contraction forms as whole words.
    // The apostrophe variants: ' (standard) and \u2019 (right single quotation mark)
    result = result.replace(
      /\b[a-z]+['\u2019][a-z]+\b/g,
      (match: string) => {
        const normalized = match.replace(/\u2019/g, "'");
        return CONTRACTIONS[normalized] ?? match;
      },
    );
  }

  // 3. Remove punctuation (replace with space) - keep letters, digits, whitespace, and common Unicode letters
  result = result.replace(/[^\p{L}\p{N}\s]/gu, " ");

  // 4. Convert numbers to words
  result = result.replace(/\b\d+\b/g, (match: string) => {
    const n = parseInt(match, 10);
    if (n >= 0 && n <= 999999) {
      return numberToWords(n, lang);
    }
    return match;
  });

  // 5. Remove filler words
  const fillers = lang === "de" ? DE_FILLERS : EN_FILLERS;
  result = result
    .split(/\s+/)
    .filter((word) => !fillers.has(word))
    .join(" ");

  // 6. Normalize whitespace
  result = result.replace(/\s+/g, " ").trim();

  return result;
}
