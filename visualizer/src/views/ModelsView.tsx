import { useAppState } from "../lib/app-state-context";
import { MAX_COMPARE } from "../lib/url-state";
import { allModelIds, matchesModelFilters } from "../data/metrics";
import { modelMeta } from "../data/model-meta";
import type { Summary } from "../data/types";
import { FilterBar } from "../components/FilterBar";
import { DeployBadge, ModelLink, TwBadge } from "../components/model-bits";
import { runtimeShort } from "../lib/series";
import { PageHead } from "../components/ui";

export function ModelsView({ summary }: { summary: Summary }) {
  const { state, navigate } = useAppState();
  const ids = allModelIds(summary)
    .filter((id) => matchesModelFilters(summary, id, state))
    .map((id) => ({ id, meta: modelMeta(id, summary.models[id].type) }))
    .sort((a, b) => a.meta.org.localeCompare(b.meta.org) || a.meta.name.localeCompare(b.meta.name));
  const engines = allModelIds(summary).filter((id) => modelMeta(id).tw.status === "engine").length;

  return (
    <>
      <PageHead
        label="Models"
        title="Every model in the benchmark."
        lede={`${allModelIds(summary).length} models from ${new Set(allModelIds(summary).map((id) => modelMeta(id).org)).size} makers; ${engines} of them ship in TypeWhisper. The same weights can appear more than once, in different runtimes or precisions.`}
      />
      <FilterBar summary={summary} controls={["deploy", "tw", "q"]} />
      <div className="wrap pt-8">
        <div className="table-scroll -mx-[var(--gutter)] px-[var(--gutter)]">
          <table className="data-table min-w-[64rem]">
            <caption className="visually-hidden">Benchmarked models</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky-col">
                  Model
                </th>
                <th scope="col">Made by</th>
                <th scope="col">Size</th>
                <th scope="col">License</th>
                <th scope="col">Runtime here</th>
                <th scope="col">Languages</th>
                <th scope="col">TypeWhisper</th>
                <th scope="col" className="num">
                  Compare
                </th>
              </tr>
            </thead>
            <tbody>
              {ids.map(({ id, meta }) => {
                const picked = state.models.includes(id);
                return (
                  <tr key={id}>
                    <th scope="row" className="sticky-col font-sans text-[0.875rem] font-normal tracking-normal normal-case">
                      <ModelLink id={id} meta={meta} />
                      <span className="meta block">{id}</span>
                    </th>
                    <td>{meta.org}</td>
                    <td className="whitespace-nowrap">
                      {[meta.params, meta.quant, meta.size].filter(Boolean).join(" · ") || <span className="text-muted">–</span>}
                    </td>
                    <td>{meta.license ?? <span className="text-muted">–</span>}</td>
                    <td>
                      {runtimeShort(id, meta)}
                      <span className="meta block">{meta.runtime}</span>
                    </td>
                    <td className="max-w-[14rem]">{meta.languages ?? <span className="text-muted">–</span>}</td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        <TwBadge meta={meta} />
                        <DeployBadge meta={meta} />
                      </div>
                      {meta.tw.plugin && <span className="meta mt-1 block">{meta.tw.plugin} plugin</span>}
                    </td>
                    <td className="num">
                      <input
                        type="checkbox"
                        className="size-4 accent-[color:var(--primary)]"
                        checked={picked}
                        disabled={!picked && state.models.length >= MAX_COMPARE}
                        aria-label={`Compare ${meta.name}`}
                        onChange={() =>
                          navigate(
                            (s) => ({ ...s, models: picked ? s.models.filter((m) => m !== id) : [...s.models, id].slice(0, MAX_COMPARE) }),
                            { replace: true }
                          )
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {ids.length === 0 && <p className="py-10 text-center text-muted">No model matches these filters.</p>}
      </div>
    </>
  );
}
