# Parakeet probes

Two measurements of Parakeet TDT v3 decoding ideas. They run outside the benchmark runner. They call
FluidAudio the way TypeWhisper's Parakeet plugin does: same FluidAudio release (0.17.5),
`ASRConfig(melChunkContext: true)`, clips padded to 1 s, a fresh decoder state per clip.

```sh
cd bench/fluidaudio-worker && swift build -c release --product ParakeetProbe && cd ..
./probe/generate-vocabulary-audio.sh   # renders probe/vocabulary-en.json with macOS say
./probe/run-all.sh                     # writes results/probe/<date>/
```

The models must already be in `~/Library/Application Support/FluidAudio/Models`
(`parakeet-tdt-0.6b-v3`, plus `parakeet-ctc-110m-coreml` for boosting). TypeWhisper puts them there.

## padding

Runs two extra decodes in parallel with the normal one, with 0.5 s and 1.0 s of silence before and
after the clip. TDT can skip up to 320 ms of audio in one step. Padding shifts the frame grid, so
an extra decode may hear words the first one skipped. Two rules decide when an extra decode wins:

- **tail rule:** the extra decode repeats the first one and adds words at the end. ParrotFlow uses this.
- **subsequence rule:** every word of the first decode survives, in order, and extra words may be anywhere.

Clips that need more than one encoder window are skipped.

## boosting

Decodes each clip once, then applies Vocabulary Boosting like `ParakeetPlugin.applyVocabularyRescoringIfNeeded`:
CTC 110M keyword spotting, `ctcTokenRescore`, `spotterRescueEnabled: false`, weight 10, and the
`removesTextAroundExistingTerm` guard. `--similarity` sets each term's `ctcMinSimilarity`
(`auto` = none, `0.80` = Precise, which term packs use).

The result splits clips by whether the ground truth contains a term. For clips without one, any
change is damage. `probe/vocabulary-en.json` has sentences with each term and sentences with
ordinary words that sound like one ("super base", "ray cast", "grandpa").

### Guard rules

`VocabularyGuard.swift` holds a guard proposed for the plugin. It diffs the transcript before and
after rescoring and checks each changed span against `NSSpellChecker` (dictation language plus
English). The probe reports three rules next to plain boosting:

- **strict:** refuse a change if any word it rewrites is known.
- **lenient:** refuse a change only if every word it rewrites is known.
- **contained:** lenient, and a known word may only disappear into a term that spells it
  ("SQL" in PostgreSQL). This is the rule the plugin uses.

A change that only joins or recases words ("type whisper" → TypeWhisper) is always kept.

Results on 2026-10-26, 12 developer terms, Automatic threshold:

| Set | Clips | Boosting changed / worse | Contained changed / worse | Terms written (off → boosting → contained) |
|---|---|---|---|---|
| English, with a term | 28 | 11 / 0 | 10 / 0 | 16 → 27 → 26 of 28 |
| English, without a term | 352 | 16 / 15 | 1 / 1 | – |
| German, without a term | 261 | 21 / 20 | 0 / 0 | – |

The one change left is "ray cast" → Raycast, which sounds the same as the term.

### German medicine term pack

Results on 2026-11-14, the 256 terms of `probe/terms-german-medicine.txt`, Precise (`--similarity 0.80`),
on the two German medical suites. Score them with `npx tsx probe/score-terms.ts <records.jsonl>`.
Terms is the share of each clip's key terms written correctly (see `src/metrics/terms.ts`).

| Suite | Clips | Off: WER / terms | Boosting: WER / terms | Changed |
|---|---|---|---|---|
| Dictation (TTS, discharge letters) | 60 | 12.3% / 68.6% | 9.1% / 80.1% | 18 |
| MultiMed (doctor-patient dialogue) | 203 | 8.3% / 83.1% | 8.3% / 83.3% | 3 |

Of the 101 pack terms in the references, boosting writes 90 instead of 67, and makes one clip
worse. About a third of the dictation key terms are not in the pack, so boosting cannot reach
them. All three guard rules give the same result as plain boosting here.
