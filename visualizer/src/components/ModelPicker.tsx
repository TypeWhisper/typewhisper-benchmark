import clsx from "clsx";
import { Plus } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { modelMeta } from "../data/model-meta";
import type { Summary } from "../data/types";
import { runtimeShort } from "../lib/series";

interface Props {
  summary: Summary;
  exclude: string[];
  onPick: (id: string) => void;
  disabled?: boolean;
  label?: string;
}

/** Search-as-you-type list of models (combobox with a listbox). */
export function ModelPicker({ summary, exclude, onPick, disabled, label = "Add a model" }: Props) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const inputId = useId();

  const options = useMemo(() => {
    const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return Object.keys(summary.models)
      .filter((id) => !exclude.includes(id))
      .map((id) => ({ id, meta: modelMeta(id, summary.models[id].type) }))
      .filter(({ id, meta }) => {
        const haystack = `${id} ${meta.name} ${meta.org} ${meta.family} ${meta.runtime}`.toLowerCase();
        return words.every((word) => haystack.includes(word));
      })
      .sort((a, b) => Number(b.meta.tw.status === "engine") - Number(a.meta.tw.status === "engine") || a.meta.name.localeCompare(b.meta.name));
  }, [summary, exclude, text]);

  const current = Math.min(cursor, Math.max(0, options.length - 1));

  const choose = (id: string) => {
    onPick(id);
    setText("");
    setCursor(0);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setCursor(Math.min(options.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor(Math.max(0, current - 1));
    } else if (event.key === "Enter" && open && options[current]) {
      event.preventDefault();
      choose(options[current].id);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative w-full sm:w-80">
      <label htmlFor={inputId} className="visually-hidden">
        {label}
      </label>
      <Plus className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[current] ? `${listId}-${current}` : undefined}
        className="input w-full rounded-full pl-8"
        placeholder={disabled ? "Six models at most" : `${label}…`}
        disabled={disabled}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setCursor(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
      />
      {open && options.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Models"
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-80 overflow-y-auto rounded-xl border border-hairline-strong bg-raised p-1 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.4)]"
        >
          {options.map(({ id, meta }, index) => (
            <li
              key={id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === current}
              className={clsx("cursor-pointer rounded-lg px-3 py-2", index === current && "bg-surface")}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setCursor(index)}
              onClick={() => choose(id)}
            >
              <div className="text-sm font-medium">{meta.name}</div>
              <div className="meta truncate">
                {[meta.org, runtimeShort(id, meta), meta.tw.status === "engine" ? "TypeWhisper engine" : null].filter(Boolean).join(" · ")}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
