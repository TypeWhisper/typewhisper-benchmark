import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { ExternalRunBundleSchema } from "./schema.js";

export async function uploadRunBundle(options: {
  path: string;
  baseUrl: string;
  username: string;
  password: string;
}): Promise<unknown> {
  const raw = await readFile(options.path);
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error(`${basename(options.path)} is not valid JSON`);
  }
  const bundle = ExternalRunBundleSchema.parse(decoded);
  const authorization = Buffer.from(
    `${options.username}:${options.password}`,
    "utf8"
  ).toString("base64");
  const endpoint = new URL("/api/uploads/runs", options.baseUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/json",
    },
    body: raw,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    [key: string]: unknown;
  };
  if (!response.ok) {
    throw new Error(payload.error ?? `Upload failed with HTTP ${response.status}`);
  }
  return { ...payload, validatedRunId: bundle.manifest.runId };
}

async function main(args = process.argv.slice(2)): Promise<void> {
  const [path] = args;
  if (!path) {
    throw new Error("Usage: npm run upload:run -- <run.bundle.json>");
  }
  const baseUrl =
    process.env.BENCHMARK_UPLOAD_URL ??
    "https://typewhisper-benchmark.hlab.cloud";
  const username = process.env.BENCHMARK_UPLOAD_USERNAME;
  const password = process.env.BENCHMARK_UPLOAD_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "Set BENCHMARK_UPLOAD_USERNAME and BENCHMARK_UPLOAD_PASSWORD before uploading"
    );
  }

  const receipt = await uploadRunBundle({
    path,
    baseUrl,
    username,
    password,
  });
  console.log(JSON.stringify(receipt, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
