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

Metric version `1` uses Unicode NFKC normalization. WER is word-level
Levenshtein distance after lowercasing and removing punctuation/symbols; CER is
the same normalized edit distance over non-whitespace characters. The scorer
uses the best reviewed verbatim, alternative, or formatted reference so correct
number rendering is not counted as a recognition error. WER and CER are
micro-averaged by reference units. Formatting is character similarity to the
reviewed formatted reference. Number and proper-noun scores are exact annotation
recall (proper nouns remain case-sensitive). Code combines character similarity
to the code reference with exact annotated-token recall. A metric is omitted for
samples without the required annotation.

## Portable execution

`prepare-kit` converts each reviewed source once to mono 16 kHz PCM WAV and
hashes the derived input. The same private kit is copied to each machine. Its
dependency-free Python executor discovers the local TypeWhisper API, selects
the exact per-request engine/model, disables dictionary corrections and number
normalization, verifies every audio hash, measures wall-clock completion, and
writes one external bundle. The runner also records the backend reported after
inference; merely detecting a GPU never turns a CPU run into a CUDA run.
One unscored, attested warm-up request loads the target before latency samples
begin. Configured dictionary-term identity is pinned without putting the terms
themselves in the run bundle. Raw targets additionally require zero recognition
terms and zero correction entries, so backend-specific vocabulary boosting
cannot silently enter a baseline run.

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
