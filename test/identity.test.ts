import { describe, expect, it } from "vitest";
import { canonicalJson, contentDigest } from "../src/identity.js";

describe("content identity", () => {
  it("is independent of object key order", () => {
    expect(contentDigest({ b: 2, a: 1 })).toBe(contentDigest({ a: 1, b: 2 }));
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it("rejects values that cannot be represented in JSON", () => {
    expect(() => contentDigest({ value: undefined })).toThrow();
  });
});
