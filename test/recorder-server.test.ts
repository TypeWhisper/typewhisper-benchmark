import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRecorderServer,
  extensionForMimeType,
} from "../src/recorder-server.js";

describe("recorder server", () => {
  let storageRoot: string;
  let server: ReturnType<typeof createRecorderServer>;
  let baseUrl: string;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "typewhisper-recorder-test-"));
    server = createRecorderServer(process.cwd(), storageRoot);
    await new Promise<void>((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen)
    );
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("maps browser recorder MIME types to stable extensions", () => {
    expect(extensionForMimeType("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionForMimeType("audio/mp4")).toBe("m4a");
    expect(extensionForMimeType("text/plain")).toBeUndefined();
  });

  it("serves health and the application without a second app login", async () => {
    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, batches: 1 });

    const recorder = await fetch(`${baseUrl}/`);
    expect(recorder.status).toBe(200);
    expect(recorder.headers.get("x-content-type-options")).toBe("nosniff");
    expect(recorder.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'"
    );

    const recorderHead = await fetch(`${baseUrl}/results`, {
      method: "HEAD",
    });
    expect(recorderHead.status).toBe(200);
    expect(recorderHead.headers.get("content-type")).toContain("text/html");
  });

  it("stores audio takes only in the configured storage root", async () => {
    const response = await fetch(
      `${baseUrl}/api/batches/de-de-pilot-01/recordings/de-own-dictation-001`,
      {
        method: "POST",
        headers: {
          "Content-Type": "audio/webm;codecs=opus",
        },
        body: Buffer.from("fixture-audio"),
      }
    );
    expect(response.status).toBe(201);
    const saved = (await response.json()) as { fileName: string };
    expect(saved.fileName).toBe("01-de-own-dictation-001-take-01.webm");
    const file = await readFile(
      resolve(
        storageRoot,
        "corpus/inbox/self-recorded/speaker-001/de-DE/pilot-01",
        saved.fileName
      ),
      "utf8"
    );
    expect(file).toBe("fixture-audio");
  });

  it("accepts valid run bundles idempotently into pending review", async () => {
    const bundle = {
      schemaVersion: 1,
      manifest: {
        schemaVersion: 1,
        runId: "windows-cuda-run-1",
        planId: "a".repeat(64),
        createdAt: "2026-09-04T08:00:00.000Z",
        gitCommit: "b".repeat(40),
        targetIds: ["parakeet-cuda"],
        environment: {
          environmentId: "windows-cuda-1",
          os: "Windows 11",
          architecture: "x64",
          accelerator: "NVIDIA fixture GPU",
          runtimeVersions: { cuda: "fixture" },
        },
      },
      results: [
        {
          schemaVersion: 1,
          runId: "windows-cuda-run-1",
          planId: "a".repeat(64),
          targetId: "parakeet-cuda",
          caseId: "fixture-de-1",
          trial: 1,
          status: "ok",
          transcript: "Test",
          durationMs: 100,
        },
      ],
    };
    const upload = () =>
      fetch(`${baseUrl}/api/uploads/runs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(bundle),
      });

    const first = await upload();
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({
      runId: "windows-cuda-run-1",
      duplicate: false,
      status: "pending-review",
    });

    const second = await upload();
    expect(second.status).toBe(201);
    expect(await second.json()).toMatchObject({ duplicate: true });

    const listing = await fetch(`${baseUrl}/api/uploads/runs`);
    const payload = (await listing.json()) as { uploads: unknown[] };
    expect(payload.uploads).toHaveLength(1);
  });
});
