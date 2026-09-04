import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareTypeWhisperRunKit } from "../src/run-kit.js";
import { fixtureCatalog, fixtureCorpus, fixtureProfile } from "./fixtures.js";

describe("portable run kits", () => {
  let temporaryRoot: string | undefined;

  afterEach(async () => {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  });

  it("rejects a target that does not use the TypeWhisper HTTP adapter", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "typewhisper-kit-test-"));
    const corpus = fixtureCorpus();
    const corpusRoot = resolve(temporaryRoot, "corpus");
    await mkdir(resolve(corpusRoot, "audio"), { recursive: true });
    await writeFile(resolve(corpusRoot, corpus.items[0]!.audio.path), "fixture");

    await expect(
      prepareTypeWhisperRunKit({
        catalog: fixtureCatalog(),
        corpus,
        corpusRoot,
        profile: fixtureProfile(),
        targetId: "fixture-target",
        gitCommit: "a".repeat(40),
        outputDirectory: resolve(temporaryRoot, "kit"),
      })
    ).rejects.toThrow(/currently supports typewhisper-http/);
  });

  it("ships a dependency-free executor", async () => {
    expect(
      await readFile(resolve("portable/typewhisper-runner.py"), "utf8")
    ).toContain("Dependency-free TypeWhisper benchmark executor");
  });
});
