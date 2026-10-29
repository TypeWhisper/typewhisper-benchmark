import { useCallback, useEffect, useMemo, useRef, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { parseState, type AppState } from "./url-state";
import { AppStateContext, urlFor, useAppState, type NavigateOptions, type Next } from "./app-state-context";

/**
 * Keeps the app state and the URL in sync: reads the query on load, writes it with
 * pushState/replaceState, and follows back/forward through popstate.
 */
export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => parseState(window.location.search));
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const onPopState = () => {
      const next = parseState(window.location.search);
      stateRef.current = next;
      setState(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((next: Next, options: NavigateOptions = {}) => {
    const current = stateRef.current;
    const value = typeof next === "function" ? next(current) : next;
    const url = urlFor(value);
    if (url !== `${window.location.pathname}${window.location.search}`) {
      if (options.replace) window.history.replaceState(null, "", url);
      else window.history.pushState(null, "", url);
    }
    const pageChanged =
      value.view !== current.view || value.model !== current.model || (value.view === "suite" && value.suite !== current.suite);
    stateRef.current = value;
    setState(value);
    if (pageChanged && !options.replace) window.scrollTo({ top: 0 });
  }, []);

  const value = useMemo(() => ({ state, navigate }), [state, navigate]);
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: (current: AppState) => AppState;
  replace?: boolean;
};

/** A real link (open in new tab, copy address) that navigates in place on a plain click. */
export function Link({ to, replace, onClick, children, ...rest }: LinkProps) {
  const { state, navigate } = useAppState();
  const next = to(state);
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(next, { replace });
  };
  return (
    <a href={urlFor(next)} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
