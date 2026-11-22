"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { isNativeAppearance } from "@/lib/appTheme";

/** One entry in this browser for all the folding cards of the shape settings: which of them stay open (#632). */
export const INSPECTOR_CARDS_KEY = "layerling.editor.inspectorCards";

/** The saved states by card name; an empty list when nothing is saved or the browser keeps nothing. */
export function readInspectorCards(storage: Pick<Storage, "getItem"> | null | undefined): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(INSPECTOR_CARDS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const cards: Record<string, boolean> = {};
    for (const [name, open] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof open === "boolean") cards[name] = open;
    }
    return cards;
  } catch {
    return {};
  }
}

export function writeInspectorCard(storage: Pick<Storage, "getItem" | "setItem"> | null | undefined, name: string, open: boolean) {
  try {
    storage?.setItem(INSPECTOR_CARDS_KEY, JSON.stringify({ ...readInspectorCards(storage), [name]: open }));
  } catch {
    // A browser that keeps nothing (private window, full storage): the card works, it just forgets.
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Whether the surface texture card - which is the texture tool - stays open when the selected body changes from
 * `before` to `after` (ids, null for none or several). It is not kept like the other cards: kept, it stayed on for
 * every body chosen later and after a reload, so the tool looked switched on by itself. Choosing another body or none
 * closes it; a body an edit replaced under a new id (a texture made or changed, undo) keeps it, as it is the same
 * body to the user. `present` says which ids are still in the design.
 */
export function surfaceTextureCardStaysOpen(before: string | null, after: string | null, present: (id: string) => boolean) {
  if (before === after) return true;
  return before !== null && after !== null && !present(before);
}

/**
 * Open or closed, like useState, but kept in this browser: a card that was left open stays open for the next
 * shape and the next visit. `initial` is what a card shows until somebody has opened or closed it.
 */
export function useInspectorCard(name: string, initial: boolean): [boolean, (next: boolean | ((open: boolean) => boolean)) => void] {
  const [open, setOpenState] = useState(() => readInspectorCards(browserStorage())[name] ?? initial);
  const setOpen = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    setOpenState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      writeInspectorCard(browserStorage(), name, value);
      return value;
    });
  }, [name]);
  return [open, setOpen];
}

/**
 * The native app's Inspector sections (Build 0028): open or closed is TEMPORARY UI state of this window's session. Every section starts open when the
 * window (so the document) is loaded; the user's choices are kept while it stays open - across selection changes and Project/Object tab switches - and
 * are gone when the document is closed or the app quits. Nothing is written anywhere: not the document, not the application preferences, not localStorage.
 */
const sessionSections = new Map<string, boolean>();
const sessionListeners = new Set<() => void>();
const subscribeSessionSections = (listener: () => void) => {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
};

/** Whether a section is open in this session (open unless the user closed it). */
export function getSessionSectionOpen(name: string): boolean {
  return sessionSections.get(name) ?? true;
}

export function setSessionSectionOpen(name: string, open: boolean) {
  if (getSessionSectionOpen(name) === open) return;
  if (open) sessionSections.delete(name);
  else sessionSections.set(name, false);
  sessionListeners.forEach((listener) => listener());
}

/** For tests: every section back to open. */
export function resetSessionSections() {
  sessionSections.clear();
  sessionListeners.forEach((listener) => listener());
}

/**
 * One section's open state. In the native app it is the session state above (open by default, `initial` is ignored); in a browser it is what it always
 * was: `useInspectorCard` (kept in this browser) when `keepInBrowser`, plain state otherwise.
 */
export function useInspectorSection(name: string, initial: boolean, keepInBrowser = true): [boolean, (next: boolean | ((open: boolean) => boolean)) => void] {
  const native = isNativeAppearance(); // constant for the life of a page, so the hooks below are always called in the same order
  const session = useSyncExternalStore(subscribeSessionSections, () => getSessionSectionOpen(name), () => true);
  const setSession = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    setSessionSectionOpen(name, typeof next === "function" ? next(getSessionSectionOpen(name)) : next);
  }, [name]);
  const kept = useInspectorCard(name, initial);
  const local = useState(initial);
  if (native) return [session, setSession];
  return keepInBrowser ? kept : local;
}
