import { APP_THEME_STORAGE_KEY, readStoredAppTheme, setAppTheme } from "@/lib/appTheme";
import { LANGUAGE_STORAGE_KEY, setLanguage, type Language } from "@/lib/i18n";
import { SHAPE_COLORS_STORAGE_KEY, setShapeColors } from "@/lib/shapeColors";
import { SIMPLE_MODE_STORAGE_KEY, setSimpleMode } from "@/lib/simpleMode";
import { TOOLBAR_SIZE_STORAGE_KEY, normalizeToolbarSize, setToolbarSize } from "@/lib/toolbarSize";
import { VIEW_CUBE_POSITION_STORAGE_KEY, normalizeViewCubePosition, setViewCubePosition } from "@/lib/viewCubePosition";
import { normalizeShapeColors } from "@/lib/shapeColors";

/**
 * Application-wide preferences that live in their own localStorage keys (theme, language, toolbar size, shape colours, view cube corner, simple mode)
 * are applied by module-level stores that read the key once, when the page starts, and from then on only when THIS page changes them. Every native
 * window is its own page, so a change made in the Settings window reached new windows (they read storage at start) but never the ones already open:
 * nothing listened for the `storage` event, which the browser fires in every OTHER page sharing the storage. In a browser that is a missing nicety
 * for a second tab; in the native app, where every document window is a page of the same application, it is a bug.
 *
 * The native shell starts this once per page. It re-reads the changed key and runs the same setter the Settings control uses (without the page
 * having to know who changed it). Writing back the value that was just read changes nothing in storage, so it cannot echo between windows. None of
 * this touches a document: these preferences are not part of the document's state or its dirty signature.
 */
export interface AppSyncActions {
  theme(): void;
  language(): void;
  toolbarSize(): void;
  shapeColors(): void;
  viewCubePosition(): void;
  simpleMode(): void;
}

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const defaultAppSyncActions: AppSyncActions = {
  theme: () => setAppTheme(readStoredAppTheme(window.localStorage), false),
  language: () => {
    const stored = read(LANGUAGE_STORAGE_KEY);
    if (stored) void setLanguage(stored as Language, false);
  },
  toolbarSize: () => setToolbarSize(normalizeToolbarSize(read(TOOLBAR_SIZE_STORAGE_KEY))),
  shapeColors: () => setShapeColors(normalizeShapeColors(read(SHAPE_COLORS_STORAGE_KEY))),
  viewCubePosition: () => setViewCubePosition(normalizeViewCubePosition(read(VIEW_CUBE_POSITION_STORAGE_KEY))),
  simpleMode: () => setSimpleMode(read(SIMPLE_MODE_STORAGE_KEY) === "on"),
};

/** Runs the action for the key that changed (`null`: storage was cleared, everything is read again). Returns the names it ran. */
export function syncAppPreference(key: string | null, actions: AppSyncActions = defaultAppSyncActions): string[] {
  const ran: string[] = [];
  const run = (name: keyof AppSyncActions) => {
    actions[name]();
    ran.push(name);
  };
  if (key === null || key === APP_THEME_STORAGE_KEY) run("theme");
  if (key === null || key === LANGUAGE_STORAGE_KEY) run("language");
  if (key === null || key === TOOLBAR_SIZE_STORAGE_KEY) run("toolbarSize");
  if (key === null || key === SHAPE_COLORS_STORAGE_KEY) run("shapeColors");
  if (key === null || key === VIEW_CUBE_POSITION_STORAGE_KEY) run("viewCubePosition");
  if (key === null || key === SIMPLE_MODE_STORAGE_KEY) run("simpleMode");
  return ran;
}

/** Starts the listener for this page; returns the remover. */
export function startNativeAppSync(actions: AppSyncActions = defaultAppSyncActions): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    syncAppPreference(event.key, actions);
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
