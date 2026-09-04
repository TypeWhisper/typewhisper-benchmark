# External Run Intake

Local model runs may execute on machines that have the required hardware, such
as Apple Silicon on macOS or an NVIDIA CUDA environment on Windows. The result
must be transferred as one JSON bundle; loose transcripts and screenshots are
not accepted as benchmark evidence.

## Bundle contract

An external bundle contains:

- one immutable run manifest with the exact plan digest and Git commit;
- the complete target list;
- operating system, architecture, CPU or accelerator, and runtime versions;
- one raw result event per target, case, and trial, including errors;
- unmodified transcripts and measured timing fields.

The `ExternalRunBundleSchema` in `src/schema.ts` is authoritative. It rejects
run or plan mismatches, result targets absent from the manifest, duplicate
target/case/trial events, and manifest targets without result events.

Every bundle also carries the SHA-256 identity of its run kit. Central scoring
recomputes that identity and requires the exact task set, plan, Git commit,
target, corpus, and profile. A task error makes the target ineligible for a
published snapshot instead of being silently omitted.

## Preparing and running a kit

The catalog may live in the repository while a private corpus/profile stays in
the protected state directory. Prepare one kit per target from a clean commit:

```bash
npm run benchmark -- prepare-kit \
  catalog/catalog.json \
  /private/corpus/manifest.json \
  /private/profiles/pilot.json \
  <target-id> \
  /private/run-kits/<target-id>
```

Copy the complete output directory to the target computer, keep TypeWhisper
running, then execute:

```bash
python3 typewhisper-runner.py --environment-id <stable-machine-id>
```

On Windows use `python` if that is the installed launcher. The runner reads API
discovery locally; credentials are neither copied into the kit nor written to
the result bundle.

After independently reviewing the raw bundle, score one or more target runs:

```bash
npm run benchmark -- score \
  catalog/catalog.json /private/corpus/manifest.json /private/profiles/pilot.json \
  /private/snapshot.json \
  /private/run-kits/mac/run-kit.json /private/results/mac.bundle.json \
  /private/run-kits/windows/run-kit.json /private/results/windows.bundle.json
```

## Upload methods

The protected web interface is available at `/upload` on the configured
deployment host.

For automation on macOS, Windows, or Linux, use the cross-platform Node
uploader from a machine that can pass the reverse proxy protection:

```bash
BENCHMARK_UPLOAD_URL=https://benchmark.example.com \
  npm run upload:run -- path/to/run.bundle.json
```

The endpoint is `POST /api/uploads/runs` with `Content-Type:
application/json`. A successful response includes the SHA-256 digest and
`pending-review` status.

## Trust boundary

Accepted uploads are stored byte-for-byte under the persistent
`uploads/pending` directory. Uploading the same bytes again is idempotent. An
upload never changes the visualizer and never becomes a published result by
itself. Promotion into a visualization snapshot requires a separate review of
plan identity, target configuration, corpus completeness, environment, errors,
and raw artifacts.
