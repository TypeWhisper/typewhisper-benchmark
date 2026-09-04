# TypeWhisper Benchmark

This repository is being rebuilt from first principles. Previous benchmark
results, caches, corpora, rankings, and derived data are intentionally not part
of the new system and must not be treated as evidence.

## Trust rules

- Every admitted audio sample has a verified transcript, source, rights record,
  and SHA-256 digest.
- Self-recorded clips and licensed web references are supported explicitly.
- Web audio is frozen locally; benchmark runs never depend on a mutable URL.
- A benchmark target identifies the adapter, upstream model, model revision,
  runtime, and inference parameters. A model name alone is not a target.
- Run plans are content-addressed. Changes to the corpus, profile, metrics,
  adapter protocol, model revision, or target configuration produce a new plan.
- Raw run artifacts are append-only. Published rankings are generated snapshots,
  never mutable source data.
- A target is eligible for comparison only when it completes the required
  profile without silently dropping unsupported cases.

## Evaluation dimensions

The initial benchmark evaluates word error rate (WER), character error rate
(CER), formatting, numbers, proper nouns, and code dictation. These dimensions
are declared in profile and sample metadata rather than inferred from filenames.

Core v1 covers `de-DE`, `en-US`, `ja-JP`, `zh-CN`, `fr-FR`, and `es-ES`.
German and English are the initial anchor packs; the other languages begin as
native-reviewed coverage packs.

## Current status

The repository contains the V2 foundation, a protected recording room, private
corpus admission, portable macOS/Windows run kits, metric scoring, external run
intake, and a snapshot-driven result visualizer. The public corpus remains
empty because the first self-recorded German pilot is private. Two locally
verified Parakeet v3 targets are catalogued; a pilot result is not a final
benchmark ranking.

## Commands

```bash
npm install
npm run check
npm run benchmark -- validate
npm run recorder
npm run benchmark -- --help
```

See [docs/architecture.md](docs/architecture.md) for the design.
Corpus contribution examples are documented in
[docs/corpus-authoring.md](docs/corpus-authoring.md).
The planned recording mix is in [docs/corpus-plan.md](docs/corpus-plan.md), and
web-source admission is defined in
[docs/web-audio-policy.md](docs/web-audio-policy.md).
External bundles and their review boundary are documented in
[docs/external-runs.md](docs/external-runs.md). The visualizer contract and
deployment layout are in [docs/visualizer.md](docs/visualizer.md) and
[docs/deployment.md](docs/deployment.md).
