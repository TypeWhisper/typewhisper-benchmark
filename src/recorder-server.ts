import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  RecordingBatchSchema,
  ExternalRunBundleSchema,
  MetricIdSchema,
  RecordingPlanSchema,
  VisualizationSnapshotSchema,
  type RecordingBatch,
  type RecordingPrompt,
} from "./schema.js";

const DEFAULT_PORT = 4178;
const DEFAULT_HOST = "127.0.0.1";
const MAX_RECORDING_BYTES = 25 * 1024 * 1024;
const MAX_RUN_BUNDLE_BYTES = 50 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([
  ".flac",
  ".m4a",
  ".mp3",
  ".ogg",
  ".wav",
  ".webm",
]);

const STATIC_FILES: Record<string, { file: string; contentType: string }> = {
  "/": { file: "index.html", contentType: "text/html; charset=utf-8" },
  "/app.js": {
    file: "app.js",
    contentType: "text/javascript; charset=utf-8",
  },
  "/results": {
    file: "results.html",
    contentType: "text/html; charset=utf-8",
  },
  "/results.js": {
    file: "results.js",
    contentType: "text/javascript; charset=utf-8",
  },
  "/upload": {
    file: "upload.html",
    contentType: "text/html; charset=utf-8",
  },
  "/upload.js": {
    file: "upload.js",
    contentType: "text/javascript; charset=utf-8",
  },
  "/styles.css": {
    file: "styles.css",
    contentType: "text/css; charset=utf-8",
  },
};

const MIME_EXTENSIONS: Record<string, string> = {
  "audio/flac": "flac",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/x-wav": "wav",
};

const EXTENSION_MIME_TYPES: Record<string, string> = {
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

interface LoadedBatch {
  batch: RecordingBatch;
  prompts: Map<string, RecordingPrompt>;
  outputPath: string;
}

interface SavedTake {
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  url: string;
}

export function extensionForMimeType(mimeType: string): string | undefined {
  return MIME_EXTENSIONS[mimeType.split(";", 1)[0]!.trim().toLowerCase()];
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadBatch(
  root: string,
  storageRoot: string,
  batchId: string
): Promise<LoadedBatch> {
  const batchFile = resolve(root, "corpus", "recording-batches", `${batchId}.json`);
  const batchesRoot = resolve(root, "corpus", "recording-batches");
  if (!isInside(batchesRoot, batchFile)) throw new Error("Invalid batch ID");

  const batch = RecordingBatchSchema.parse(await readJson(batchFile));
  if (batch.id !== batchId) {
    throw new Error(`Batch file ${batchId}.json declares ID ${batch.id}`);
  }

  const plan = RecordingPlanSchema.parse(
    await readJson(resolve(root, "corpus", "recording-plan.v1.json"))
  );
  const prompts = new Map(plan.prompts.map((prompt) => [prompt.id, prompt]));

  for (const item of batch.items) {
    const prompt = prompts.get(item.promptId);
    if (!prompt) throw new Error(`Batch references unknown prompt ${item.promptId}`);
    if (prompt.language !== batch.language) {
      throw new Error(
        `Prompt ${prompt.id} uses ${prompt.language}, batch uses ${batch.language}`
      );
    }
  }

  const outputPath = resolve(storageRoot, batch.outputDirectory);
  if (!isInside(resolve(storageRoot, "corpus", "inbox"), outputPath)) {
    throw new Error("Batch output directory must stay inside corpus/inbox");
  }

  return { batch, prompts, outputPath };
}

async function takeFiles(loaded: LoadedBatch, fileBase: string): Promise<SavedTake[]> {
  let files: string[];
  try {
    files = await readdir(loaded.outputPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw error;
  }

  const pattern = new RegExp(
    `^${escapeRegExp(fileBase)}(?:-take-(\\d{2}))?\\.(flac|m4a|mp3|ogg|wav|webm)$`
  );
  const matching = files.filter((file) => pattern.test(file)).sort();

  return Promise.all(
    matching.map(async (fileName) => {
      const details = await stat(resolve(loaded.outputPath, fileName));
      return {
        fileName,
        sizeBytes: details.size,
        createdAt: details.mtime.toISOString(),
        url: `/api/batches/${encodeURIComponent(loaded.batch.id)}/recordings/${encodeURIComponent(fileName)}`,
      };
    })
  );
}

async function batchPayload(root: string, storageRoot: string, batchId: string) {
  const loaded = await loadBatch(root, storageRoot, batchId);
  const items = await Promise.all(
    loaded.batch.items.map(async (item, index) => {
      const prompt = loaded.prompts.get(item.promptId)!;
      return {
        index: index + 1,
        promptId: item.promptId,
        fileBase: item.fileBase,
        displayText: item.displayText,
        category: prompt.category,
        takes: await takeFiles(loaded, item.fileBase),
      };
    })
  );

  return {
    id: loaded.batch.id,
    title: loaded.batch.title,
    language: loaded.batch.language,
    speakerId: loaded.batch.speakerId,
    outputDirectory: loaded.batch.outputDirectory,
    items,
  };
}

async function availableBatches(root: string, storageRoot: string) {
  const directory = resolve(root, "corpus", "recording-batches");
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".json"))
    .sort();

  return Promise.all(
    files.map(async (file) => {
      const id = basename(file, ".json");
      const loaded = await loadBatch(root, storageRoot, id);
      return {
        id: loaded.batch.id,
        title: loaded.batch.title,
        language: loaded.batch.language,
        itemCount: loaded.batch.items.length,
      };
    })
  );
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function sendError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, { error: message });
}

async function readBody(
  request: IncomingMessage,
  maximumBytes = MAX_RECORDING_BYTES,
  label = "Recording"
): Promise<Buffer> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (declaredLength > maximumBytes) {
    throw new Error(`${label} exceeds the ${maximumBytes / 1024 / 1024} MB limit`);
  }

  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > maximumBytes) {
      throw new Error(`${label} exceeds the ${maximumBytes / 1024 / 1024} MB limit`);
    }
    chunks.push(buffer);
  }
  if (length === 0) throw new Error(`${label} is empty`);
  return Buffer.concat(chunks);
}

async function saveRecording(
  root: string,
  storageRoot: string,
  batchId: string,
  promptId: string,
  request: IncomingMessage
): Promise<SavedTake> {
  const loaded = await loadBatch(root, storageRoot, batchId);
  const item = loaded.batch.items.find((candidate) => candidate.promptId === promptId);
  if (!item) throw new Error(`Prompt ${promptId} is not part of batch ${batchId}`);

  const mimeType = request.headers["content-type"] ?? "";
  const extension = extensionForMimeType(mimeType);
  if (!extension) throw new Error(`Unsupported recording type: ${mimeType || "unknown"}`);

  const body = await readBody(request);
  await mkdir(loaded.outputPath, { recursive: true });
  const existing = await takeFiles(loaded, item.fileBase);
  const nextTake =
    existing.reduce((highest, take) => {
      const match = /-take-(\d{2})\./.exec(take.fileName);
      return Math.max(highest, match ? Number(match[1]) : 0);
    }, 0) + 1;
  const fileName = `${item.fileBase}-take-${String(nextTake).padStart(2, "0")}.${extension}`;
  const destination = resolve(loaded.outputPath, fileName);
  const temporary = `${destination}.part`;

  try {
    await writeFile(temporary, body, { flag: "wx" });
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }

  const details = await stat(destination);
  return {
    fileName,
    sizeBytes: details.size,
    createdAt: details.mtime.toISOString(),
    url: `/api/batches/${encodeURIComponent(batchId)}/recordings/${encodeURIComponent(fileName)}`,
  };
}

function runBundleSummary(
  bundle: ReturnType<typeof ExternalRunBundleSchema.parse>,
  digest: string,
  fileName: string,
  receivedAt: string,
  sizeBytes: number
) {
  return {
    runId: bundle.manifest.runId,
    digest,
    fileName,
    receivedAt,
    sizeBytes,
    resultCount: bundle.results.length,
    targetIds: bundle.manifest.targetIds,
    environment: bundle.manifest.environment,
    status: "pending-review" as const,
  };
}

async function saveRunBundle(storageRoot: string, request: IncomingMessage) {
  const contentType = (request.headers["content-type"] ?? "")
    .split(";", 1)[0]!
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new Error("Run uploads require Content-Type application/json");
  }

  const body = await readBody(
    request,
    MAX_RUN_BUNDLE_BYTES,
    "Run bundle"
  );
  let decoded: unknown;
  try {
    decoded = JSON.parse(body.toString("utf8"));
  } catch {
    throw new Error("Run bundle is not valid JSON");
  }
  const bundle = ExternalRunBundleSchema.parse(decoded);
  const digest = createHash("sha256").update(body).digest("hex");
  const fileName = `${bundle.manifest.runId}-${digest}.bundle.json`;
  const directory = resolve(storageRoot, "uploads", "pending");
  const destination = resolve(directory, fileName);
  await mkdir(directory, { recursive: true });

  let duplicate = false;
  try {
    await writeFile(destination, body, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    duplicate = true;
  }

  const details = await stat(destination);
  return {
    ...runBundleSummary(
      bundle,
      digest,
      fileName,
      details.mtime.toISOString(),
      details.size
    ),
    duplicate,
  };
}

async function pendingRunBundles(storageRoot: string) {
  const directory = resolve(storageRoot, "uploads", "pending");
  let files: string[];
  try {
    files = (await readdir(directory))
      .filter((file) => file.endsWith(".bundle.json"))
      .sort()
      .reverse()
      .slice(0, 50);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  return Promise.all(
    files.map(async (fileName) => {
      const path = resolve(directory, fileName);
      const raw = await readFile(path);
      const bundle = ExternalRunBundleSchema.parse(JSON.parse(raw.toString("utf8")));
      const digest = createHash("sha256").update(raw).digest("hex");
      const details = await stat(path);
      return runBundleSummary(
        bundle,
        digest,
        fileName,
        details.mtime.toISOString(),
        details.size
      );
    })
  );
}

async function sendRecording(
  root: string,
  storageRoot: string,
  batchId: string,
  fileName: string,
  response: ServerResponse
): Promise<void> {
  if (basename(fileName) !== fileName) throw new Error("Invalid recording filename");
  const extension = extname(fileName).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error("Unsupported audio file");

  const loaded = await loadBatch(root, storageRoot, batchId);
  const belongsToBatch = loaded.batch.items.some((item) =>
    fileName.startsWith(`${item.fileBase}.`) ||
    fileName.startsWith(`${item.fileBase}-take-`)
  );
  if (!belongsToBatch) throw new Error("Recording does not belong to this batch");

  const path = resolve(loaded.outputPath, fileName);
  if (!isInside(loaded.outputPath, path)) throw new Error("Invalid recording path");
  const audio = await readFile(path);
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Length": audio.length,
    "Content-Type": EXTENSION_MIME_TYPES[extension] ?? "application/octet-stream",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(audio);
}

async function sendStatic(
  root: string,
  pathname: string,
  response: ServerResponse,
  headOnly = false
): Promise<boolean> {
  const entry = STATIC_FILES[pathname];
  if (!entry) return false;
  const content = await readFile(resolve(root, "web", "recorder", entry.file));
  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "Content-Type": entry.contentType,
    "Permissions-Policy": "microphone=(self)",
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(headOnly ? undefined : content);
  return true;
}

export function createRecorderServer(
  root = process.cwd(),
  storage = root
) {
  const workspaceRoot = resolve(root);
  const storageRoot = resolve(storage);
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

      if (request.method === "GET" && url.pathname === "/api/batches") {
        sendJson(response, 200, {
          batches: await availableBatches(workspaceRoot, storageRoot),
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        const batches = await availableBatches(workspaceRoot, storageRoot);
        sendJson(response, 200, {
          ok: true,
          batches: batches.length,
          storage: "available",
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/results/latest") {
        const plan = RecordingPlanSchema.parse(
          await readJson(resolve(workspaceRoot, "corpus", "recording-plan.v1.json"))
        );
        try {
          const snapshot = VisualizationSnapshotSchema.parse(
            await readJson(resolve(storageRoot, "published", "latest.json"))
          );
          sendJson(response, 200, { status: "ready", snapshot });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          sendJson(response, 200, {
            status: "empty",
            planned: {
              languages: plan.languagePacks.map((pack) => ({
                id: pack.language,
                tier: pack.tier,
              })),
              metrics: MetricIdSchema.options,
            },
          });
        }
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/uploads/runs") {
        sendJson(response, 200, {
          uploads: await pendingRunBundles(storageRoot),
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/uploads/runs") {
        sendJson(response, 201, await saveRunBundle(storageRoot, request));
        return;
      }

      if (request.method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "batches") {
        sendJson(
          response,
          200,
          await batchPayload(workspaceRoot, storageRoot, parts[2]!)
        );
        return;
      }

      if (
        request.method === "POST" &&
        parts.length === 5 &&
        parts[0] === "api" &&
        parts[1] === "batches" &&
        parts[3] === "recordings"
      ) {
        const saved = await saveRecording(
          workspaceRoot,
          storageRoot,
          parts[2]!,
          parts[4]!,
          request
        );
        sendJson(response, 201, saved);
        return;
      }

      if (
        request.method === "GET" &&
        parts.length === 5 &&
        parts[0] === "api" &&
        parts[1] === "batches" &&
        parts[3] === "recordings"
      ) {
        await sendRecording(
          workspaceRoot,
          storageRoot,
          parts[2]!,
          parts[4]!,
          response
        );
        return;
      }

      if (
        (request.method === "GET" || request.method === "HEAD") &&
        (await sendStatic(
          workspaceRoot,
          url.pathname,
          response,
          request.method === "HEAD"
        ))
      ) {
        return;
      }

      sendError(response, 404, "Not found");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const status = code === "ENOENT" ? 404 : 400;
      sendError(
        response,
        status,
        error instanceof Error ? error.message : String(error)
      );
    }
  });
}

export async function startRecorderServer(options?: {
  root?: string;
  storageRoot?: string;
  host?: string;
  port?: number;
}) {
  const root = options?.root ?? process.cwd();
  const storageRoot = options?.storageRoot ?? root;
  const host = options?.host ?? DEFAULT_HOST;
  const port = options?.port ?? DEFAULT_PORT;
  await mkdir(resolve(storageRoot, "corpus", "inbox"), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(resolve(storageRoot, "uploads", "pending"), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(resolve(storageRoot, "published"), {
    recursive: true,
    mode: 0o700,
  });
  const server = createRecorderServer(root, storageRoot);

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolveListen();
    });
  });

  return {
    server,
    url: `http://${host}:${port}`,
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const configuredPort = Number(process.env.RECORDER_PORT ?? DEFAULT_PORT);
  const configuredHost = process.env.RECORDER_HOST ?? DEFAULT_HOST;
  const configuredStorageRoot = process.env.RECORDER_STORAGE_ROOT;
  startRecorderServer({
    host: configuredHost,
    port: configuredPort,
    ...(configuredStorageRoot ? { storageRoot: configuredStorageRoot } : {}),
  })
    .then(({ url }) => {
      console.log(`TypeWhisper recorder: ${url}`);
      console.log("Press Ctrl+C to stop.");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
