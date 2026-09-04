import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { admitRecordingBatch } from "../src/admit-recording-batch.js";
import { CorpusManifestSchema, RecordingBatchSchema } from "../src/schema.js";

describe("recording batch admission", () => {
  let storageRoot: string | undefined;

  afterEach(async () => {
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
    storageRoot = undefined;
  });

  it("materializes reviewed takes into a private content-addressed manifest", async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "typewhisper-admission-test-"));
    const batch = RecordingBatchSchema.parse(
      JSON.parse(
        await readFile(
          resolve("corpus/recording-batches/de-de-pilot-01.json"),
          "utf8"
        )
      )
    );
    const inbox = resolve(storageRoot, batch.outputDirectory);
    await mkdir(inbox, { recursive: true });
    await Promise.all(
      batch.items.map((item) =>
        writeFile(resolve(inbox, `${item.fileBase}-take-01.webm`), item.promptId)
      )
    );

    const first = await admitRecordingBatch(
      {
        workspaceRoot: process.cwd(),
        storageRoot,
        batchId: batch.id,
        reviewer: "reviewer-fixture",
        reviewedAt: "2026-09-04T12:00:00.000Z",
        device: "Fixture microphone",
        environment: "Fixture room",
      },
      {
        probeAudio: async () => ({
          sampleRateHz: 48_000,
          channels: 2,
          durationMs: 5_000,
        }),
      }
    );
    const second = await admitRecordingBatch(
      {
        workspaceRoot: process.cwd(),
        storageRoot,
        batchId: batch.id,
        reviewer: "reviewer-fixture",
        reviewedAt: "2026-09-04T12:00:00.000Z",
        device: "Fixture microphone",
        environment: "Fixture room",
      },
      {
        probeAudio: async () => ({
          sampleRateHz: 48_000,
          channels: 2,
          durationMs: 5_000,
        }),
      }
    );

    expect(first.admittedCount).toBe(12);
    expect(second.corpusVersion).toBe(first.corpusVersion);
    const manifest = CorpusManifestSchema.parse(
      JSON.parse(await readFile(first.manifestPath, "utf8"))
    );
    expect(manifest.items).toHaveLength(12);
    expect(manifest.items[0]?.source.rights.redistributable).toBe(false);
    expect(manifest.items[0]?.references.verbatim).not.toContain(",");
    const admittedAudio = resolve(storageRoot, "corpus", manifest.items[0]!.audio.path);
    expect((await stat(admittedAudio)).mode & 0o777).toBe(0o600);
  });
});
