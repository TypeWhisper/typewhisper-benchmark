# Core v1 Corpus Plan

Core v1 is multilingual from the start. German and US English are the anchor
packs. Japanese, Simplified Mandarin, French, and Spanish begin as coverage
packs and can be expanded without changing the identity of existing cases.

## Planned size

| Language | Locale | Tier | Self-recorded | Web reference | Total |
| --- | --- | --- | ---: | ---: | ---: |
| German | `de-DE` | anchor | 40 | 20 | 60 |
| English | `en-US` | anchor | 40 | 20 | 60 |
| Japanese | `ja-JP` | coverage | 16 | 12 | 28 |
| Mandarin Chinese, Simplified | `zh-CN` | coverage | 16 | 12 | 28 |
| French | `fr-FR` | coverage | 16 | 12 | 28 |
| Spanish | `es-ES` | coverage | 16 | 12 | 28 |
| **Total** |  |  | **144** | **88** | **232** |

The concrete self-recorded prompts live in
`corpus/recording-plan.v1.json`. The plan remains `draft` until every prompt
and formatted reference has been checked by a native speaker for its declared
locale.

## Capability allocation

Each anchor language contains eight everyday-dictation, eight formatting,
eight number, six proper-noun, six code, and four mixed-hard prompts. Each
coverage language starts with three everyday-dictation, three formatting,
three number, two proper-noun, three code, and two mixed-hard prompts.

WER and CER apply to all cases. Formatting, number, proper-noun, and code
metrics apply only to their annotated spans or references. A category label
does not disable other applicable annotations.

## Recording protocol

- Record one natural take per case. Do not read punctuation that is absent from
  `spokenText`; code prompts intentionally contain spoken punctuation words.
- Preserve the original recording. Trimming leading and trailing silence is
  allowed, but denoising, dynamic compression, voice isolation, speed changes,
  and lossy re-encoding are not allowed for the canonical file.
- Aim for 5-20 seconds per clip and one primary speaker.
- Anchor packs require at least four speakers and three capture setups. No
  speaker may contribute more than 40 percent of an anchor pack.
- Coverage packs may begin with two speakers, but they remain diagnostic until
  they reach four speakers. No speaker may contribute more than 60 percent of
  a coverage pack.
- Include quiet-room, ordinary laptop or phone, headset, and mild real-world
  background conditions. Record the actual device and environment rather than
  assigning a guessed label later.
- A speaker and a different native reviewer must confirm the verbatim and
  formatted references before a recording enters the corpus manifest.

## Reporting rules

Publish every metric per language and capability before any aggregate. The
headline multilingual aggregate must macro-average language scores so the
larger anchor packs cannot dominate it. Coverage packs are visibly marked as
diagnostic until their speaker and review gates are complete.

Do not compare a model on a language it does not officially support. Missing
language results are reported as unsupported or unavailable, never as a zero
score and never silently omitted from an aggregate.

