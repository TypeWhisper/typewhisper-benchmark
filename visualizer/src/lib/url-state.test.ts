import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATE,
  MAX_COMPARE,
  encodeValue,
  parseState,
  serializeState,
  withView,
  type AppState,
} from "./url-state";

const state = (patch: Partial<AppState>): AppState => ({ ...DEFAULT_STATE, ...patch });

describe("parseState", () => {
  it("returns the defaults for an empty query", () => {
    expect(parseState("")).toEqual(DEFAULT_STATE);
    expect(parseState("?")).toEqual(DEFAULT_STATE);
  });

  it("reads a compare deep link", () => {
    const parsed = parseState(
      "?view=compare&models=fluidaudio:parakeet-ultra,crispasr:cohere-transcribe-q5_0,mlx-audio:granite-speech-5.0-2b&lang=de&sort=wer"
    );
    expect(parsed.view).toBe("compare");
    expect(parsed.models).toEqual([
      "fluidaudio:parakeet-ultra",
      "crispasr:cohere-transcribe-q5_0",
      "mlx-audio:granite-speech-5.0-2b",
    ]);
    expect(parsed.lang).toBe("de");
    expect(parsed.sort).toBe("wer");
    expect(parsed.dir).toBeNull();
  });

  it("decodes percent-encoded ids", () => {
    expect(parseState("?models=fluidaudio%3Aparakeet-ultra%2Cgroq%3Awhisper-large-v3").models).toEqual([
      "fluidaudio:parakeet-ultra",
      "groq:whisper-large-v3",
    ]);
  });

  it("falls back to defaults for unknown values", () => {
    const parsed = parseState("?view=nope&lang=fr&tier=gold&origin=x&deploy=moon&tw=maybe&group=x&dir=up");
    expect(parsed.view).toBe("leaderboard");
    expect(parsed.lang).toBe("all");
    expect(parsed.tier).toBe("core");
    expect(parsed.origin).toBe("all");
    expect(parsed.deploy).toBe("all");
    expect(parsed.tw).toBe("all");
    expect(parsed.group).toBe("suite");
    expect(parsed.dir).toBe("asc");
  });

  it("ignores unknown parameters", () => {
    expect(parseState("?utm_source=reddit&foo=bar&lang=en")).toEqual(state({ lang: "en" }));
  });

  it("accepts values in any case", () => {
    expect(parseState("?LANG=de").lang).toBe("all"); // keys are case-sensitive
    expect(parseState("?lang=DE&view=Compare").lang).toBe("de");
    expect(parseState("?lang=DE&view=Compare").view).toBe("compare");
  });

  it("drops malformed ids, duplicates and anything past the compare limit", () => {
    const ids = Array.from({ length: 9 }, (_, index) => `p:m${index}`);
    const parsed = parseState(`?models=${["p:m0", "<script>", "", " p:m0 ", ...ids].join(",")}`);
    expect(parsed.models).toHaveLength(MAX_COMPARE);
    expect(parsed.models[0]).toBe("p:m0");
    expect(parsed.models).not.toContain("<script>");
    expect(new Set(parsed.models).size).toBe(parsed.models.length);
  });

  it("merges repeated models parameters", () => {
    expect(parseState("?models=a:b&models=c:d").models).toEqual(["a:b", "c:d"]);
  });

  it("rejects ids that are not ids", () => {
    const parsed = parseState("?model=../../etc&suite=a%20b&clip=ok-01&sort=wer;drop");
    expect(parsed.model).toBeNull();
    expect(parsed.suite).toBeNull();
    expect(parsed.clip).toBe("ok-01");
    expect(parsed.sort).toBeNull();
  });

  it("reads acc as a flag", () => {
    expect(parseState("?acc=1").acc).toBe(true);
    expect(parseState("?acc=true").acc).toBe(true);
    expect(parseState("?acc=0").acc).toBe(false);
    expect(parseState("?acc").acc).toBe(false);
  });

  it("infers the view from short links", () => {
    expect(parseState("?model=fluidaudio:parakeet-ultra").view).toBe("model");
    expect(parseState("?suite=clean-speech-mls-de").view).toBe("suite");
    expect(parseState("?view=compare&model=fluidaudio:parakeet-ultra").view).toBe("compare");
  });

  it("limits the search text", () => {
    expect(parseState(`?q=${"x".repeat(200)}`).q).toHaveLength(80);
  });
});

describe("serializeState", () => {
  it("writes nothing for the defaults", () => {
    expect(serializeState(DEFAULT_STATE)).toBe("");
  });

  it("keeps model ids readable", () => {
    expect(
      serializeState(
        state({
          view: "compare",
          models: ["fluidaudio:parakeet-ultra", "crispasr:cohere-transcribe-q5_0"],
          lang: "de",
          sort: "wer",
        })
      )
    ).toBe("view=compare&models=fluidaudio:parakeet-ultra,crispasr:cohere-transcribe-q5_0&lang=de&sort=wer");
  });

  it("writes keys in a stable order", () => {
    const a = serializeState(state({ sort: "ms", lang: "en", view: "suite", suite: "hard-en", acc: true }));
    const b = serializeState(state({ acc: true, suite: "hard-en", view: "suite", lang: "en", sort: "ms" }));
    expect(a).toBe(b);
    expect(a).toBe("view=suite&suite=hard-en&lang=en&acc=1&sort=ms");
  });

  it("encodes free text safely", () => {
    expect(serializeState(state({ q: "whisper & co" }))).toBe("q=whisper%20%26%20co");
    expect(encodeValue("a:b,c d")).toBe("a:b,c%20d");
  });

  it("round-trips every field", () => {
    const full = state({
      view: "suite",
      models: ["a:b", "c:d"],
      model: "a:b",
      suite: "hard-de",
      clip: "de-fast-01",
      lang: "de",
      tier: "all",
      cat: "noisy-environment",
      origin: "public",
      acc: true,
      deploy: "local",
      tw: "engine",
      q: "parakeet",
      metric: "punct",
      sort: "ms",
      dir: "desc",
      group: "category",
    });
    expect(parseState(`?${serializeState(full)}`)).toEqual(full);
  });
});

describe("withView", () => {
  it("clears view-specific fields when the view changes", () => {
    const from = state({ view: "compare", models: ["a:b"], sort: "wer", dir: "desc", suite: "hard-de", lang: "de" });
    const next = withView(from, "model", { model: "a:b" });
    expect(next).toEqual(state({ view: "model", model: "a:b", models: ["a:b"], lang: "de" }));
  });

  it("keeps everything when the view stays", () => {
    const from = state({ view: "compare", sort: "wer" });
    expect(withView(from, "compare", { lang: "en" })).toEqual(state({ view: "compare", sort: "wer", lang: "en" }));
  });
});
