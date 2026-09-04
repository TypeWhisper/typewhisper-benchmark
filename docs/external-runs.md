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

## Upload methods

The protected web interface is available at:

`https://typewhisper-benchmark.hlab.cloud/upload`

For automation on macOS, Windows, or Linux, use the cross-platform Node
uploader from a machine that can pass the reverse proxy protection:

```bash
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
