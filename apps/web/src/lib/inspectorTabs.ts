import { useSyncExternalStore } from "react";

/**
 * The tabs along the top of the native app's Inspector (Build 0027).
 *
 * Which tab is showing is workspace UI state of this window's page, like the Inspector's visibility: it is never part of a document, never marks one
 * modified, and every page starts on the default tab (Object). The list of tabs is data (`INSPECTOR_TAB_IDS`, with the icons and panels in
 * components/NativeInspectorDock.tsx), so another tab is one entry in each, with no change to the navigation logic here.
 */
export const INSPECTOR_TAB_IDS = ["project", "object"] as const;
export type InspectorTabId = (typeof INSPECTOR_TAB_IDS)[number];
export const DEFAULT_INSPECTOR_TAB: InspectorTabId = "object";

let current: InspectorTabId = DEFAULT_INSPECTOR_TAB;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function getInspectorTab(): InspectorTabId {
  return current;
}

export function isInspectorTabId(value: unknown): value is InspectorTabId {
  return typeof value === "string" && (INSPECTOR_TAB_IDS as readonly string[]).includes(value);
}

/** Shows a tab; anything that is not a tab is ignored. */
export function setInspectorTab(id: unknown) {
  if (!isInspectorTabId(id) || id === current) return;
  current = id;
  listeners.forEach((listener) => listener());
}

export function useInspectorTab(): InspectorTabId {
  return useSyncExternalStore(subscribe, getInspectorTab, () => DEFAULT_INSPECTOR_TAB);
}

/** For tests: back to the default without notifying anybody who is not there. */
export function resetInspectorTab() {
  current = DEFAULT_INSPECTOR_TAB;
  listeners.forEach((listener) => listener());
}

/**
 * The tab a key moves to from `from` within `ids` (WAI-ARIA tabs: arrows move and wrap, Home/End jump), or null when the key is not a tab key.
 * Arrow keys are the horizontal ones: the tab bar is a row.
 */
export function tabForKey<T extends string>(ids: readonly T[], from: T, key: string): T | null {
  if (ids.length === 0) return null;
  const index = Math.max(0, ids.indexOf(from));
  if (key === "ArrowRight") return ids[(index + 1) % ids.length];
  if (key === "ArrowLeft") return ids[(index - 1 + ids.length) % ids.length];
  if (key === "Home") return ids[0];
  if (key === "End") return ids[ids.length - 1];
  return null;
}
