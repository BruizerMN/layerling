import { isNativeAppearance, type AppThemePreference, type ResolvedAppTheme } from "../appTheme";

/**
 * Custom images for the modeling viewport's background (Build 0020, native app only). The host keeps the images (copies in Application Support) and tells every
 * page which ones are set, as addresses on the host's own scheme (`window.__layerlingBackgrounds`, and the event below when one changes). The page only
 * chooses which one applies and draws it behind the model.
 */
export type BackgroundKind = "light" | "dark" | "presentation";
export type BackgroundImages = Record<BackgroundKind, string | null>;
export const BACKGROUNDS_CHANGED_EVENT = "layerling:backgrounds-changed";
export const BACKGROUND_KINDS: readonly BackgroundKind[] = ["light", "dark", "presentation"];

const NONE: BackgroundImages = { light: null, dark: null, presentation: null };

function normalize(value: unknown): BackgroundImages {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const pick = (key: string) => (typeof source[key] === "string" && (source[key] as string).length > 0 ? (source[key] as string) : null);
  return { light: pick("light"), dark: pick("dark"), presentation: pick("presentation") };
}

export function currentBackgrounds(): BackgroundImages {
  if (typeof window === "undefined") return NONE;
  return normalize((window as unknown as { __layerlingBackgrounds?: unknown }).__layerlingBackgrounds);
}

export function subscribeBackgrounds(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(BACKGROUNDS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(BACKGROUNDS_CHANGED_EVENT, listener);
}

/** What the host calls when the images change: updates the page's copy and tells the viewport. */
export function installBackgroundsReceiver() {
  if (typeof window === "undefined") return;
  (window as unknown as { layerlingSetBackgrounds?: (value: unknown) => void }).layerlingSetBackgrounds = (value) => {
    // The raw value is kept: it also carries the Organization Logo and its preferences (lib/host/presentationLogo.ts), which have their own reader.
    (window as unknown as { __layerlingBackgrounds?: unknown }).__layerlingBackgrounds = value && typeof value === "object" ? value : {};
    window.dispatchEvent(new Event(BACKGROUNDS_CHANGED_EVENT));
  };
}

export interface BackgroundChoice {
  /** The image to draw behind the model, or null for the standard background. */
  url: string | null;
  /** The standard background the viewport uses when there is no image (and for the grid): the theme it is drawn for. */
  theme: ResolvedAppTheme;
  /** Presentation draws the standard DARK viewport background, whatever the application's appearance is. */
  forcedDark: boolean;
}

/**
 * Which background applies.
 *  - Presentation Mode (Build 0021): the Presentation image, else the Dark image, else the standard dark viewport background; independent of the appearance.
 *  - Ordinary editing: Light or Dark follows the effective appearance (System follows macOS) and uses that mode's image, else the standard background.
 *  - Classic Layerling keeps its own backgrounds: no custom image.
 */
export function chooseBackground(images: BackgroundImages, context: { presentation: boolean; preference: AppThemePreference; resolved: ResolvedAppTheme }): BackgroundChoice {
  if (!isNativeAppearance()) return { url: null, theme: context.resolved, forcedDark: false };
  if (context.presentation) return { url: images.presentation ?? images.dark, theme: "dark", forcedDark: true };
  if (context.preference === "classic") return { url: null, theme: context.resolved, forcedDark: false };
  return { url: context.resolved === "dark" ? images.dark : images.light, theme: context.resolved, forcedDark: false };
}
