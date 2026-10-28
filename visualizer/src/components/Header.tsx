import clsx from "clsx";
import { Check, Github, Link2, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "../lib/app-state";
import { useAppState } from "../lib/app-state-context";
import { withView, type View } from "../lib/url-state";
import { BarMark } from "./ui";

const NAV: Array<{ view: View; label: string; also?: View[] }> = [
  { view: "leaderboard", label: "Leaderboard" },
  { view: "compare", label: "Compare" },
  { view: "models", label: "Models", also: ["model"] },
  { view: "suites", label: "Suites", also: ["suite"] },
  { view: "about", label: "Method" },
];

const REPO = "https://github.com/TypeWhisper/typewhisper-benchmark";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and non-secure contexts: fall back to a hidden textarea.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export function ShareButton({ label = "Copy link", className, iconOnlyOnPhones }: { label?: string; className?: string; iconOnlyOnPhones?: boolean }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const onClick = async () => {
    const ok = await copyText(window.location.href);
    setCopied(ok ? "done" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied("idle"), 2200);
  };
  return (
    <button type="button" className={clsx("btn", className)} onClick={onClick} title="Copy a link to exactly this view">
      {copied === "done" ? <Check className="size-4 text-accent" aria-hidden="true" /> : <Link2 className="size-4" aria-hidden="true" />}
      <span className={iconOnlyOnPhones ? "sr-only sm:not-sr-only" : undefined}>
        {copied === "done" ? "Link copied" : copied === "failed" ? "Copy failed" : label}
      </span>
      <span className="visually-hidden" aria-live="polite">
        {copied === "done" ? "Link copied to the clipboard" : ""}
      </span>
    </button>
  );
}

type Theme = "light" | "dark";

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useEffect(() => {
    // Follow the system until the visitor picks a theme here.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (localStorage.getItem("tw-bench-theme")) return;
      const next: Theme = media.matches ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="btn btn-ghost btn-icon"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("tw-bench-theme", next);
        } catch {
          // Private mode: the choice lasts for this page only.
        }
        setTheme(next);
      }}
    >
      {theme === "dark" ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
    </button>
  );
}

export function Header() {
  const { state } = useAppState();
  const isCurrent = (item: (typeof NAV)[number]) => state.view === item.view || item.also?.includes(state.view);
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-bg/85 backdrop-blur-md backdrop-saturate-150">
      <div className="wrap flex h-[var(--header-height)] items-center gap-4">
        <Link
          to={(s) => withView(s, "leaderboard")}
          className="flex flex-none items-center gap-2 rounded-md text-[0.9375rem] font-semibold tracking-[-0.01em]"
        >
          <BarMark className="size-4" />
          <span>
            TypeWhisper <span className="font-normal text-muted">STT Benchmark</span>
          </span>
        </Link>
        <nav aria-label="Views" className="ml-4 hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => (
              <li key={item.view}>
                <Link
                  to={(s) => withView(s, item.view)}
                  aria-current={isCurrent(item) ? "page" : undefined}
                  className={clsx(
                    "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                    isCurrent(item) ? "bg-surface text-fg" : "text-muted hover:text-fg"
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <ShareButton iconOnlyOnPhones className="max-sm:w-9 max-sm:border-transparent max-sm:px-0" />
          <ThemeToggle />
          <a className="btn btn-ghost btn-icon" href={REPO} aria-label="Source and raw results on GitHub" title="Source and raw results on GitHub">
            <Github className="size-4" aria-hidden="true" />
          </a>
        </div>
      </div>
      {/* Phones: the views scroll sideways under the bar. */}
      <nav aria-label="Views" className="border-t border-hairline md:hidden">
        <ul className="wrap flex items-center gap-1 overflow-x-auto py-1.5">
          {NAV.map((item) => (
            <li key={item.view} className="flex-none">
              <Link
                to={(s) => withView(s, item.view)}
                aria-current={isCurrent(item) ? "page" : undefined}
                className={clsx(
                  "block rounded-full px-3 py-1.5 text-sm font-medium",
                  isCurrent(item) ? "bg-surface text-fg" : "text-muted"
                )}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
