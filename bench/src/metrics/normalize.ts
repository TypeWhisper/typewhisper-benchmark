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

// Hesitations only; "ну" and "вот" are real words and stay.
const RU_FILLERS = new Set(["э", "ээ", "эээ", "эм", "мм", "ммм", "хм"]);

// Hesitations only, as for Russian: discourse words such as "bah", "pues", "allora" or "então"
// are real words and stay.
const FR_FILLERS = new Set(["euh", "euhm", "heu", "hum", "hm", "hmm", "mm", "mmm"]);
const ES_FILLERS = new Set(["eh", "ehm", "em", "mm", "mmm", "hm", "hmm"]);
const IT_FILLERS = new Set(["eh", "ehm", "ehmm", "uhm", "mm", "mmm", "hm", "hmm"]);
const PT_FILLERS = new Set(["hã", "ãh", "ahn", "hum", "eh", "mm", "mmm", "hm", "hmm"]);
const NL_FILLERS = new Set(["eh", "ehm", "euh", "uh", "uhm", "hm", "hmm", "mm", "mmm"]);

const FILLERS: Record<string, Set<string>> = {
  de: DE_FILLERS,
  ru: RU_FILLERS,
  fr: FR_FILLERS,
  es: ES_FILLERS,
  it: IT_FILLERS,
  pt: PT_FILLERS,
  nl: NL_FILLERS,
};

function fillersFor(lang: string): Set<string> {
  return FILLERS[lang] ?? EN_FILLERS;
}

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

// --- Number to words (French, Spanish, Italian) ---
// Hyphens become spaces later, so "vingt-quatre" and "vingt quatre" compare equal.

const FR_UNITS = [
  "zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf",
  "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize",
];
const FR_TENS = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];

function belowHundredToFrench(n: number, final: boolean): string {
  if (n < 17) return FR_UNITS[n];
  if (n < 20) return `dix ${FR_UNITS[n - 10]}`;
  if (n >= 80) {
    const rest = n - 80;
    if (rest === 0) return final ? "quatre vingts" : "quatre vingt";
    return `quatre vingt ${belowHundredToFrench(rest, true)}`;
  }
  const tens = n >= 70 ? 6 : Math.floor(n / 10);
  const rest = n - tens * 10;
  if (rest === 0) return FR_TENS[tens];
  if (rest === 1 || rest === 11) return `${FR_TENS[tens]} et ${FR_UNITS[rest]}`;
  return `${FR_TENS[tens]} ${belowHundredToFrench(rest, true)}`;
}

function belowThousandToFrench(n: number, final: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const words: string[] = [];
  if (hundreds > 0) {
    if (hundreds > 1) words.push(FR_UNITS[hundreds]);
    words.push(hundreds > 1 && rest === 0 && final ? "cents" : "cent");
  }
  if (rest > 0) words.push(belowHundredToFrench(rest, final));
  return words.join(" ");
}

function numberToFrench(n: number): string {
  if (n === 0) return FR_UNITS[0];
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const words: string[] = [];
  if (thousands === 1) words.push("mille");
  else if (thousands > 1) words.push(belowThousandToFrench(thousands, false), "mille");
  if (rest > 0) words.push(belowThousandToFrench(rest, true));
  return words.join(" ");
}

const ES_BELOW_THIRTY = [
  "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
  "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve",
  "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete",
  "veintiocho", "veintinueve",
];
const ES_TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const ES_HUNDREDS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos",
  "ochocientos", "novecientos",
];

function belowThousandToSpanish(n: number): string {
  if (n === 100) return "cien";
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const words: string[] = [];
  if (hundreds > 0) words.push(ES_HUNDREDS[hundreds]);
  if (rest >= 30) {
    words.push(ES_TENS[Math.floor(rest / 10)]);
    if (rest % 10) words.push("y", ES_BELOW_THIRTY[rest % 10]);
  } else if (rest > 0) {
    words.push(ES_BELOW_THIRTY[rest]);
  }
  return words.join(" ");
}

function numberToSpanish(n: number): string {
  if (n === 0) return ES_BELOW_THIRTY[0];
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const words: string[] = [];
  if (thousands === 1) words.push("mil");
  // "veintiún mil", "treinta y un mil"
  else if (thousands > 1) words.push(belowThousandToSpanish(thousands).replace(/veintiuno$/, "veintiún").replace(/uno$/, "un"), "mil");
  if (rest > 0) words.push(belowThousandToSpanish(rest));
  return words.join(" ");
}

const IT_UNITS = [
  "zero", "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove",
  "dieci", "undici", "dodici", "tredici", "quattordici", "quindici", "sedici", "diciassette", "diciotto", "diciannove",
];
const IT_TENS = ["", "", "venti", "trenta", "quaranta", "cinquanta", "sessanta", "settanta", "ottanta", "novanta"];

// Italian writes a number as one word. The accent of "ventitré" is folded away (see normalizeText).
function belowThousandToItalian(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  let words = hundreds === 0 ? "" : hundreds === 1 ? "cento" : `${IT_UNITS[hundreds]}cento`;
  let restWords = "";
  if (rest >= 20) {
    const units = rest % 10;
    const tens = IT_TENS[Math.floor(rest / 10)];
    restWords = units === 0 ? tens : (units === 1 || units === 8 ? tens.slice(0, -1) : tens) + IT_UNITS[units];
  } else if (rest > 0) {
    restWords = IT_UNITS[rest];
  }
  // "centotto", "centottanta"
  if (words && restWords.startsWith("ott")) words = words.slice(0, -1);
  return words + restWords;
}

function numberToItalian(n: number): string {
  if (n === 0) return IT_UNITS[0];
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const prefix = thousands === 0 ? "" : thousands === 1 ? "mille" : `${belowThousandToItalian(thousands)}mila`;
  return prefix + (rest > 0 ? belowThousandToItalian(rest) : "");
}

// --- Number to words (Dutch) ---
// Written as one word up to "duizend" and with a space after it, as the Taalunie spells them
// ("tweeduizend driehonderdvijftig"). After a vowel the "en" takes a diaeresis ("tweeëntwintig").

const NL_UNITS = [
  "nul", "een", "twee", "drie", "vier", "vijf", "zes", "zeven", "acht", "negen",
  "tien", "elf", "twaalf", "dertien", "veertien", "vijftien", "zestien", "zeventien", "achttien", "negentien",
];
const NL_TENS = ["", "", "twintig", "dertig", "veertig", "vijftig", "zestig", "zeventig", "tachtig", "negentig"];

function belowThousandToDutch(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  let words = hundreds === 0 ? "" : hundreds === 1 ? "honderd" : `${NL_UNITS[hundreds]}honderd`;
  if (rest >= 20) {
    const units = rest % 10;
    const tens = NL_TENS[Math.floor(rest / 10)];
    words += units === 0 ? tens : `${NL_UNITS[units]}${NL_UNITS[units].endsWith("e") ? "ën" : "en"}${tens}`;
  } else if (rest > 0) {
    words += NL_UNITS[rest];
  }
  return words;
}

function numberToDutch(n: number): string {
  if (n === 0) return NL_UNITS[0];
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const prefix = thousands === 0 ? "" : thousands === 1 ? "duizend" : `${belowThousandToDutch(thousands)}duizend`;
  const restWords = rest > 0 ? belowThousandToDutch(rest) : "";
  return prefix && restWords ? `${prefix} ${restWords}` : prefix + restWords;
}

const NUMBER_SPELLERS: Partial<Record<string, (n: number) => string>> = {
  de: (n) => (n === 1 ? "eins" : numberToGerman(n)),
  en: numberToEnglish,
  fr: numberToFrench,
  es: numberToSpanish,
  it: numberToItalian,
  nl: numberToDutch,
};

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

// --- Legal citations ---

// A lawyer says "Paragraf 823 Absatz 1 BGB" and writes "§ 823 Abs. 1 BGB"; a model may produce
// either, so both sides get the spoken words. Only abbreviations that cite norms are expanded;
// everyday ones (z. B., bzw.) stay as they are. Abbreviations that are also words ("art.",
// "al.", "co.") only count before a number.
const NOT_IN_WORD = "(?<![\\p{L}\\p{N}])";
const NOT_BEFORE_WORD = "(?![\\p{L}\\p{N}])";
const BEFORE_NUMBER = "(?=\\s*\\d)";
// German "Art." and "Alt." are also words ("die richtige Art. Das …", "Er ist alt.") and only count
// before what they cite, a number in digits or words ("Art. 1", "Art. eins").
const BEFORE_CITED = "(?=\\s*(?:\\d|\\p{Ll}))";
// A citation number may also be spelled out ("art. mille deux cent quarante"). English and French
// number words are whole words; Spanish and Italian ones are matched by their start, because they
// join into one word ("veinticuatro", "duemilaquarantatre").
const CITATION_NUMBER_WORDS: Record<string, string> = {
  en: "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)(?![\\p{L}\\p{N}])",
  fr: "(?:zéro|un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingts?|trente|quarante|cinquante|soixante|cents?|mille)(?![\\p{L}\\p{N}])",
  es: "(?:cero|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci|veint|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|doscient|trescient|cuatrocient|quinient|seiscient|setecient|ochocient|novecient|mil)",
  it: "(?:zero|un|due|tre|quattr|cinque|sei|sett|otto|nove|dieci|undici|dodici|quindici|sedici|diciasset|diciott|diciannove|vent|quarant|cinquant|sessant|settant|ottant|novant|cento|mille)",
  // Dutch numbers are one word too ("honderdtweeënzestig"), so the whole word must be built from
  // number parts, starting with one: "Eenvoud" starts with "een" and "en" joins parts, neither is a number
  nl: "(?:nul|een|één|eén|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf|dertien|veertien|twintig|dertig|veertig|vijftig|zestig|zeventig|tachtig|negentig|honderd|duizend)(?:een|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf|dertien|veertien|twintig|dertig|veertig|vijftig|zestig|zeventig|tachtig|negentig|honderd|duizend|en|ën)*(?![\\p{L}\\p{N}])",
};
function beforeCitationNumber(lang: string, codeLetter = false): string {
  // "art. L. 1234-1" (French codes): a code letter may come before the number
  const letter = codeLetter ? "(?:[LRD]\\.?\\s*)?" : "";
  // The number word may be capitalized ("Art. Eight"); the abbreviation keeps its own case rule
  const words = CITATION_NUMBER_WORDS[lang].replace(/(?<=[(|])\p{Ll}/gu, (first) => `[${first}${first.toUpperCase()}]`);
  return `(?=\\s*${letter}(?:\\d|${words}))`;
}

function abbreviation(source: string, flags = "gu"): RegExp {
  return new RegExp(`${NOT_IN_WORD}${source}`, flags);
}

const LEGAL_CITATIONS: Record<string, Array<[RegExp, string | ((match: string) => string)]>> = {
  // Singular and plural count as the same ("§§ 280, 281" against "Paragraf 280, 281"), and so do
  // the f and ph spellings.
  de: [
    [/§+/gu, " paragraf "],
    [abbreviation(`paragra(?:ph|f)(?:en)?${NOT_BEFORE_WORD}`, "giu"), "paragraf"],
    [abbreviation("i\\.\\s*[Vv]\\.\\s*m\\."), " in verbindung mit "],
    [abbreviation("[Aa]bs\\."), " absatz "],
    [abbreviation(`[Aa]rt\\.${BEFORE_CITED}`), " artikel "],
    [abbreviation("[Nn]r\\."), " nummer "],
    [abbreviation(`S\\.${BEFORE_NUMBER}`), " satz "],
    [abbreviation("[Hh]s\\."), " halbsatz "],
    [abbreviation(`[Aa]lt\\.${BEFORE_CITED}`), " alternative "],
    [abbreviation("[Vv]ar\\."), " variante "],
    [abbreviation("lit\\."), " litera "],
  ],
  en: [
    [/§§/gu, " sections "],
    [/§/gu, " section "],
    [abbreviation(`ss\\.${beforeCitationNumber("en")}`), " sections "],
    [abbreviation(`s\\.${beforeCitationNumber("en")}`), " section "],
    [abbreviation(`[Aa]rt\\.${beforeCitationNumber("en")}`), " article "],
    [abbreviation(`[Pp]ara\\.${beforeCitationNumber("en")}`), " paragraph "],
    [abbreviation(`No\\.${beforeCitationNumber("en")}`), " number "],
    [abbreviation(`(?:vs\\.?|versus)${NOT_BEFORE_WORD}`, "giu"), " v "],
    // Read as one word, dotted or spelled ("E C H R"), in either case; other initials (p.m., "A V.P.")
    // are left to the general rules
    [abbreviation(`U\\.?\\s?S\\.?\\s?C\\.?${NOT_BEFORE_WORD}`, "giu"), " usc "],
    [abbreviation(`C\\.?\\s?F\\.?\\s?R\\.?${NOT_BEFORE_WORD}`, "giu"), " cfr "],
    [abbreviation(`E\\.?\\s?C\\.?\\s?H\\.?\\s?R\\.?${NOT_BEFORE_WORD}`, "giu"), " echr "],
    // "Title VII" is dictated as "Title Seven"; only valid numerals, so "title civil" stays
    [/(?<![\p{L}\p{N}])title\s+(?=[ivxlc])c{0,3}(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})(?![\p{L}\p{N}])/giu, (match) => {
      const [title, numeral] = match.split(/\s+/);
      return `${title} ${romanToNumber(numeral.toUpperCase())}`;
    }],
  ],
  fr: [
    [/§/gu, " paragraphe "],
    [abbreviation(`[Aa]rt\\.${beforeCitationNumber("fr", true)}`), " article "],
    [abbreviation(`al\\.${beforeCitationNumber("fr")}`), " alinéa "],
    [abbreviation(`n[°º]${beforeCitationNumber("fr")}`), " numéro "],
  ],
  es: [
    [abbreviation(`[Aa]rts\\.${beforeCitationNumber("es")}`), " artículos "],
    [abbreviation(`[Aa]rt\\.${beforeCitationNumber("es")}`), " artículo "],
    [abbreviation(`apdo\\.${beforeCitationNumber("es")}`), " apartado "],
    [abbreviation(`(?:núm\\.|n\\.?\\s*[°º])${beforeCitationNumber("es")}`), " número "],
  ],
  it: [
    [abbreviation(`[Aa]rtt\\.${beforeCitationNumber("it")}`), " articoli "],
    [abbreviation(`[Aa]rt\\.${beforeCitationNumber("it")}`), " articolo "],
    [abbreviation(`co\\.${beforeCitationNumber("it")}`), " comma "],
    [abbreviation(`lett\\.`), " lettera "],
    [abbreviation(`n\\.${beforeCitationNumber("it")}`), " numero "],
  ],
  // "art. 6:162 BW" is dictated as "artikel zes honderdtweeënzestig BW"; the colon goes with the
  // punctuation. "jo." (juncto) joins two norms.
  nl: [
    [abbreviation(`[Aa]rtt\\.${beforeCitationNumber("nl")}`), " artikelen "],
    [abbreviation(`[Aa]rt\\.${beforeCitationNumber("nl")}`), " artikel "],
    [abbreviation(`jo\\.${NOT_BEFORE_WORD}`, "giu"), " juncto "],
    [abbreviation(`[Nn]r\\.${beforeCitationNumber("nl")}`), " nummer "],
  ],
};

// "§ 266a" and "§ 266 a", "article L1234" and "article L. 1234" are the same norm. Only after a
// citation word: elsewhere "12B" or "HbA1c" stay whole.
const CITATION_WORDS = "paragraf|artikel|section|article|articolo|artículo|rule";
const CITATION_NUMBER_SUFFIX = new RegExp(`(${NOT_IN_WORD}(?:${CITATION_WORDS})\\s+\\d+)(\\p{L})${NOT_BEFORE_WORD}`, "giu");
const CITATION_CODE_PREFIX = new RegExp(`(${NOT_IN_WORD}(?:${CITATION_WORDS})\\s+)([LRD])(\\d)`, "giu");

const NON_COMPOUNDS =
  /(?<![\p{L}\p{N}])non(binding|compete|compliance|conformity|cooperative|disclosure|discrimination|legislative|payment|performing|profit)(?![\p{L}\p{N}])/giu;

function romanToNumber(numeral: string): number {
  const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let total = 0;
  for (let i = 0; i < numeral.length; i++) {
    const value = values[numeral[i]];
    total += value < (values[numeral[i + 1]] ?? 0) ? -value : value;
  }
  return total;
}

// "L. 1234-1" is dictated as "1234 tiret 1"; after the numbers are spelled out, the word between
// two of them is the hyphen.
const FR_NUMBER_WORD =
  "(?:un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingts?|trente|quarante|cinquante|soixante|cents?|mille)";
const FR_DICTATED_HYPHEN = new RegExp(
  `(?<=(?<![\\p{L}\\p{N}])${FR_NUMBER_WORD})\\s+tiret\\s+(?=${FR_NUMBER_WORD}(?![\\p{L}\\p{N}]))`,
  "gu"
);

function expandLegalCitations(text: string, lang: string): string {
  const rules = LEGAL_CITATIONS[lang];
  if (!rules) return text;
  let result = text;
  for (const [pattern, replacement] of rules) {
    // Two calls: TypeScript has no replace overload for a string-or-function union
    result = typeof replacement === "string" ? result.replace(pattern, replacement) : result.replace(pattern, replacement);
  }
  return result.replace(CITATION_NUMBER_SUFFIX, "$1 $2").replace(CITATION_CODE_PREFIX, "$1$2 $3");
}

// --- Main normalization ---

export function normalizeText(text: string, lang: string = "en"): string {
  if (text === "") return "";

  // 1. Lowercase. Composed accents first: a decomposed "é" would otherwise lose its accent
  // with the punctuation in step 3.
  let result = text.normalize("NFC");
  // Before lowercasing: "S. 1" (Satz), "No. 5" and "i. V. m." are only abbreviations in this case.
  result = expandLegalCitations(result, lang);
  result = result.toLowerCase();

  // Russian writing omits the diaeresis on "ё" most of the time, so models and references
  // disagree on it without any recognition error.
  if (lang === "ru") {
    result = result.replace(/ё/g, "е");
  }

  // "nondisclosure", "non-disclosure" and "non disclosure" (VoxPopuli) are all written. The hyphen
  // becomes a space later, so closed forms are split; a list, because "none" and "nonsense" stay.
  if (lang === "en") result = result.replace(NON_COMPOUNDS, "non $1");

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

  // 4. Convert numbers to words. Languages without a number speller keep their digits rather
  // than having them spelled out in English.
  const speller = NUMBER_SPELLERS[lang];
  result = result.replace(/\b\d+\b/g, (match: string) => {
    const n = parseInt(match, 10);
    return speller && n <= 999999 ? speller(n) : match;
  });
  // "ventitré" and "ventitre" are both written; the accent decides nothing.
  if (lang === "it") result = result.replace(/tré(?![\p{L}\p{N}])/gu, "tre");
  if (lang === "fr") result = result.replace(FR_DICTATED_HYPHEN, " ");
  // Dutch stresses "een" (one) and "voor" (before) with accents ("één", "vóór", capitalized "Eén"); the
  // accent decides nothing.
  if (lang === "nl") result = result.replace(/(?<![\p{L}\p{N}])(één|eén|vóór)(?![\p{L}\p{N}])/gu, (word) => word.normalize("NFD").replace(/\u0301/g, ""));

  // 5. Remove filler words
  const fillers = fillersFor(lang);
  result = result
    .split(/\s+/)
    .filter((word) => !fillers.has(word))
    .join(" ");

  // 6. Normalize whitespace
  result = result.replace(/\s+/g, " ").trim();

  return result;
}
