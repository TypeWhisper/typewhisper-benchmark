import { describe, it, expect } from "vitest";
import { calculateWER, calculateCER } from "./wer.js";

describe("calculateWER", () => {
  it("returns 0 for identical strings", () => {
    expect(calculateWER("hello world", "hello world")).toBe(0);
  });

  it("returns 1 for completely different strings", () => {
    expect(calculateWER("hello world", "foo bar")).toBe(1);
  });

  it("handles substitution", () => {
    expect(calculateWER("the cat sat", "the dog sat")).toBeCloseTo(1 / 3);
  });

  it("handles insertion", () => {
    expect(calculateWER("the cat sat", "the big cat sat")).toBeCloseTo(1 / 3);
  });

  it("handles deletion", () => {
    expect(calculateWER("the cat sat", "the sat")).toBeCloseTo(1 / 3);
  });

  it("handles empty reference", () => {
    expect(calculateWER("", "hello")).toBe(1);
  });

  it("handles empty hypothesis", () => {
    expect(calculateWER("hello world", "")).toBe(1);
  });

  it("handles both empty", () => {
    expect(calculateWER("", "")).toBe(0);
  });
});

describe("calculateCER", () => {
  it("returns 0 for identical strings", () => {
    expect(calculateCER("hello", "hello")).toBe(0);
  });

  it("calculates character-level errors", () => {
    expect(calculateCER("hello", "hallo")).toBeCloseTo(1 / 5);
  });

  it("handles empty strings", () => {
    expect(calculateCER("", "")).toBe(0);
  });
});
