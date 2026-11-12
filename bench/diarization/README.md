# Diarization benchmark

Measures speaker diarization ("who spoke when") of the engines TypeWhisper ships or could ship, on
macOS, Windows and iOS, against the same files and scored by the same code.

## Set

`diarization-set.json` (`diarization-v1`) lists 54 files with their checksums:

| Group | Files | Audio | What it tests |
|---|---|---|---|
| `ami-array` | 16 AMI test meetings, table microphone array (`Array1-01`) | 9.1 h | A phone or laptop on a meeting table: far field, overlap |
| `ami-headset` | the same meetings, mixed close-talk headsets (`Mix-Headset`) | 9.1 h | Clean meeting audio; what most published AMI numbers use |
| `synthetic` | 22 conversations from VoxPopuli parliament speech (CC0), de, en, fr, es, it and de-en, 2 to 6 speakers, 0.9 to 8 min | 1.1 h | Speaker counts and languages, no overlap |

Audio: `bench/scripts/download-diarization-set.sh` downloads it to `bench/audio/datasets/diarization`
(AMI from the University of Edinburgh mirror, the synthetic conversations from the
`diarization-set-v1` release asset). `make-diarization-synthetic.py` rebuilds the synthetic
conversations from VoxPopuli with the same seed.

## References

In `references/`:

- `ami/only-words/` and the UEMs in `ami/`: [pyannote/AMI-diarization-setup](https://github.com/pyannote/AMI-diarization-setup)
  (a fork of BUTSpeechFIT/AMI-diarization-setup, Apache-2.0), `only_words` test RTTMs. Word intervals from the
  manual annotation; a short pause inside a turn counts as speech.
- `ami/forced-alignment/`: [nttcslab-sp/diar-forced-alignment](https://github.com/nttcslab-sp/diar-forced-alignment),
  AMI test RTTMs (CC BY 4.0, Horiguchi et al., ASRU 2025). Montreal Forced Aligner word boundaries, much tighter.
  NVIDIA's model card for Nemotron 3 Diarization scores against these.
- `synthetic/`: exact utterance boundaries, written by `make-diarization-synthetic.py`.

An engine trained on one AMI convention scores better on it, so AMI is scored against both.
Speaker confusion depends least on the convention and matters most for a transcript: it is the share of
speech given to the wrong person.

## Scoring

`src/diarization/der.ts`, checked against `pyannote.metrics` (identical to three decimals):
overlapping speech counts, only the UEM region is scored (the whole file for the synthetic set), optimal
one-to-one speaker mapping, collar 0 and 0.25 s on each side of every reference boundary.
A group's DER pools all its files: summed error time over summed reference speech. A failed or missing file
counts as all speech missed.

Speaker count is right when the number of distinct hypothesis labels equals the reference's.
The speed factor is audio seconds per second of processing, measured on that platform's machine; it compares
engines on one machine, not machines.

## Running

```bash
bench/scripts/download-diarization-set.sh           # from the repository root
cd bench
npm run bench -- diarization                         # all macOS engines, scored
npm run bench -- diarization -e nemotron3-fast32     # one engine
npm run bench -- diarization -i synthetic/de         # a quick partial run (written to bench/results)
npm run bench -- diarization-score                   # rescore every platform's hypotheses
```

## Hypothesis files

Each platform writes one file per engine configuration to `hypotheses/<platform>/<engineId>.json`; the
scorer writes the reports to `visualizer/public/data/diarization/<platform>/<engineId>.json`. Only the
hypothesis files are produced on Windows and iOS; scoring always happens here. The Windows runner is in
`../diarization-windows`.

```jsonc
{
  "schema": 1,
  "setId": "diarization-v1",
  "platform": "windows",                      // "macos" | "windows" | "ios"
  "engineId": "sherpa-onnx-eres2net",         // lower-case [a-z0-9._-], unique per platform
  "engineName": "Sherpa ONNX pyannote segmentation + ERes2Net",
  "runtime": "sherpa-onnx 2.0.1",             // runtime and version
  "model": "pyannote-segmentation-3.0 + 3dspeaker ERes2Net base",
  "shipped": false,                           // does a TypeWhisper app use this engine today?
  "settings": { "clusteringThreshold": 0.7, "executionProvider": "cpu" },
  "machine": { "model": "…", "chip": "AMD Ryzen 9 7950X", "memoryGb": 64, "os": "Windows 11 26200", "accelerator": "NVIDIA RTX 4090" },
  "measuredAt": "2026-11-11T10:00:00.000Z",
  "prepareMs": 1234.5,                        // model load before the first file, without downloads
  "items": [
    {
      "id": "ami/ES2004a/array",              // set item id
      "turns": [[0.48, 2.1, "S0"], [2.3, 7.9, "S1"]],   // [start s, end s, speaker label]
      "processingMs": 9876.5,                 // from handing over the file to getting turns back
      "peakMemoryMb": 812                     // optional
    },
    { "id": "ami/ES2004b/array", "turns": [], "processingMs": 0, "error": "out of memory" }
  ]
}
```

Rules: run every item of the set, one file at a time, with one engine loaded at a time. Give the engine
the 16 kHz WAV as it is. Do not pass the reference speaker count. Labels only need to be consistent within
a file.
