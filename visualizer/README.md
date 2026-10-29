# TypeWhisper STT Benchmark visualizer

The static site at <https://typewhisper.github.io/typewhisper-benchmark/>: leaderboards, model-vs-model
comparisons, model and suite pages, and the transcripts behind every score. React, Vite, Tailwind,
plain SVG charts. GitHub Pages deploys it from `main` (`.github/workflows/deploy.yml`).

## Commands

Run from the repository root (npm workspaces):

```bash
npm ci
npm run dev --workspace=visualizer      # builds the data, then serves http://localhost:5173/typewhisper-benchmark/
npm run build --workspace=visualizer    # data + type check + production build in visualizer/dist
npm run preview --workspace=visualizer  # serves dist under the same base path
npm run lint --workspace=visualizer
npm run test --workspace=visualizer     # URL state, data build, pooling, word diff
```

## Data

The runner (`bench/src/runner.ts`) writes one file per model to `public/data/results/<providerId>_<model>.json`.
Those files are the source of truth and are not changed here.

`scripts/build-data.mjs` runs before `dev` and `build` and writes two gitignored outputs to
`public/data/generated/`:

| File | Size | Loaded |
|---|---|---|
| `summary.json` | ~130 KB (~22 KB gzipped) | on first paint |
| `clips/<suiteId>.json` | 50–950 KB each | only when a view shows that suite's transcripts |

`summary.json` keeps, per model and suite, the mean WER, CER, punctuation, formatting, Digits, ms/clip and RTF
together with the clip counts behind each mean, so the browser pools any set of suites over clips, the way the
PR tables do. The clip files hold the references from `bench/tests/` and the first run's transcript per model.

New result files show up on the next build without code changes. A new suite needs nothing either; its
references appear once `bench/tests/<suiteId>.json` exists.

### Metrics

As in the PR tables (#10, #11):

- **WER / CER <lang>**: mean over ok clips of the core suites of that language. The accented-speech suites are
  left out by default because their references do not match the audio; `acc=1` includes them.
- **CV-EN fmt**: formatting score on `clean-speech-commonvoice-en`.
- **Punct <lang>**: punctuation score on `punctuation-formatting-<lang>`.
- **Digits <lang>**: share of `number-formatting-<lang>` clips in which every number token of the reference
  appears verbatim, as a whole number, in the transcript ("4322" does not count inside "43220"). Adjacent numbers
  such as a phone number's groups may be written without their spaces. PR #11 matched substrings, so a few
  values here are lower than in its table.
- **ms/clip, RTF**: mean over all ok clips of the model. Each runtime measures speed its own way.

## Model facts

`src/data/model-meta.ts` holds the hand-maintained facts: name, maker, size, precision, license, languages,
runtime and TypeWhisper status (`engine` with its plugin, `candidate`, `probe`, `reference`). A model without an
entry still appears, with a name derived from its id. Add an entry when a model lands.

## Links

Every view is described by query parameters on the one `index.html`, so Pages needs no routes and every screen
can be shared. Defaults are never written; keys keep a fixed order. Model ids are `<providerId>:<model>`, the
pair in the result file name. Links may also use the file stem (`fluidaudio_parakeet-ultra`) or a model name
only one provider has (`parakeet-ultra`); the app rewrites them to the canonical id. Unknown values fall back to
the defaults, unknown model ids are dropped with a note.

| Parameter | Values | Default |
|---|---|---|
| `view` | `leaderboard`, `compare`, `model`, `suite`, `models`, `suites`, `about` | `leaderboard` |
| `models` | up to six model ids, comma-separated (compared, or highlighted elsewhere) | – |
| `model` | one model id; alone it opens the model page | – |
| `suite` | suite id; alone it opens the suite page | – |
| `clip` | clip id inside `suite` | – |
| `lang` | `all`, `en`, `de`, `ru`, `auto` | `all` |
| `tier` | `core`, `diagnostic`, `all` | `core` |
| `cat` | suite category, e.g. `noisy-environment` | every category |
| `origin` | `all`, `public` (real recordings), `synthetic` | `all` |
| `acc` | `1` includes the accented-speech suites | left out |
| `deploy` | `all`, `local`, `cloud` | `all` |
| `tw` | `all`, `engine`, `candidate` | `all` |
| `q` | model search | – |
| `sort` | column: `wer`, `cer`, `punct`, `fmt`, `digits`, `ms`, `rtf`, `price`; with `lang=all` also `wer-en`, `punct-de`, `digits-en`, … | WER |
| `dir` | `asc`, `desc`; only written when it is not best-first | best first |
| `metric` | metric of the ranked chart, same ids as `sort` | the sort column |
| `group` | `suite`, `category` (compare breakdown) | `suite` |

Examples (prefix `https://typewhisper.github.io/typewhisper-benchmark/`):

- `?view=compare&models=fluidaudio:parakeet-ultra,crispasr:cohere-transcribe-q5_0,mlx-audio:granite-speech-5.0-2b&lang=de&sort=wer`
- `?lang=de&tw=engine&metric=punct`
- `?view=suite&suite=clean-speech-mls-de&clip=mls-de-3588_1614_000001`
- `?model=parakeet-ultra`

Filter, sort and search changes replace the history entry; opening another page pushes one, and back/forward
restore the view.

## Layout

```
scripts/build-data.mjs      result files -> public/data/generated/
src/lib/url-state.ts        query parameter schema (parse, serialize)
src/lib/app-state.tsx       state <-> URL sync, <Link>
src/data/metrics.ts         scope, columns, pooling, standings
src/data/model-meta.ts      hand-maintained model facts
src/data/links.ts           alias resolution, page titles
src/views/                  one file per view
src/components/charts/      scatter, ranked bars (SVG/HTML, no chart library)
src/components/Transcripts.tsx  word-level transcript diffs
```
