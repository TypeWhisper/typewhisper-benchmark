# Result Visualizer

The result visualizer is part of the same service as recording and external
run intake. It reads one reviewed snapshot from the persistent
`published/latest.json` path and never aggregates mutable raw artifacts in the
browser.

The `VisualizationSnapshotSchema` in `src/schema.ts` requires:

- snapshot, profile, corpus, and run identities;
- the exact Git commit containing the scorer implementation;
- explicit target names, provider names, model IDs, and revisions;
- language-specific metric aggregates with eligible and total case counts;
- optional language-specific latency summaries.

The UI publishes per-language ranking, coverage, a metric matrix, and median
latency. WER and CER are sorted ascending; formatting, number, proper-noun, and
code scores are sorted descending. A multilingual summary must be produced by
the reviewed publication pipeline rather than calculated from whichever rows
happen to be present in the browser.

When no snapshot exists, the public result area shows the planned languages and
metrics plus an explicit empty state. It must not load old results, guessed
scores, or unlabeled demo data.
