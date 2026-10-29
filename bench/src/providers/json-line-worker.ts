import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";

export interface WorkerResponse {
  id?: number;
  ready?: boolean;
  text?: string;
  durationMs?: number;
  error?: string;
}

/**
 * A long-lived worker process that reads one JSON request per line on stdin and answers with one
 * JSON line on stdout: first `{"ready": true}`, then `{"id": <n>, ...}` per request. It starts on
 * the first request. Requests run one at a time, so a deadline counts only a request's own work,
 * even when the runner sends several at once. A request that runs past its deadline stops the
 * worker, so the next request starts a fresh one and a stuck clip cannot hold up the clips after it.
 */
export class JsonLineWorker {
  private worker?: ChildProcess;
  private ready?: Promise<void>;
  private pending = new Map<number, (res: WorkerResponse) => void>();
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private label: string,
    private command: () => Promise<{ file: string; args: string[] }>
  ) {}

  /** Sends one request after the earlier ones finished; past the deadline it stops the worker. */
  request(payload: Record<string, unknown>, timeoutMs: number): Promise<WorkerResponse> {
    const run = this.queue.then(() => this.requestNow(payload, timeoutMs));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async requestNow(payload: Record<string, unknown>, timeoutMs: number): Promise<WorkerResponse> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<WorkerResponse>((resolveDeadline) => {
      timer = setTimeout(() => {
        resolveDeadline({ error: `${this.label} worker did not answer within ${timeoutMs / 1000} s` });
        this.dispose();
      }, timeoutMs);
    });
    try {
      return await Promise.race([this.send(payload), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Stops the worker and fails its open requests. */
  dispose(): void {
    const worker = this.worker;
    if (!worker) return;
    for (const resolvePending of this.pending.values()) resolvePending({ error: `${this.label} worker stopped` });
    this.pending.clear();
    this.worker = undefined;
    this.ready = undefined;
    worker.kill();
  }

  private async send(payload: Record<string, unknown>): Promise<WorkerResponse> {
    try {
      await this.start();
    } catch (error) {
      return { error: (error as Error).message };
    }
    const stdin = this.worker?.stdin;
    if (!stdin || stdin.destroyed) return { error: `${this.label} worker is not running` };
    const id = this.nextId++;
    return new Promise((resolvePromise) => {
      this.pending.set(id, resolvePromise);
      this.keepAlive(true);
      stdin.write(JSON.stringify({ id, ...payload }) + "\n", (err) => {
        if (!err) return;
        this.settle(id, { error: `${this.label} worker write failed: ${err.message}` });
      });
    });
  }

  private settle(id: number, res: WorkerResponse): void {
    this.pending.get(id)?.(res);
    this.pending.delete(id);
    if (this.pending.size === 0) this.keepAlive(false);
  }

  /** Keep the benchmark alive while the worker starts or has requests, not once it is idle. */
  private keepAlive(active: boolean): void {
    const handles = [this.worker, this.worker?.stdin, this.worker?.stdout] as any[];
    for (const handle of handles) active ? handle?.ref?.() : handle?.unref?.();
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;

    const ready = this.command().then(
      ({ file, args }) =>
        new Promise<void>((resolveReady, rejectReady) => {
          const worker = spawn(file, args, { stdio: ["pipe", "pipe", "inherit"] });
          this.worker = worker;
          const killOnExit = () => worker.kill();
          process.once("exit", killOnExit);
          const fail = (error: string) => {
            // Settle this start even if the worker was already replaced, so no request waits on it.
            rejectReady(new Error(error));
            process.removeListener("exit", killOnExit);
            // Several events can report the same dead worker; only the current one resets state.
            if (this.worker !== worker) return;
            for (const resolvePending of this.pending.values()) resolvePending({ error });
            this.pending.clear();
            this.worker = undefined;
            this.ready = undefined;
          };
          // A missing binary or a dead pipe must fail the requests, not crash the benchmark.
          worker.on("error", (err) => fail(`${this.label} worker failed to start: ${err.message}`));
          worker.stdin?.on("error", (err) => fail(`${this.label} worker stdin error: ${err.message}`));

          createInterface({ input: worker.stdout! }).on("line", (line) => {
            let res: WorkerResponse;
            try {
              res = JSON.parse(line);
            } catch {
              return; // ignore stray library output
            }
            if (res.ready) {
              if (this.pending.size === 0) this.keepAlive(false);
              resolveReady();
              return;
            }
            if (res.id != null) this.settle(res.id, res);
          });

          worker.on("exit", (code) => fail(`${this.label} worker exited with code ${code}`));
        })
    );
    // A failed start (e.g. a build error) must not stick: the next request tries again.
    ready.catch(() => {
      if (this.ready === ready) this.ready = undefined;
    });
    this.ready = ready;
    return ready;
  }
}
