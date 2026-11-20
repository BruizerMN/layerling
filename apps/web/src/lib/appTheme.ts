export const APP_THEME_STORAGE_KEY = "layerling.theme";

export const APP_THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "graphite", label: "Graphite" },
] as const;

/**
 * The native macOS app (Build 0007) offers four appearances instead: System, Light, Dark (neutral, like a Mac's own) and Classic Layerling (the original
 * brown/tan dark theme). They are the same `data-theme` attribute as always (light or dark) plus a palette: "mac" for System/Light/Dark, none for Classic.
 * A browser never sees "classic". In files the choices keep their ORIGINAL names (see themeToSettingsFile), so settings files stay compatible both ways.
 */
export const NATIVE_THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "classic", label: "Classic Layerling" },
] as const;

export type AppThemePreference = (typeof APP_THEME_OPTIONS)[number]["value"] | "classic";

/** True in the native app (the page is served from the host's own scheme); never in a browser. */
export function isNativeAppearance(): boolean {
  return typeof window !== "undefined" && window.location?.protocol === "layerling:";
}

/** The appearances offered in the Theme choice of this edition. */
export function appThemeOptions(): ReadonlyArray<{ value: AppThemePreference; label: string }> {
  return isNativeAppearance() ? NATIVE_THEME_OPTIONS : APP_THEME_OPTIONS;
}
/**
 * Graphite is the dark theme with neutral grey surfaces instead of the warm
 * brown ones. It resolves to "dark", so everything that only asks light or
 * dark keeps working; the palette on top only swaps colours.
 */
export type ResolvedAppTheme = "light" | "dark";
export type AppThemePalette = "default" | "graphite" | "mac";

export function appThemePalette(preference: AppThemePreference): AppThemePalette {
  if (isNativeAppearance()) return preference === "classic" ? "default" : "mac";
  return preference === "graphite" ? "graphite" : "default";
}

/** The 3D scene's palette: neutral grey surroundings wherever the interface is neutral dark (Graphite in a browser; Dark/System-dark in the native app). */
export function scenePalette(preference: AppThemePreference, resolved: ResolvedAppTheme): "default" | "graphite" {
  if (isNativeAppearance()) return preference !== "classic" && resolved === "dark" ? "graphite" : "default";
  return preference === "graphite" ? "graphite" : "default";
}

export function normalizeAppThemePreference(value: unknown): AppThemePreference {
  if (value === "classic") return isNativeAppearance() ? "classic" : "dark";
  return value === "light" || value === "dark" || value === "graphite" || value === "system" ? value : "system";
}

export function resolveAppTheme(preference: AppThemePreference, prefersDark: boolean): ResolvedAppTheme {
  if (preference === "system") return prefersDark ? "dark" : "light";
  if (preference === "classic") return "dark";
  return preference === "graphite" ? "dark" : preference;
}

/**
 * The native app's one-time move from Layerling's own appearance names to the four above, so nobody's explicit choice changes its LOOK:
 * the old "dark" (brown) becomes Classic Layerling, the old "graphite" (neutral grey) becomes the new Dark, "light" and "system" stay.
 * Nothing stored means System (the default for a new installation). Runs once (marker key); later "dark" means the new Dark.
 */
export const APPEARANCE_MIGRATION_KEY = "layerling.appearance.migration";
export const APPEARANCE_MIGRATION_VERSION = "0007";
export function migrateLegacyAppearance(storage: Pick<Storage, "getItem" | "setItem"> | null | undefined, native = isNativeAppearance()): boolean {
  if (!native || !storage) return false;
  try {
    if (storage.getItem(APPEARANCE_MIGRATION_KEY) === APPEARANCE_MIGRATION_VERSION) return false;
    const stored = storage.getItem(APP_THEME_STORAGE_KEY);
    if (stored === "dark") storage.setItem(APP_THEME_STORAGE_KEY, "classic");
    else if (stored === "graphite") storage.setItem(APP_THEME_STORAGE_KEY, "dark");
    storage.setItem(APPEARANCE_MIGRATION_KEY, APPEARANCE_MIGRATION_VERSION);
    return stored === "dark" || stored === "graphite";
  } catch {
    return false;
  }
}

/** Settings files keep the ORIGINAL names ("dark" is the brown theme, "graphite" the neutral one), so a file moves between a browser and the native app intact. */
export function themeToSettingsFile(preference: AppThemePreference, native = isNativeAppearance()): AppThemePreference {
  if (!native) return preference === "classic" ? "dark" : preference;
  if (preference === "classic") return "dark";
  if (preference === "dark") return "graphite";
  return preference;
}
export function themeFromSettingsFile(value: AppThemePreference, native = isNativeAppearance()): AppThemePreference {
  if (!native) return value;
  if (value === "dark") return "classic";
  if (value === "graphite") return "dark";
  return value;
}

export function readStoredAppTheme(storage: Pick<Storage, "getItem"> | null | undefined): AppThemePreference {
  if (!storage) return "system";
  try {
    return normalizeAppThemePreference(storage.getItem(APP_THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

/** Whether this browser has a theme on record, even "system": someone chose it, or it has been applied before. */
export function hasStoredAppTheme(storage: Pick<Storage, "getItem"> | null | undefined): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(APP_THEME_STORAGE_KEY) !== null;
  } catch {
    return true;
  }
}

export function storeAppTheme(
  storage: Pick<Storage, "setItem"> | null | undefined,
  preference: AppThemePreference,
) {
  if (!storage) return;
  try {
    storage.setItem(APP_THEME_STORAGE_KEY, preference);
  } catch {
    // The selected theme still applies for this session when storage is unavailable.
  }
}

export function applyAppTheme(preference: AppThemePreference, prefersDark?: boolean) {
  if (typeof document === "undefined") return;
  const systemPrefersDark = prefersDark ?? (
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false
  );
  const resolved = resolveAppTheme(preference, systemPrefersDark);
  document.documentElement.dataset.theme = resolved;
  const palette = appThemePalette(preference);
  if (palette === "default") delete document.documentElement.dataset.palette;
  else document.documentElement.dataset.palette = palette;
  document.documentElement.style.colorScheme = resolved;
  if (palette === "graphite") ensureGraphiteStylesheet();
  if (palette === "mac") ensureMacStylesheet(resolved);
  reportAppearanceToHost(preference, resolved);
}

/** The native host follows the choice with the whole application's appearance (menus, panels, sheets): it is told which one is chosen. */
function reportAppearanceToHost(preference: AppThemePreference, resolved: ResolvedAppTheme) {
  if (!isNativeAppearance()) return;
  try {
    const handler = (window as unknown as { webkit?: { messageHandlers?: Record<string, { postMessage?: (message: unknown) => unknown } | undefined> } }).webkit?.messageHandlers?.layerlingAppearance;
    handler?.postMessage?.({ preference, resolved });
  } catch {
    // No host (or an older one): the page still looks right.
  }
}

const MAC_STYLESHEET_PREFIX = "layerling-mac-theme-";
const MAC_STYLESHEET_FILES = { light: "mac-light-theme.css", dark: "mac-dark-theme.css" } as const;
function ensureMacStylesheet(resolved: ResolvedAppTheme) {
  const id = `${MAC_STYLESHEET_PREFIX}${resolved}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `/assets/theme/${MAC_STYLESHEET_FILES[resolved]}${appVersion ? `?v=${appVersion}` : ""}`;
  document.head.appendChild(link);
}

export const GRAPHITE_STYLESHEET_ID = "layerling-graphite-theme";
// Root-relative like every other asset: a relative path resolved against the
// current URL and missed on any page not at the root (the 404 page, say). The
// version query keeps a cached stylesheet from an older release out, since
// the file is regenerated from globals.css under the same name every build.
const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;
export const GRAPHITE_STYLESHEET_HREF = `/assets/theme/graphite-theme.css${appVersion ? `?v=${appVersion}` : ""}`;

/**
 * Graphite's colours live in a generated stylesheet that is only fetched once
 * someone picks the theme. It goes last in <head> so it follows globals.css;
 * its rules only match while data-palette="graphite" is set, so it can stay
 * when the theme is switched away again.
 */
function ensureGraphiteStylesheet() {
  if (document.getElementById(GRAPHITE_STYLESHEET_ID)) return;
  const link = document.createElement("link");
  link.id = GRAPHITE_STYLESHEET_ID;
  link.rel = "stylesheet";
  link.href = GRAPHITE_STYLESHEET_HREF;
  document.head.appendChild(link);
}

const themeListeners = new Set<() => void>();
// The native app's one-time rename of the stored choice happens BEFORE the choice is read (migrateLegacyAppearance).
if (typeof window !== "undefined") {
  try {
    migrateLegacyAppearance(window.localStorage);
  } catch {
    // Blocked storage: nothing to migrate.
  }
}
let currentThemePreference: AppThemePreference =
  typeof window !== "undefined" ? readStoredAppTheme(window.localStorage) : "system";

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const handleMediaChange = () => {
    if (currentThemePreference === "system") {
      applyAppTheme("system", media.matches);
      themeListeners.forEach((listener) => listener());
    }
  };
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", handleMediaChange);
  } else if (typeof (media as unknown as { addListener?: (cb: () => void) => void }).addListener === "function") {
    (media as unknown as { addListener: (cb: () => void) => void }).addListener(handleMediaChange);
  }
}

export function subscribeToAppTheme(listener: () => void) {
  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
  };
}

export function getAppThemePreference(): AppThemePreference {
  return currentThemePreference;
}

export function setAppTheme(preference: AppThemePreference, persist = true) {
  currentThemePreference = preference;
  if (persist && typeof window !== "undefined") {
    storeAppTheme(window.localStorage, preference);
  }
  applyAppTheme(preference);
  themeListeners.forEach((listener) => listener());
}

