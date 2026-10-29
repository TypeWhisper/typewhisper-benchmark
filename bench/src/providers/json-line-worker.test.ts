import { describe, expect, it } from "vitest";
import { JsonLineWorker } from "./json-line-worker.js";

// A worker that answers after `delayMs` with the pid it runs in.
const ECHO_WORKER = `
const rl = require("readline").createInterface({ input: process.stdin });
console.log(JSON.stringify({ ready: true }));
rl.on("line", (line) => {
  const req = JSON.parse(line);
  setTimeout(() => console.log(JSON.stringify({ id: req.id, text: String(process.pid) })), req.delayMs ?? 0);
});
`;

function echoWorker(): JsonLineWorker {
  return new JsonLineWorker("echo", async () => ({ file: process.execPath, args: ["-e", ECHO_WORKER] }));
}

describe("JsonLineWorker", () => {
  it("runs requests one at a time, so a deadline counts only the request's own work", async () => {
    const worker = echoWorker();
    try {
      const first = worker.request({ delayMs: 300 }, 1_000);
      const second = worker.request({ delayMs: 300 }, 400);
      const [a, b] = await Promise.all([first, second]);
      expect(a.error).toBeUndefined();
      expect(b.error).toBeUndefined();
      expect(a.text).toBe(b.text);
    } finally {
      worker.dispose();
    }
  });

  it("stops a worker past the deadline and starts a fresh one for the next request", async () => {
    const worker = echoWorker();
    try {
      const before = process.listenerCount("exit");
      const first = await worker.request({ delayMs: 0 }, 2_000);
      const late = await worker.request({ delayMs: 1_000 }, 100);
      expect(late.error).toMatch(/did not answer/);
      const next = await worker.request({ delayMs: 0 }, 2_000);
      expect(next.error).toBeUndefined();
      expect(next.text).not.toBe(first.text);
      await new Promise((r) => setTimeout(r, 100));
      // The stopped worker's exit listener is gone; only the running one's remains.
      expect(process.listenerCount("exit")).toBeLessThanOrEqual(before + 1);
    } finally {
      worker.dispose();
    }
  });
});
