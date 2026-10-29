import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { AppStateProvider, Link } from "./lib/app-state";
import { useAppState } from "./lib/app-state-context";
import { withView } from "./lib/url-state";
import { formatDate, listJoin } from "./lib/format";
import { useSummary } from "./data/load";
import { canonicalize, documentTitle } from "./data/links";
import type { Summary } from "./data/types";
import { Header } from "./components/Header";
import { CompareTray } from "./components/CompareTray";
import { BarMark, Loading } from "./components/ui";
import { LeaderboardView } from "./views/LeaderboardView";
import { CompareView } from "./views/CompareView";
import { ModelView } from "./views/ModelView";
import { SuiteView } from "./views/SuiteView";
import { SuitesView } from "./views/SuitesView";
import { ModelsView } from "./views/ModelsView";
import { AboutView } from "./views/AboutView";

function Footer({ summary }: { summary: Summary }) {
  return (
    <footer className="mt-16 border-t border-hairline">
      <div className="wrap flex flex-col gap-3 py-8 pb-28 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2">
          <BarMark />
          <span>
            Built from the runner's result files on {formatDate(summary.generatedAt)} · data {summary.version}
          </span>
        </p>
        <nav aria-label="More" className="flex flex-wrap gap-x-5 gap-y-1">
          <Link to={(s) => withView(s, "about")} className="hover:text-fg">
            Method
          </Link>
          <a className="hover:text-fg" href="https://github.com/TypeWhisper/typewhisper-benchmark">
            GitHub
          </a>
          <a className="hover:text-fg" href="https://typewhisper.com">
            typewhisper.com
          </a>
        </nav>
      </div>
    </footer>
  );
}

function Shell({ summary }: { summary: Summary }) {
  const { state, navigate } = useAppState();
  // Links may carry aliases or ids the data does not have: rewrite the URL to canonical ids and
  // name what was dropped until the visitor dismisses the note.
  const canonical = canonicalize(summary, state);
  const [dropped, setDropped] = useState<string[]>([]);
  const droppedKey = canonical.dropped.join(",");
  const [seenDropped, setSeenDropped] = useState("");
  if (droppedKey && droppedKey !== seenDropped) {
    setSeenDropped(droppedKey);
    setDropped(canonical.dropped);
  }
  const needsRewrite = JSON.stringify(canonical.state) !== JSON.stringify(state);
  useEffect(() => {
    if (needsRewrite) navigate(canonical.state, { replace: true });
  }, [needsRewrite, canonical.state, navigate]);

  useEffect(() => {
    document.title = `${documentTitle(summary, state)} · TypeWhisper STT Benchmark`;
  }, [summary, state]);

  // Until the URL holds the canonical state, views would read ids the data may not have.
  const view = needsRewrite ? null : (() => {
    switch (state.view) {
      case "compare":
        return <CompareView summary={summary} />;
      case "model":
        return <ModelView summary={summary} />;
      case "suite":
        return <SuiteView summary={summary} />;
      case "suites":
        return <SuitesView summary={summary} />;
      case "models":
        return <ModelsView summary={summary} />;
      case "about":
        return <AboutView summary={summary} />;
      default:
        return <LeaderboardView summary={summary} />;
    }
  })();

  return (
    <>
      {dropped.length > 0 && (
        <div className="border-b border-hairline bg-surface" role="status">
          <div className="wrap flex items-center gap-3 py-2 text-sm">
            <span className="text-muted">
              The link named {dropped.length === 1 ? "a model" : "models"} this benchmark does not have:{" "}
              <code className="font-mono text-fg">{listJoin(dropped)}</code>. Showing the rest.
            </span>
            <button type="button" className="btn btn-ghost btn-icon ml-auto" aria-label="Dismiss" onClick={() => setDropped([])}>
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      <main id="content" key={state.view === "model" ? `model:${state.model}` : state.view} className="fade-in">
        {view}
      </main>
      <Footer summary={summary} />
      <CompareTray summary={summary} />
    </>
  );
}

function DataGate() {
  const [attempt, setAttempt] = useState(0);
  const summary = useSummary(attempt);
  if (summary.status === "loading") {
    return (
      <div className="wrap py-16">
        <Loading label="Loading benchmark results…" />
      </div>
    );
  }
  if (summary.status === "error") {
    return (
      <div className="wrap py-16">
        <p className="text-lg font-semibold">The benchmark data did not load.</p>
        <p className="mt-2 text-sm text-muted">{summary.error}</p>
        <button type="button" className="btn mt-4" onClick={() => setAttempt((value) => value + 1)}>
          Try again
        </button>
      </div>
    );
  }
  return <Shell summary={summary.data} />;
}

export default function App() {
  return (
    <AppStateProvider>
      <a
        href="#content"
        className="sr-only z-50 rounded-full bg-primary px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <Header />
      <DataGate />
    </AppStateProvider>
  );
}
