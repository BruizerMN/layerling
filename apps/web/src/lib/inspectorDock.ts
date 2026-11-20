import { useEffect, useSyncExternalStore } from "react";

/**
 * The native app's Inspector (Build 0005).
 *
 * VISIBILITY is an application-wide preference owned by the user, never by the selection: it lives in localStorage like the other application
 * preferences (every document window shares it and hears about changes through the `storage` event, nativeAppSync.ts), it is not part of any document
 * and never marks one modified. Selecting or deselecting never changes it.
 *
 * The DOCK is the panel's place at the right of the 3D view. The editor registers the dock element when it exists; the viewport renders the Inspector
 * (one shape, several shapes, or the empty state) into it through a portal, so the existing React Inspector is adapted, not rebuilt.
 * In a browser none of this exists: `enabled` stays false and the Inspector keeps appearing on selection exactly as before.
 */
export const INSPECTOR_VISIBLE_STORAGE_KEY = "layerling.inspectorVisible";
/** Same-window notification (the `storage` event only fires in OTHER windows). */
export const INSPECTOR_VISIBLE_CHANGED_EVENT = "layerling:inspector-visible-changed";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Visible unless the user chose to hide it; only "hidden" is remembered, so a first run shows the Inspector. */
export function readInspectorVisible(store: Pick<Storage, "getItem"> | null = storage()): boolean {
  try {
    return store?.getItem(INSPECTOR_VISIBLE_STORAGE_KEY) !== "hidden";
  } catch {
    return true;
  }
}

let visible = readInspectorVisible();
let dockEnabled = false;
let dockElement: HTMLElement | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function getInspectorVisible(): boolean {
  return visible;
}

/** Shows or hides the Inspector for the whole application (this window now, every other window through the storage event). */
export function setInspectorVisible(next: boolean, store: Pick<Storage, "setItem" | "removeItem"> | null = storage()) {
  visible = next;
  try {
    if (next) store?.removeItem(INSPECTOR_VISIBLE_STORAGE_KEY);
    else store?.setItem(INSPECTOR_VISIBLE_STORAGE_KEY, "hidden");
  } catch {
    // Storage unavailable: the choice holds for this window.
  }
  notify();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(INSPECTOR_VISIBLE_CHANGED_EVENT));
}

export function toggleInspectorVisible() {
  setInspectorVisible(!visible);
}

/** Another window changed the preference: read it again (nativeAppSync.ts). */
export function refreshInspectorVisible() {
  const next = readInspectorVisible();
  if (next === visible) return;
  visible = next;
  notify();
}

export function useInspectorVisible(): boolean {
  return useSyncExternalStore(subscribe, getInspectorVisible, () => true);
}

/** The editor says whether this page has a dock at all (the native app), and gives it the dock element once it is rendered. */
export function registerInspectorDock(enabled: boolean, element: HTMLElement | null) {
  if (dockEnabled === enabled && dockElement === element) return;
  dockEnabled = enabled;
  dockElement = element;
  notify();
}

export interface InspectorDockState {
  /** This page is the native app: the Inspector is the docked panel, never the floating one that follows the selection. */
  enabled: boolean;
  /** The element to render into, when the Inspector is shown (null while hidden, in focus mode, or before the dock exists). */
  element: HTMLElement | null;
}
let lastState: InspectorDockState = { enabled: false, element: null };
function snapshot(): InspectorDockState {
  const element = dockEnabled && visible ? dockElement : null;
  if (lastState.enabled !== dockEnabled || lastState.element !== element) lastState = { enabled: dockEnabled, element };
  return lastState;
}
const serverSnapshot: InspectorDockState = { enabled: false, element: null };

export function useInspectorDock(): InspectorDockState {
  return useSyncExternalStore(subscribe, snapshot, () => serverSnapshot);
}

/** Keeps `html[data-inspector="on"]` in step with whether the dock takes room from the 3D view (CSS reserves its width only then). */
export function useInspectorLayoutFlag(active: boolean) {
  const shown = useInspectorVisible();
  useEffect(() => {
    const root = document.documentElement;
    if (active && shown) root.dataset.inspector = "on";
    else delete root.dataset.inspector;
    return () => {
      delete root.dataset.inspector;
    };
  }, [active, shown]);
}
