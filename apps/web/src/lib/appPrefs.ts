import { DEFAULT_WORKPLANE_WORKSPACE, normalizeWorkspaceSettings, readWorkspaceDefault } from "@/lib/workplaneSettings";
import { splitWorkspace } from "@/lib/settingsScope";
import type { WorkplaneWorkspaceSettings } from "@/types/layerling";

/**
 * The native app's own preference store for the workspace keys the application owns (settingsScope.ts). It lives in the web view's localStorage,
 * which every window of the app shares, so a change in one window (or in the Settings window) reaches all others through the `storage` event.
 * It is separate from every document: reading or writing it never touches a document's state, dirty flag or recovery snapshot.
 */
export const APP_PREFS_STORAGE_KEY = "layerling.appPrefs.v1";
/** Same-window notification (the `storage` event only fires in OTHER windows). */
export const APP_PREFS_CHANGED_EVENT = "layerling:app-prefs-changed";

export type AppPrefs = Partial<WorkplaneWorkspaceSettings>;

function storageOrNull(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function appKeysOf(workspace: WorkplaneWorkspaceSettings): AppPrefs {
  return splitWorkspace(workspace).app;
}

/**
 * The application preferences, always complete. First use is seeded from the look saved earlier with "Make Default" (so nothing the user set up is
 * lost), otherwise from the application's own defaults; the seed is stored so it is stable from then on.
 */
export function readAppPrefs(storage: Storage | null = storageOrNull()): AppPrefs {
  let stored: unknown = null;
  try {
    stored = storage ? JSON.parse(storage.getItem(APP_PREFS_STORAGE_KEY) ?? "null") : null;
  } catch {
    stored = null;
  }
  if (stored && typeof stored === "object") {
    // Normalised against the application defaults, so a missing or damaged key never leaks a document's value.
    return appKeysOf(normalizeWorkspaceSettings(stored, DEFAULT_WORKPLANE_WORKSPACE));
  }
  const seeded = appKeysOf(readWorkspaceDefault(storage)?.workspace ?? DEFAULT_WORKPLANE_WORKSPACE);
  try {
    storage?.setItem(APP_PREFS_STORAGE_KEY, JSON.stringify(seeded));
  } catch {
    // Storage unavailable: the seed still applies for this run.
  }
  return seeded;
}

/** Merges `patch` (application keys only; others are ignored) into the store. Returns the keys that changed. */
export function writeAppPrefs(patch: AppPrefs, storage: Storage | null = storageOrNull()): string[] {
  const current = readAppPrefs(storage);
  const incoming = splitWorkspace(patch).app;
  const next = appKeysOf(normalizeWorkspaceSettings({ ...current, ...incoming }, DEFAULT_WORKPLANE_WORKSPACE));
  const changed = Object.keys(next).filter((key) => JSON.stringify((next as Record<string, unknown>)[key]) !== JSON.stringify((current as Record<string, unknown>)[key]));
  if (changed.length === 0) return [];
  try {
    storage?.setItem(APP_PREFS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return [];
  }
  if (typeof window !== "undefined" && storage === storageOrNull()) window.dispatchEvent(new Event(APP_PREFS_CHANGED_EVENT));
  return changed;
}

/** Calls `listener` after any change to the preferences, from this window or another. Returns the remover. */
export function subscribeAppPrefs(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === APP_PREFS_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(APP_PREFS_CHANGED_EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(APP_PREFS_CHANGED_EVENT, listener);
  };
}
