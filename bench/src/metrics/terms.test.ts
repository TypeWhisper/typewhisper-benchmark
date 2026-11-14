import { describe, expect, it } from "vitest";
import { calculateTermRecall } from "./terms.js";

describe("calculateTermRecall", () => {
  it("is undefined without key terms", () => {
    expect(calculateTermRecall(undefined, "egal", "de")).toBeUndefined();
    expect(calculateTermRecall([], "egal", "de")).toBeUndefined();
  });

  it("ignores case and punctuation", () => {
    expect(calculateTermRecall(["Metformin"], "Weiter mit metformin, zweimal täglich.", "de")).toBe(1);
  });

  it("treats a hyphen like a space", () => {
    expect(calculateTermRecall(["Thorax-CT"], "Ein Thorax CT ist gelaufen", "de")).toBe(1);
    expect(calculateTermRecall(["Helicobacter pylori"], "Helicobacter-pylori positiv", "de")).toBe(1);
  });

  it("does not accept a term split into other words", () => {
    expect(calculateTermRecall(["Bisoprolol"], "mit Biso Prolol eingeleitet", "de")).toBe(0);
    expect(calculateTermRecall(["Diabetes mellitus"], "bekannter Diabetesmellitus", "de")).toBe(0);
  });

  it("does not accept a misspelled term or a word that only contains it", () => {
    expect(calculateTermRecall(["Ramipril"], "Ramiprill fünf Milligramm", "de")).toBe(0);
    expect(calculateTermRecall(["Insulin"], "Insulinpumpe", "de")).toBe(0);
  });

  it("counts each distinct term once", () => {
    expect(calculateTermRecall(["Bisoprolol", "Bisoprolol", "Torasemid"], "Bisoprolol und Torasemit", "de")).toBe(0.5);
  });

  it("accepts the f and ph spellings of German words", () => {
    expect(calculateTermRecall(["Echokardiografie"], "eine Echokardiographie durchführen", "de")).toBe(1);
    expect(calculateTermRecall(["Sonographie"], "die Sonografie war unauffällig", "de")).toBe(1);
    expect(calculateTermRecall(["Photography"], "photografy", "en")).toBe(0);
  });

  it("matches terms with digits", () => {
    expect(calculateTermRecall(["HbA1c"], "der HbA1c liegt bei 7", "de")).toBe(1);
    expect(calculateTermRecall(["NT-proBNP"], "das NT proBNP war erhöht", "de")).toBe(1);
  });
});
