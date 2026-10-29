import clsx from "clsx";
import { Link } from "../lib/app-state";
import { useAppState } from "../lib/app-state-context";
import { withView } from "../lib/url-state";
import { formatMetric } from "../lib/format";
import { ACCENTED, categoryName, LANGUAGE_ORDER, languageName, median, sortSuiteIds, suiteField } from "../data/metrics";
import { modelMeta } from "../data/model-meta";
import type { Summary } from "../data/types";
import { LanguageSwitch } from "../components/FilterBar";
import { PageHead } from "../components/ui";

export function SuitesView({ summary }: { summary: Summary }) {
  const { state } = useAppState();
  const ids = sortSuiteIds(summary, Object.keys(summary.suites)).filter(
    (id) => state.lang === "all" || summary.suites[id].language === state.lang
  );
  const languages = [...new Set(ids.map((id) => summary.suites[id].language))].sort(
    (a, b) => LANGUAGE_ORDER.indexOf(a) - LANGUAGE_ORDER.indexOf(b)
  );
  const totalClips = ids.reduce((sum, id) => sum + summary.suites[id].clips, 0);

  return (
    <>
      <PageHead
        label="Suites"
        title="What the models were tested on."
        lede={`${ids.length} suites, ${totalClips.toLocaleString("en-US")} clips. Core suites make up the leaderboard; diagnostic suites probe hard cases such as code dictation and language switching.`}
      >
        <div className="mt-6">
          <LanguageSwitch summary={summary} />
        </div>
      </PageHead>
      {languages.map((lang) => (
        <section key={lang} className="wrap" aria-labelledby={`suites-${lang}`}>
          <div className="section">
            <h2 id={`suites-${lang}`} className="section-title mb-5">
              {languageName(lang)}
            </h2>
            <div className="table-scroll -mx-[var(--gutter)] px-[var(--gutter)]">
              <table className="data-table min-w-[52rem]">
                <thead>
                  <tr>
                    <th scope="col" className="sticky-col">
                      Suite
                    </th>
                    <th scope="col">Category</th>
                    <th scope="col">Audio</th>
                    <th scope="col" className="num">
                      Clips
                    </th>
                    <th scope="col" className="num">
                      Models
                    </th>
                    <th scope="col">Lowest WER</th>
                    <th scope="col" className="num">
                      Median WER
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ids
                    .filter((id) => summary.suites[id].language === lang)
                    .map((id) => {
                      const info = summary.suites[id];
                      const field = suiteField(summary, id);
                      const best = field[0];
                      const mid = median(field.map((entry) => entry.v));
                      return (
                        <tr key={id} className={clsx(info.tier === "diagnostic" && "text-muted")}>
                          <th scope="row" className="sticky-col font-sans text-[0.875rem] font-medium tracking-normal normal-case">
                            <Link to={(s) => withView(s, "suite", { suite: id })} className="text-fg hover:text-accent hover:underline">
                              {info.name}
                            </Link>
                            <span className="meta block font-normal">
                              {id}
                              {info.tier === "diagnostic" ? " · diagnostic" : ""}
                              {info.category === ACCENTED ? " · references mismatched" : ""}
                            </span>
                          </th>
                          <td>{categoryName(info.category)}</td>
                          <td>{info.origin === "public" ? "Real recordings" : "Synthetic"}</td>
                          <td className="num">{info.clips}</td>
                          <td className="num">{field.length}</td>
                          <td>
                            {best ? (
                              <Link to={(s) => withView(s, "model", { model: best.id })} className="hover:text-accent hover:underline">
                                <span className="font-medium tabular-nums">{formatMetric("wer", best.v)}</span>{" "}
                                <span className="text-muted">{modelMeta(best.id, summary.models[best.id]?.type).short}</span>
                              </Link>
                            ) : (
                              "–"
                            )}
                          </td>
                          <td className="num">{formatMetric("wer", mid)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ))}
    </>
  );
}
