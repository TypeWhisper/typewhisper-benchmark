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

  it("handles zero", () => {
    expect(normalizeText("0 errors", "en")).toBe("zero errors");
    expect(normalizeText("0 Fehler", "de")).toBe("null fehler");
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
