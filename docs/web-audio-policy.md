# Web Audio Selection Policy

Web audio adds speech, speakers, accents, and acoustic conditions that the
project does not control. It is reference material, not a shortcut around
corpus review. No candidate is admitted merely because it appears in a public
dataset.

## Admission gates

Every admitted clip must satisfy all of the following:

1. The source permits benchmark use. Redistribution is recorded separately and
   determines whether audio can ship with a public benchmark release.
2. The exact dataset revision or source-page revision, subset, split, sample ID,
   and optional segment boundaries are frozen in the manifest.
3. The downloaded bytes are stored locally and identified by SHA-256. A mutable
   URL or dataset name is not an identity.
4. A human checks the whole clip for truncation, transcript alignment, language,
   speaker count, and non-speech content.
5. A native reviewer produces or verifies the verbatim reference and all
   locale-specific formatting, number, and proper-noun annotations.
6. The clip is 5-20 seconds long, contains one dominant speaker, and does not
   expose sensitive personal information.
7. The clip is not duplicated, near-duplicated, or cut from another admitted
   case. Speaker IDs are tracked when the source provides them.
8. The clip's origin is independent of the model under test. Known benchmark
   contamination or vendor-provided showcase audio is flagged and excluded
   from headline scores.

Reject clips with unclear rights, machine-only transcripts, severe transcript
errors, mostly music, synthetic voices, undisclosed editing, personally
sensitive speech, or a license that forbids the intended publication. Do not
rely on fair-use assumptions.

## Initial source allocation

These are candidate pools, not admitted cases. Importing a clip still requires
the gates above.

| Locale | Common Voice | FLEURS | Wikimedia Commons | LibriSpeech | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| `de-DE` | 10 | 6 | 4 | 0 | 20 |
| `en-US` | 8 | 6 | 4 | 2 | 20 |
| `ja-JP` | 8 | 4 | 0 | 0 | 12 |
| `zh-CN` | 8 | 4 | 0 | 0 | 12 |
| `fr-FR` | 8 | 4 | 0 | 0 | 12 |
| `es-ES` | 8 | 0 | 4 | 0 | 12 |

The target mix for each language should include read and spontaneous speech,
different speakers, at least two capture conditions, hesitation or natural
disfluency, and both clean and moderately difficult audio. Read-speech sources
must not make up the entire web pack.

## Candidate source notes

### Mozilla Common Voice

The Mozilla Data Collective lists Common Voice datasets under CC0 1.0. It is
the primary multilingual source for all six packs. At import time, pin the
exact release, locale, split, and clip ID; do not refer to “latest.” Prefer
validated or test material and sample speaker and accent metadata where it is
available.

Source: <https://commonvoice.mozilla.org/data>

### Google FLEURS

FLEURS is a multilingual read-speech dataset with a CC BY 4.0 dataset card. It
contains the relevant `de_de`, `en_us`, `ja_jp`, `cmn_hans_cn`, and `fr_fr`
configurations. Its Spanish configuration is Latin American Spanish
(`es_419`), so it is not admitted to the `es-ES` pack. Pin a repository commit,
configuration, split, and sample ID, and retain the required attribution.

Sources: <https://research.google/pubs/fleurs-few-shot-learning-evaluation-of-universal-representations-of-speech/>,
<https://huggingface.co/datasets/google/fleurs>

### Wikimedia Commons

Wikimedia Commons can provide natural talks, interviews, and presentations.
Each file has its own license and attribution requirements, and non-copyright
rights may still apply. Review the individual file page, preserve a permanent
revision URL and attribution, and download the frozen file rather than
hotlinking it.

Source: <https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia/en>

### LibriSpeech

OpenSLR publishes LibriSpeech under CC BY 4.0. It is English audiobook speech,
so only two `test-other` samples are used as a difficult read-speech diagnostic;
it is not treated as representative dictation or conversational audio.

Source: <https://www.openslr.org/12/>

## Import record

A public-dataset item must record `datasetVersion`, `subset`, `split`, and
`sampleId`. A page-based web reference must record `url`, `retrievedAt`, and,
when a larger source was clipped, `segment.startMs` and `segment.endMs`. Both
types record the exact license, attribution, terms URL, redistribution status,
local media metadata, and SHA-256 digest.

