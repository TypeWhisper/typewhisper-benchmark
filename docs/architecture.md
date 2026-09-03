# Benchmark V2 Architecture

## Scope

The benchmark answers two related questions in separate tracks:

1. **Dictation:** suitability for interactive TypeWhisper use, eventually
   including streaming latency and partial-result stability.
2. **File transcription:** quality, throughput, and cost for complete audio
   files.

Both tracks can report WER, CER, formatting, number, proper-noun, and code
scores. They do not share an opaque overall score.

## Corpus policy

The corpus is rebuilt without importing previous trust decisions. It may contain:

- recordings created specifically for the benchmark;
- frozen copies of web audio with a stable source URL and documented rights;
- public dataset samples with a pinned dataset version;
- synthetic audio only when clearly labeled and kept separate from real speech.

Every item stores its SHA-256 digest, source, rights, retrieval date when
applicable, a human-verified reference, and explicit evaluation annotations.
Changing any of these fields changes the plan identity.

## Domain model

- **Adapter:** executable integration with a cloud API, local runtime, or system
  service.
- **Model:** upstream model identity and revision, independent of how it runs.
- **Target:** one reproducible adapter/model/runtime/configuration combination.
- **Corpus item:** one reviewed audio file and its reference data.
- **Profile:** an explicit set of corpus items, metrics, mode, and trial count.
- **Plan:** a content-addressed expansion of one profile over eligible targets.
- **Run:** one execution of a plan in a recorded environment.
- **Result event:** append-only outcome for one target, corpus item, and trial.
- **Snapshot:** generated, versioned aggregates for publication.

## Data flow

```text
catalog + corpus + profile
            |
            v
     validated run plan
            |
            v
        adapters
            |
            v
 append-only result events
            |
            v
    one aggregation package
            |
            v
 versioned public snapshots
            |
            v
          website
```

The website displays published snapshots and never calculates rankings itself.

## Metric contract

- **WER:** normalized word-level transcription accuracy.
- **CER:** normalized character-level transcription accuracy.
- **Formatting:** comparison against the reviewed formatted reference.
- **Numbers:** exact and explicitly allowed rendering variants for annotated
  numeric expectations.
- **Proper nouns:** case-aware matching of annotated names and allowed variants.
- **Code:** code-specific WER/CER plus exact annotated token expectations.

Normalization and scoring rules are independently versioned. A profile pins the
metric IDs and versions it requires.

## Planned artifact layout

```text
artifacts/
  runs/<run-id>/
    manifest.json
    results.jsonl
  snapshots/<snapshot-id>/
    manifest.json
    leaderboard.json
```

No V1 artifact has a migration path into a trusted V2 snapshot.
