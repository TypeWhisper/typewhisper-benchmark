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

## Current status

The repository contains only the V2 foundation: schemas, catalog validation,
content identities, execution planning, and adapter contracts. The catalog and
corpus are deliberately empty. There are no trusted benchmark results yet.

## Commands

```bash
npm install
npm run check
npm run benchmark -- validate
```

See [docs/architecture.md](docs/architecture.md) for the design.
Corpus contribution examples are documented in
[docs/corpus-authoring.md](docs/corpus-authoring.md).
