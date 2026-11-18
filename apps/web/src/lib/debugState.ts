import { useEffect, useState } from "react";

/**
 * The editor can mirror its whole scene into hidden DOM elements (`data-codex-state`, `data-codex-summary`,
 * `data-codex-projects`) for external automation and diagnosis. On a large design that mirror is a ~10 MB JSON
 * string rebuilt on every change, and nothing in the app reads it, so it is OFF unless asked for:
 *
 *   - open the page with `?debugState=1`, or
 *   - set `localStorage["layerling.debugState"] = "1"` (survives reloads; remove it to turn the mirror off).
 */
export const DEBUG_STATE_QUERY_PARAM = "debugState";
export const DEBUG_STATE_STORAGE_KEY = "layerling.debugState";

/** Pure decision, so it can be tested without a browser. `storage` may be null or throw (private mode, blocked storage). */
export function debugStateRequested(search: string, storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    if (new URLSearchParams(search).get(DEBUG_STATE_QUERY_PARAM) === "1") return true;
  } catch {
    // A malformed query string is no request.
  }
  try {
    return storage?.getItem(DEBUG_STATE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function readDebugStateRequested(): boolean {
  if (typeof window === "undefined") return false;
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  return debugStateRequested(window.location.search, storage);
}

/**
 * False on the server and on the first client render (so the markup matches), then whatever was asked for.
 * Read once per mount: switching it needs a reload, like the other diagnostic switches.
 */
export function useDebugStateEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(readDebugStateRequested());
  }, []);
  return enabled;
}
