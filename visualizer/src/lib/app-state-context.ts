import { createContext, useContext } from "react";
import { serializeState, type AppState } from "./url-state";

export type Next = AppState | ((current: AppState) => AppState);

export interface NavigateOptions {
  /** Replace the history entry instead of adding one (filters, sorting, typing). */
  replace?: boolean;
}

export interface AppStateContextValue {
  state: AppState;
  navigate: (next: Next, options?: NavigateOptions) => void;
}

export const AppStateContext = createContext<AppStateContextValue | null>(null);

export function urlFor(state: AppState): string {
  const query = serializeState(state);
  return `${window.location.pathname}${query ? `?${query}` : ""}`;
}

export function useAppState(): AppStateContextValue {
  const context = useContext(AppStateContext);
  if (!context) throw new Error("useAppState needs <AppStateProvider>");
  return context;
}
