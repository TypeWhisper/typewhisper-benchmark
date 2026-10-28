import { ArrowRight, X } from "lucide-react";
import { Link } from "../lib/app-state";
import { useAppState } from "../lib/app-state-context";
import { withView } from "../lib/url-state";
import { modelMeta } from "../data/model-meta";
import type { Summary } from "../data/types";
import { seriesColor } from "../lib/series";

/** The models picked for comparison, kept at the bottom of every view except Compare. */
export function CompareTray({ summary }: { summary: Summary }) {
  const { state, navigate } = useAppState();
  const picked = state.models.filter((id) => summary.models[id]);
  if (state.view === "compare" || picked.length === 0) return null;
  const ready = picked.length >= 2;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="wrap">
        <div
          role="region"
          aria-label="Models to compare"
          className="pointer-events-auto mx-auto flex max-w-4xl items-center gap-2 rounded-2xl border border-hairline-strong bg-raised/95 p-2 pl-4 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.45)] backdrop-blur"
        >
          <span className="meta mr-1 hidden sm:inline">Compare</span>
          <ul className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto sm:flex-wrap">
            {picked.map((id) => {
              const meta = modelMeta(id, summary.models[id].type);
              const index = state.models.indexOf(id);
              return (
                <li key={id} className="flex flex-none items-center gap-1.5 rounded-full border border-hairline py-0.5 pr-1 pl-2.5 text-[0.8125rem]">
                  <span className="swatch" style={{ background: seriesColor(index) }} aria-hidden="true" />
                  <span className="max-w-[11rem] truncate">{meta.short}</span>
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-muted hover:bg-surface hover:text-fg"
                    aria-label={`Remove ${meta.name}`}
                    onClick={() => navigate((s) => ({ ...s, models: s.models.filter((model) => model !== id) }), { replace: true })}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="btn btn-ghost hidden px-3 text-muted sm:inline-flex"
            onClick={() => navigate((s) => ({ ...s, models: [] }), { replace: true })}
          >
            Clear
          </button>
          {ready ? (
            <Link to={(s) => withView(s, "compare", { sort: null })} className="btn btn-primary">
              Compare {picked.length}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          ) : (
            <span className="btn pointer-events-none border-dashed text-muted">Pick one more</span>
          )}
        </div>
      </div>
    </div>
  );
}
