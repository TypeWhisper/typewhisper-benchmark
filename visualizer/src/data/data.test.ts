import { describe, expect, it } from "vitest";
import { DEFAULT_STATE, type AppState } from "../lib/url-state";
import { canonicalize, resolveModelId } from "./links";
import { betterFirst, buildColumns, columnValue, pool, resolveColumn, scopedSuites, type Scope } from "./metrics";
import { modelMeta, prettifyModel } from "./model-meta";
import type { Summary, SuiteInfo } from "./types";

const suite = (patch: Partial<SuiteInfo>): SuiteInfo => ({
  name: "Suite",
  description: "",
  language: "en",
  category: "clean-speech",
  tier: "core",
  origin: "synthetic",
  clips: 10,
  scores: [],
  references: true,
  ...patch,
});

const summary: Summary = {
  schema: 1,
  version: "test",
  generatedAt: "2026-10-29T00:00:00.000Z",
  suites: {
    "clean-speech-en": suite({ name: "Clean (EN)" }),
    "accented-speech-en": suite({ name: "Accented (EN)", category: "accented-speech", origin: "public" }),
    "hard-en": suite({ name: "Hard (EN)", tier: "diagnostic", category: "technical-jargon" }),
    "clean-speech-de": suite({ name: "Clean (DE)", language: "de" }),
    "punctuation-formatting-en": suite({ name: "Punct (EN)", category: "punctuation-formatting", scores: ["p", "f"] }),
    "number-formatting-de": suite({ name: "Numbers (DE)", language: "de", category: "number-formatting", scores: ["dg"] }),
  },
  models: {
    "fluidaudio:parakeet-ultra": { provider: "fluidaudio", model: "parakeet-ultra", type: "local", file: "fluidaudio_parakeet-ultra.json", runs: 1 },
    "sherpa-onnx:parakeet-tdt-0.6b": { provider: "sherpa-onnx", model: "parakeet-tdt-0.6b", type: "local", file: "sherpa-onnx_parakeet-tdt-0.6b.json", runs: 1 },
    "acme:parakeet-tdt-0.6b": { provider: "acme", model: "parakeet-tdt-0.6b", type: "cloud", file: "acme_parakeet-tdt-0.6b.json", runs: 3 },
  },
  cells: {
    "fluidaudio:parakeet-ultra": {
      "clean-speech-en": { n: 10, ok: 10, wer: 0.1, cer: 0.05, ms: 50 },
      "accented-speech-en": { n: 10, ok: 10, wer: 0.9, cer: 0.8, ms: 70 },
      "hard-en": { n: 30, ok: 30, wer: 0.3, cer: 0.1, ms: 60 },
      "punctuation-formatting-en": { n: 20, ok: 20, wer: 0.2, cer: 0.1, ms: 40, p: 0.5, pn: 20, f: 0.8, fn: 20 },
      "clean-speech-de": { n: 10, ok: 0, skip: 10 },
      "number-formatting-de": { n: 10, ok: 0, skip: 10 },
    },
    "acme:parakeet-tdt-0.6b": {
      "clean-speech-en": { n: 30, ok: 30, wer: 0.2, cer: 0.1, ms: 900, sec: 4, usd: 0.24 },
    },
  },
};

const state = (patch: Partial<AppState>): AppState => ({ ...DEFAULT_STATE, ...patch });

describe("resolveModelId", () => {
  it("accepts canonical ids, file stems and unique model names", () => {
    expect(resolveModelId(summary, "fluidaudio:parakeet-ultra")).toBe("fluidaudio:parakeet-ultra");
    expect(resolveModelId(summary, "FluidAudio:Parakeet-Ultra")).toBe("fluidaudio:parakeet-ultra");
    expect(resolveModelId(summary, "fluidaudio_parakeet-ultra")).toBe("fluidaudio:parakeet-ultra");
    expect(resolveModelId(summary, "parakeet-ultra")).toBe("fluidaudio:parakeet-ultra");
  });

  it("refuses ambiguous or unknown names", () => {
    expect(resolveModelId(summary, "parakeet-tdt-0.6b")).toBeNull();
    expect(resolveModelId(summary, "nope:nothing")).toBeNull();    // Names that exist on every object must not resolve to Object.prototype members.
    expect(resolveModelId(summary, "constructor")).toBeNull();
    expect(resolveModelId(summary, "toString")).toBeNull();
  });
});

describe("canonicalize", () => {
  it("rewrites aliases, drops unknown models and unknown categories", () => {
    const result = canonicalize(
      summary,
      state({ view: "compare", models: ["parakeet-ultra", "x:y", "acme_parakeet-tdt-0.6b", "fluidaudio:parakeet-ultra"], cat: "made-up" })
    );
    expect(result.state.models).toEqual(["fluidaudio:parakeet-ultra", "acme:parakeet-tdt-0.6b"]);
    expect(result.state.cat).toBeNull();
    expect(result.dropped).toEqual(["x:y"]);
  });

  it("drops prototype names from model and suite links", () => {
    const result = canonicalize(summary, state({ view: "compare", models: ["constructor", "parakeet-ultra"], suite: "constructor" }));
    expect(result.state.models).toEqual(["fluidaudio:parakeet-ultra"]);
    expect(result.dropped).toEqual(["constructor"]);
    expect(result.state.suite).toBeNull();
  });

  it("keeps an unknown model on its own page so the page can name it", () => {
    expect(canonicalize(summary, state({ view: "model", model: "x:y" })).state.model).toBe("x:y");
  });
});

describe("scope and columns", () => {
  const scope = (patch: Partial<Scope> = {}): Scope => ({ tier: "core", cat: null, origin: "all", acc: false, ...patch });

  it("leaves accented speech and diagnostic suites out by default", () => {
    expect(scopedSuites(summary, scope(), "en")).toEqual(["clean-speech-en", "punctuation-formatting-en"]);
    expect(scopedSuites(summary, scope({ acc: true }), "en")).toContain("accented-speech-en");
    expect(scopedSuites(summary, scope({ cat: "accented-speech" }), "en")).toEqual(["accented-speech-en"]);
    expect(scopedSuites(summary, scope({ tier: "all" }), "en")).toContain("hard-en");
  });

  it("builds the PR columns for all languages and detail columns for one", () => {
    expect(buildColumns(summary, state({})).map((column) => column.id)).toEqual(["wer-en", "wer-de", "punct-en", "digits-de", "ms", "speed"]);
    expect(buildColumns(summary, state({ lang: "en" })).map((column) => column.id)).toEqual(["wer", "cer", "punct", "ms", "rtf", "speed"]);
  });

  it("resolves sort ids across the two forms", () => {
    const all = buildColumns(summary, state({}));
    const de = buildColumns(summary, state({ lang: "de" }));
    expect(resolveColumn(all, "wer", "all").id).toBe("wer-en");
    expect(resolveColumn(de, "wer-de", "de").id).toBe("wer");
    expect(resolveColumn(de, "bogus", "de").id).toBe("wer");
  });
});

describe("pooling", () => {
  it("weights each suite by its clip count", () => {
    const cells = summary.cells["fluidaudio:parakeet-ultra"];
    expect(pool(cells, ["clean-speech-en", "punctuation-formatting-en"], "wer").v).toBeCloseTo((0.1 * 10 + 0.2 * 20) / 30);
    expect(pool(cells, ["punctuation-formatting-en"], "punct")).toEqual({ v: 0.5, n: 20 });
  });

  it("computes the price per audio hour from recorded costs", () => {
    // $0.24 for 30 clips of 4 s = 120 s -> $7.20 per hour.
    expect(pool(summary.cells["acme:parakeet-tdt-0.6b"], ["clean-speech-en"], "price").v).toBeCloseTo(7.2);
  });

  it("marks skipped languages and partial coverage", () => {
    const [werEn, werDe] = buildColumns(summary, state({}));
    const de = columnValue(summary, "fluidaudio:parakeet-ultra", werDe);
    expect(de.v).toBeNull();
    expect(de.skipped).toBe(true);
    const partial = columnValue(summary, "acme:parakeet-tdt-0.6b", werEn);
    expect(partial.v).toBeCloseTo(0.2);
    expect(partial.missing).toEqual(["punctuation-formatting-en"]);
  });
});

describe("speed", () => {
  const withSpeed: Summary = {
    ...summary,
    speed: { "fluidaudio:parakeet-ultra": { x: 173.6, short: 38.8, medium: 55, long: 79.7, clips: 30, at: "2026-10-29" } },
  };
  const speed = () => buildColumns(withSpeed, state({})).find((column) => column.id === "speed")!;

  it("reads the speed run, not the accuracy cells", () => {
    const value = columnValue(withSpeed, "fluidaudio:parakeet-ultra", speed());
    expect(value).toMatchObject({ v: 173.6, n: 30, missing: [], outside: false });
    expect(value.detail).toBe("median per clip: short 39 ms, medium 55 ms, long 80 ms · measured 2026-10-29");
    expect(columnValue(withSpeed, "acme:parakeet-tdt-0.6b", speed()).v).toBeNull();
  });

  it("ranks higher speed first", () => {
    expect(betterFirst(speed())).toBe("desc");
  });
});

describe("model metadata", () => {
  it("derives a readable entry for models nobody has described yet", () => {
    expect(prettifyModel("granite-speech-5.0-2b")).toBe("Granite Speech 5.0 2B");
    expect(prettifyModel("qwen3-asr-0.6b-8bit")).toBe("Qwen3 ASR 0.6B 8bit");
    const meta = modelMeta("mlx-audio:whisperx-tiny-q4");
    expect(meta.derived).toBe(true);
    expect(meta.name).toBe("Whisperx Tiny Q4 (MLX Audio)");
    expect(meta.runtime).toBe("mlx-audio (MLX, Python)");
    expect(meta.deployment).toBe("local");
    expect(modelMeta("newcloud:fast", "cloud").deployment).toBe("cloud");
  });

  it("has an entry for the TypeWhisper defaults", () => {
    expect(modelMeta("fluidaudio:parakeet-ultra").tw).toMatchObject({ status: "engine", isDefault: true, plugin: "Parakeet" });
  });
});
