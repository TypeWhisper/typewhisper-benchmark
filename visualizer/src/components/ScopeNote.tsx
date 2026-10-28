import { useAppState } from "../lib/app-state-context";
import { ACCENTED, categoryName } from "../data/metrics";

/** Says what the WER columns pool, and offers the accented-speech switch. */
export function ScopeNote() {
  const { state, navigate } = useAppState();
  const tier = state.tier === "all" ? "core and diagnostic" : state.tier;
  const extra = [
    state.cat ? `${categoryName(state.cat).toLowerCase()} only` : null,
    state.origin === "public" ? "real recordings only" : state.origin === "synthetic" ? "synthetic clips only" : null,
  ].filter(Boolean);
  const accentedRelevant = state.cat === null || state.cat === ACCENTED;
  return (
    <p className="note max-w-4xl">
      WER and CER pool the {tier} suites of each language over clips{extra.length ? ` (${extra.join(", ")})` : ""}.{" "}
      {accentedRelevant && state.cat !== ACCENTED && (
        <>
          {state.acc
            ? "Accented-speech suites are included, as in the PR tables; their references do not match the audio, which raises every model's WER. "
            : "Accented-speech suites are left out: their references do not match the audio, so every model scores about 90% there. "}
          <button
            type="button"
            className="link underline decoration-dotted underline-offset-2"
            onClick={() => navigate((s) => ({ ...s, acc: !s.acc }), { replace: true })}
          >
            {state.acc ? "Leave them out" : "Include them"}
          </button>
        </>
      )}
    </p>
  );
}
