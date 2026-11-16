import { describe, it, expect } from "vitest";
import { normalizeText, normalizeCodeText } from "./normalize.js";

describe("normalizeText", () => {
  it("lowercases text", () => {
    expect(normalizeText("Hello World")).toBe("hello world");
  });

  it("removes punctuation", () => {
    expect(normalizeText("Hello, world! How are you?")).toBe(
      "hello world how are you",
    );
  });

  it("normalizes whitespace", () => {
    expect(normalizeText("hello   world\n\tfoo")).toBe("hello world foo");
  });

  it("expands English contractions", () => {
    expect(normalizeText("it's don't I'm")).toBe("it is do not i am");
  });

  it("normalizes numbers to words (English)", () => {
    expect(normalizeText("I have 3 cats", "en")).toBe("i have three cats");
  });

  it("normalizes large numbers to words (English)", () => {
    expect(normalizeText("there are 42 items", "en")).toBe(
      "there are forty two items",
    );
    expect(normalizeText("she scored 100", "en")).toBe(
      "she scored one hundred",
    );
    expect(normalizeText("population of 500000", "en")).toBe(
      "population of five hundred thousand",
    );
  });

  it("normalizes numbers to words (German)", () => {
    expect(normalizeText("Ich habe 3 Katzen", "de")).toBe(
      "ich habe drei katzen",
    );
  });

  it("normalizes large numbers to words (German)", () => {
    expect(normalizeText("es gibt 21 Dinge", "de")).toBe(
      "es gibt einundzwanzig dinge",
    );
    expect(normalizeText("er hat 100 Euro", "de")).toBe(
      "er hat einhundert euro",
    );
    expect(normalizeText("das kostet 999999", "de")).toBe(
      "das kostet neunhundertneunundneunzigtausendneunhundertneunundneunzig",
    );
  });

  it("removes filler words", () => {
    expect(normalizeText("uhm so hello uh world")).toBe("so hello world");
  });

  it("removes German filler words", () => {
    expect(normalizeText("ähm also hallo äh welt", "de")).toBe(
      "also hallo welt",
    );
  });

  it("handles empty string", () => {
    expect(normalizeText("")).toBe("");
  });

  it("handles combined transformations", () => {
    expect(normalizeText("I've got 2 cats, uh, and 3 dogs!")).toBe(
      "i have got two cats and three dogs",
    );
  });

  it("preserves German umlauts", () => {
    expect(normalizeText("Über die Straße", "de")).toBe("über die straße");
  });

  it("folds ё into е for Russian", () => {
    expect(normalizeText("Зелёный ёжик", "ru")).toBe("зеленый ежик");
  });

  it("keeps digits for languages without a number speller", () => {
    expect(normalizeText("В 1990 году", "ru")).toBe("в 1990 году");
  });

  it("removes Russian hesitations but keeps real words", () => {
    expect(normalizeText("Ну, э, мм, вот так", "ru")).toBe("ну вот так");
  });

  it("removes French, Spanish, Italian and Portuguese hesitations but keeps real words", () => {
    expect(normalizeText("Euh, bah, je crois", "fr")).toBe("bah je crois");
    expect(normalizeText("Eh, pues, no sé", "es")).toBe("pues no sé");
    expect(normalizeText("Ehm, allora, va bene", "it")).toBe("allora va bene");
    expect(normalizeText("Hã, então, tudo bem", "pt")).toBe("então tudo bem");
  });

  it("keeps decomposed accents", () => {
    expect(normalizeText("e\u0301te\u0301", "fr")).toBe("été");
    expect(normalizeText("Où est-il ?", "fr")).toBe("où est il");
  });

  it("spells French, Spanish and Italian numbers the way they are written out", () => {
    const fr = (n: string) => normalizeText(n, "fr");
    expect(fr("21 71 80 81 97")).toBe("vingt et un soixante et onze quatre vingts quatre vingt un quatre vingt dix sept");
    expect(fr("200 201 80000 1240")).toBe("deux cents deux cent un quatre vingt mille mille deux cent quarante");
    expect(fr("l'article 2224")).toBe(fr("l'article deux mille deux cent vingt-quatre"));
    const es = (n: string) => normalizeText(n, "es");
    expect(es("16 24 100 101 1902 1964")).toBe(
      "dieciséis veinticuatro cien ciento uno mil novecientos dos mil novecientos sesenta y cuatro"
    );
    expect(es("21000 500")).toBe("veintiún mil quinientos");
    const it_ = (n: string) => normalizeText(n, "it");
    expect(it_("21 28 108 180 1000 2043 2946")).toBe(
      "ventuno ventotto centotto centottanta mille duemilaquarantatre duemilanovecentoquarantasei"
    );
    expect(it_("art. 2043")).toBe(it_("articolo duemilaquarantatré"));
  });

  it("handles zero", () => {
    expect(normalizeText("0 errors", "en")).toBe("zero errors");
    expect(normalizeText("0 Fehler", "de")).toBe("null fehler");
  });

  it("reads German norm citations the way a lawyer dictates them", () => {
    const spoken = "paragraf achthundertdreiundzwanzig absatz eins bgb";
    expect(normalizeText("§ 823 Abs. 1 BGB", "de")).toBe(spoken);
    expect(normalizeText("§823 Absatz 1 BGB", "de")).toBe(spoken);
    expect(normalizeText("Paragraph 823 Absatz 1 BGB", "de")).toBe(spoken);
    expect(normalizeText("Paragraf 823 Absatz 1 BGB", "de")).toBe(spoken);
    expect(normalizeText("Art. 2 Abs. 1 GG", "de")).toBe("artikel zwei absatz eins gg");
    expect(normalizeText("§ 543 Abs. 2 S. 1 Nr. 3 BGB", "de")).toBe(
      "paragraf fünfhundertdreiundvierzig absatz zwei satz eins nummer drei bgb"
    );
    expect(normalizeText("§ 280 Abs. 1 i. V. m. § 241 Abs. 2 BGB", "de")).toBe(
      normalizeText("Paragraf 280 Absatz 1 in Verbindung mit Paragraf 241 Absatz 2 BGB", "de")
    );
  });

  it("treats singular and plural paragraph signs and letter suffixes alike", () => {
    expect(normalizeText("§§ 23, 71 GVG", "de")).toBe(normalizeText("Paragrafen 23, 71 GVG", "de"));
    expect(normalizeText("§ 153a StPO", "de")).toBe(normalizeText("Paragraf 153 a StPO", "de"));
  });

  it("reads English citations the way they are dictated", () => {
    expect(normalizeText("42 U.S.C. § 1983", "en")).toBe(normalizeText("42 USC Section 1983", "en"));
    expect(normalizeText("at 2 p.m.", "en")).toBe("at two p m");
    expect(normalizeText("Rule 12(b)(6)", "en")).toBe(normalizeText("Rule 12b 6", "en"));
    expect(normalizeText("s. 2 of the Limitation Act", "en")).toBe("section two of the limitation act");
    expect(normalizeText("Art. 8 ECHR", "en")).toBe("article eight echr");
    expect(normalizeText("Roe versus Wade", "en")).toBe(normalizeText("Roe v. Wade", "en"));
    expect(normalizeText("It's art. Really", "en")).toBe("it is art really");
  });

  it("reads French, Spanish and Italian citations the way they are dictated", () => {
    expect(normalizeText("art. L. 1234-1 du Code du travail, al. 2", "fr")).toBe(
      normalizeText("article L1234-1 du Code du travail, alinéa 2", "fr")
    );
    expect(normalizeText("C'est de l'art.", "fr")).toBe("c est de l art");
    expect(normalizeText("art. 1902 del Código Civil, apdo. 2", "es")).toBe(
      normalizeText("artículo 1902 del Código Civil, apartado 2", "es")
    );
    expect(normalizeText("art. 360, co. 1, n. 3", "it")).toBe(normalizeText("articolo 360, comma 1, numero 3", "it"));
  });

  it("leaves legal abbreviations alone in languages without rules and in other words", () => {
    expect(normalizeText("Art. 5", "pt")).toBe("art 5");
    expect(normalizeText("Kunstart. Ende", "de")).toBe("kunstart ende");
    expect(normalizeText("Das S. Bahn", "de")).toBe("das s bahn");
    expect(normalizeText("Das ist die richtige Art.", "de")).toBe("das ist die richtige art");
    expect(normalizeText("Alt. Neu.", "de")).toBe("alt neu");
  });

  it("reads lowercase citation abbreviations like the written ones", () => {
    expect(normalizeText("nr. 3 abs. 2 art. 5 i. v. m.", "de")).toBe(normalizeText("Nr. 3 Abs. 2 Art. 5 i. V. m.", "de"));
    expect(normalizeText("Art. eins Abs. zwei", "de")).toBe("artikel eins absatz zwei");
  });
});

describe("normalizeCodeText", () => {
  it("preserves case (camelCase, PascalCase)", () => {
    expect(normalizeCodeText("getUserName fetchUserData")).toBe(
      "getUserName fetchUserData",
    );
  });

  it("preserves numbers", () => {
    expect(normalizeCodeText("port 8080 version 3")).toBe(
      "port 8080 version 3",
    );
  });

  it("removes filler words", () => {
    expect(normalizeCodeText("uh getUserName um equals uhm fetchData")).toBe(
      "getUserName equals fetchData",
    );
  });

  it("removes German filler words", () => {
    expect(normalizeCodeText("ähm Variable äh getName")).toBe(
      "Variable getName",
    );
  });

  it("normalizes whitespace", () => {
    expect(normalizeCodeText("  foo   bar  ")).toBe("foo bar");
  });

  it("handles empty string", () => {
    expect(normalizeCodeText("")).toBe("");
  });

  it("preserves snake_case and SCREAMING_CASE", () => {
    expect(normalizeCodeText("MAX_RETRIES get_user_name")).toBe(
      "MAX_RETRIES get_user_name",
    );
  });
});
