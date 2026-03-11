import { describe, it, expect } from "vitest";
import { WhisperCppProvider } from "./whisper-cpp.js";

describe("WhisperCppProvider", () => {
  it("has correct provider metadata", () => {
    const provider = new WhisperCppProvider();
    expect(provider.id).toBe("whisper-cpp");
    expect(provider.name).toBe("whisper.cpp");
    expect(provider.type).toBe("local");
    expect(provider.models).toContain("large-v3");
    expect(provider.models).toContain("large-v3-turbo");
    expect(provider.models.length).toBe(6);
  });
});
