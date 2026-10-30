import type { ReactNode } from "react";
import { Link } from "../lib/app-state";
import { DEFAULT_STATE, withView, type AppState } from "../lib/url-state";
import type { Summary } from "../data/types";
import { PageHead } from "../components/ui";
import { hasKey } from "../data/links";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-hairline py-8 md:grid-cols-[14rem_minmax(0,1fr)]">
      <h2 className="text-[1.0625rem] font-semibold">{title}</h2>
      <div className="flex max-w-[46rem] flex-col gap-3 text-[0.9375rem] leading-relaxed text-muted [&_strong]:font-medium [&_strong]:text-fg">
        {children}
      </div>
    </section>
  );
}

const PARAMS: Array<[string, string, string]> = [
  ["view", "leaderboard · compare · model · suite · models · suites · about", "leaderboard"],
  ["models", "Up to six model ids, comma-separated: compared, or highlighted elsewhere", "–"],
  ["model", "One model id (model page)", "–"],
  ["suite", "Suite id, e.g. clean-speech-mls-de (suite page, transcripts)", "–"],
  ["clip", "Clip id inside the suite, e.g. de-clean-01", "–"],
  ["lang", "all · en · de · ru · auto", "all"],
  ["tier", "core · diagnostic · all", "core"],
  ["cat", "Suite category, e.g. noisy-environment", "every category"],
  ["origin", "all · public (real recordings) · synthetic", "all"],
  ["acc", "1 includes the accented-speech suites", "left out"],
  ["deploy", "all · local · cloud", "all"],
  ["tw", "all · engine · candidate (TypeWhisper status)", "all"],
  ["q", "Model search text", "–"],
  ["sort", "Column: wer, cer, punct, fmt, digits, ms, rtf, speed, price; with lang=all also wer-en, punct-de, …", "WER"],
  ["dir", "asc · desc, only when not best-first", "best first"],
  ["metric", "Metric of the ranked chart (same ids as sort)", "the sort column"],
  ["group", "suite · category (compare breakdown)", "suite"],
];

const EXAMPLES: Array<{ label: string; to: (s: AppState) => AppState }> = [
  {
    label: "Parakeet Ultra vs. Cohere Transcribe vs. Granite 5.0 2B on German, ordered by WER",
    to: () =>
      withView({ ...DEFAULT_STATE }, "compare", {
        models: ["fluidaudio:parakeet-ultra", "crispasr:cohere-transcribe-q5_0", "mlx-audio:granite-speech-5.0-2b"],
        lang: "de",
        sort: "wer",
      }),
  },
  {
    label: "German leaderboard, TypeWhisper engines only, ranked by punctuation",
    to: () => ({ ...DEFAULT_STATE, lang: "de", tw: "engine", metric: "punct" }),
  },
  {
    label: "One clip of the MLS German suite with every model's transcript",
    to: () => withView({ ...DEFAULT_STATE }, "suite", { suite: "clean-speech-mls-de", clip: "mls-de-3588_1614_000001" }),
  },
  {
    label: "Parakeet Ultra's page with its Common Voice English transcripts",
    to: () => withView({ ...DEFAULT_STATE }, "model", { model: "fluidaudio:parakeet-ultra", suite: "clean-speech-commonvoice-en" }),
  },
];

export function AboutView({ summary }: { summary: Summary }) {
  const examples = EXAMPLES.filter((example) => {
    const target = example.to(DEFAULT_STATE);
    return (
      [...target.models, ...(target.model ? [target.model] : [])].every((id) => hasKey(summary.models, id)) &&
      (!target.suite || summary.suites[target.suite])
    );
  });
  return (
    <>
      <PageHead
        label="Method"
        title="How the numbers are made."
        lede="Every model transcribes the same clips; the runner scores each transcript against its reference and stores one result file per model. This site pools those files at build time."
      />
      <div className="wrap">
        <Block title="Word error rate">
          <p>
            <strong>WER</strong> counts substituted, missing and extra words against the reference, divided by the
            reference's word count. It is <strong>normalized</strong>: case and punctuation are ignored and number words
            count as digits, so “three hundred fifty-two” matches “352”. <strong>CER</strong> does the same per character.
            Lower is better.
          </p>
          <p>
            A language's WER pools the clips of its <strong>core suites</strong> (mean over clips, not over suites). Models
            that ran fewer of those suites are marked with an asterisk, because their average covers different clips.
          </p>
          <p>
            The <strong>accented-speech</strong> suites are left out by default. Their references do not match the audio
            (found in PR #4 and #6), so every model scores about 90% there. Include them with the checkbox, or{" "}
            <code className="font-mono text-fg">acc=1</code> in a link, to reproduce the WER columns of the PR tables.
          </p>
        </Block>
        <Block title="Dictation scores">
          <p>
            <strong>Punct</strong>: the punctuation score on the Punctuation &amp; Formatting suite of that language.{" "}
            <strong>CV-EN fmt</strong>: the formatting score (case, punctuation, digits) on Common Voice English, real voices
            with formatted references. Higher is better.
          </p>
          <p>
            <strong>Digits</strong>: the share of Number Formatting clips in which every number of the reference (“2,400”,
            “2:30”, “15th”) appears exactly as written there, as a whole number: “4322” does not count inside “43220”.
            The groups of a phone number may be written without their spaces. The normalized WER forgives spelled-out
            numbers; this shows what a dictation user would see. PR #11 matched substrings, so a few values here are
            lower than in its table; PR #10 used a different definition.
          </p>
        </Block>
        <Block title="Speed">
          <p>
            <strong>ms/clip</strong> is the mean time per clip over all of a model's clips; <strong>RTF</strong> divides
            processing time by audio length. Both are measured inside each runtime: the FluidAudio and MLX workers time
            the model call after loading, whisper.cpp starts whisper-cli and reloads the model for every clip,
            CrispASR is timed over a local HTTP round trip, and the cloud APIs include the network.
          </p>
          <p>
            Compare these within a runtime with confidence, and across runtimes as rough orders of magnitude. Local models
            ran on Apple silicon (an M5 Pro in the recent runs).
          </p>
          <p>
            <strong>Speed</strong> is a separate, controlled measurement of local models, like the speed factor of
            Artificial Analysis: seconds of audio transcribed per second (higher is better). Every model transcribes the
            same 30 English clips, ten each of 3–6.5 s, 8–12 s and 12.5–20 s, on one reference machine, a Mac mini with
            an M5 Pro and 48 GB. Models run one at a time and one clip at a time, never next to another benchmark, and
            only once the machine is idle. After loading the model and three untimed warm-up clips, three timed passes
            run over the set; each clip counts with its median time. Times are wall-clock from handing the audio file to
            the runtime until the text comes back, the same for every runtime. Hover a value for the median time of a
            short, medium and long clip, which is what a dictation waits for. Cloud APIs are not measured, and neither
            are whisper.cpp and Apple Speech, which this harness starts anew for every clip.
          </p>
        </Block>
        <Block title="Runs and transcripts">
          <p>
            Some models ran every clip three times, most once. Scores average all runs; the transcript explorers show the
            first run. Transcript marks compare words after lowercasing and removing punctuation, so they can flag a few
            differences the normalized WER forgives.
          </p>
          <p>
            Model facts (maker, size, license, TypeWhisper status) are maintained by hand. Models added to the benchmark
            later appear automatically, with a name derived from their id until someone describes them.
          </p>
        </Block>
        <Block title="Share links">
          <p>
            Every view lives in the address bar, so copying the address shares exactly what you see. Model ids are{" "}
            <code className="font-mono text-fg">provider:model</code>, as in the result file names
            (<code className="font-mono text-fg">fluidaudio_parakeet-ultra.json</code> →{" "}
            <code className="font-mono text-fg">fluidaudio:parakeet-ultra</code>). Unknown values fall back to the
            defaults, and a model id that is not in the data is skipped with a note.
          </p>
          <ul className="flex flex-col gap-2">
            {examples.map((example) => (
              <li key={example.label}>
                <Link to={example.to} className="link">
                  {example.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="table-scroll mt-2">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Parameter</th>
                  <th scope="col">Values</th>
                  <th scope="col">Default</th>
                </tr>
              </thead>
              <tbody>
                {PARAMS.map(([key, values, fallback]) => (
                  <tr key={key}>
                    <td className="font-mono text-fg">{key}</td>
                    <td>{values}</td>
                    <td className="whitespace-nowrap">{fallback}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Block>
        <Block title="Data">
          <p>
            Raw results: one JSON file per model in{" "}
            <a className="link" href="https://github.com/TypeWhisper/typewhisper-benchmark/tree/main/visualizer/public/data/results">
              visualizer/public/data/results
            </a>
            . Suites and references:{" "}
            <a className="link" href="https://github.com/TypeWhisper/typewhisper-benchmark/tree/main/bench/tests">
              bench/tests
            </a>
            . The pull requests describe each run in detail.
          </p>
        </Block>
      </div>
    </>
  );
}
