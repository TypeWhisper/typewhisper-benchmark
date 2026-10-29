import clsx from "clsx";
import { Link } from "../lib/app-state";
import { withView } from "../lib/url-state";
import type { ModelMeta } from "../data/model-meta";
import { runtimeShort } from "../lib/series";
import { BarMark } from "./ui";

export function TwBadge({ meta, compact }: { meta: ModelMeta; compact?: boolean }) {
  const { status, isDefault, plugin } = meta.tw;
  if (status === "engine") {
    const title = `TypeWhisper ships this model${plugin ? ` (${plugin} plugin)` : ""}${isDefault ? " as the plugin's default" : ""}.`;
    return (
      <span className="badge badge-accent" title={title}>
        <BarMark className="size-2.5" />
        {compact ? (isDefault ? "TW default" : "TW") : isDefault ? "TypeWhisper default" : "TypeWhisper engine"}
      </span>
    );
  }
  if (status === "candidate") return <span className="badge">Candidate</span>;
  if (status === "probe") return <span className="badge">Probe</span>;
  return null;
}

export function DeployBadge({ meta }: { meta: ModelMeta }) {
  return meta.deployment === "cloud" ? <span className="badge">Cloud API</span> : null;
}

export function ModelLink({ id, meta, className }: { id: string; meta: ModelMeta; className?: string }) {
  return (
    <Link
      to={(state) => withView(state, "model", { model: id })}
      className={clsx("font-medium text-fg decoration-hairline-strong underline-offset-4 hover:text-accent hover:underline", className)}
    >
      {meta.name}
    </Link>
  );
}

/** Name, maker and runtime of a model, for table rows. Phones get the short name and no badges. */
export function ModelCell({ id, meta, swatch }: { id: string; meta: ModelMeta; swatch?: string }) {
  const facts = [meta.org, runtimeShort(id, meta), meta.params].filter(Boolean).join(" · ");
  return (
    <div className="flex min-w-0 items-start gap-2">
      {swatch && <span className="swatch mt-1.5" style={{ background: swatch }} aria-hidden="true" />}
      <div className="min-w-0">
        <div className="hidden flex-wrap items-center gap-x-2 gap-y-1 sm:flex">
          <ModelLink id={id} meta={meta} className="leading-snug" />
          <TwBadge meta={meta} compact />
          <DeployBadge meta={meta} />
        </div>
        <div className="flex items-center gap-1.5 sm:hidden">
          <Link
            to={(state) => withView(state, "model", { model: id })}
            className="truncate leading-snug font-medium text-fg"
            title={meta.name}
          >
            {meta.short}
          </Link>
          {meta.tw.status === "engine" && (
            <span title="TypeWhisper engine">
              <BarMark className="size-2.5" />
              <span className="sr-only">TypeWhisper engine</span>
            </span>
          )}
        </div>
        <div className="meta mt-0.5 truncate" title={`${facts} · ${id}`}>
          {facts}
        </div>
      </div>
    </div>
  );
}
