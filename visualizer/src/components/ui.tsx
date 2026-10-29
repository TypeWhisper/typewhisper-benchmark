import clsx from "clsx";
import type { ReactNode } from "react";

/** Three bars: the smallest form of TypeWhisper's waveform. */
export function BarMark({ className, loading }: { className?: string; loading?: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={clsx("inline-block size-3 flex-none text-accent", loading && "loading-mark", className)}
      fill="currentColor"
    >
      <rect x="0.5" y="4" width="2" height="4" rx="1" />
      <rect x="5" y="1" width="2" height="10" rx="1" />
      <rect x="9.5" y="3" width="2" height="6" rx="1" />
    </svg>
  );
}

export function PageHead(props: {
  label: ReactNode;
  /** Smaller headline for long titles such as "A vs. B vs. C". */
  compact?: boolean;
  title: ReactNode;
  lede?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="wrap pt-10 pb-8 sm:pt-14">
      <p className="label">
        <BarMark />
        {props.label}
      </p>
      <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 max-w-4xl">
          <h1
            className={clsx(
              "leading-[1.05] font-semibold tracking-[-0.035em]",
              props.compact ? "text-[clamp(1.75rem,3.6vw,2.625rem)]" : "text-[clamp(2rem,4.6vw,3.25rem)]"
            )}
          >
            {props.title}
          </h1>
          {props.lede && (
            <p className="mt-4 max-w-3xl text-[clamp(1rem,1.4vw,1.125rem)] leading-relaxed text-muted">{props.lede}</p>
          )}
          {props.meta && <div className="meta mt-4 flex flex-wrap gap-x-3 gap-y-1">{props.meta}</div>}
        </div>
        {props.actions && <div className="flex flex-none flex-wrap gap-2">{props.actions}</div>}
      </div>
      {props.children}
    </header>
  );
}

export function Section(props: {
  id?: string;
  title: ReactNode;
  lede?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = props.id ? `${props.id}-title` : undefined;
  return (
    <section id={props.id} aria-labelledby={headingId} className={clsx("wrap", props.className)}>
      <div className="section">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <h2 id={headingId} className="section-title">
              {props.title}
            </h2>
            {props.lede && <div className="section-lede">{props.lede}</div>}
          </div>
          {props.aside && <div className="flex flex-none flex-wrap items-end gap-3">{props.aside}</div>}
        </div>
        {props.children}
      </div>
    </section>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted" role="status">
      <BarMark loading className="size-4" />
      {label}
    </div>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return (
    <div
      className={clsx("callout", tone === "warn" && "border-l-[color:var(--squiggle)]")}
      role={tone === "warn" ? "note" : undefined}
    >
      {children}
    </div>
  );
}

/** "lower is better" / "higher is better", always spelled out next to a metric. */
export function Direction({ better, short }: { better: "lower" | "higher"; short?: boolean }) {
  const arrow = better === "lower" ? "↓" : "↑";
  const text = `${better} is better`;
  return (
    <span className="meta normal-case" title={text[0].toUpperCase() + text.slice(1)}>
      <span aria-hidden="true">
        {arrow} {short ? "better" : text}
      </span>
      <span className="visually-hidden">{text}</span>
    </span>
  );
}
