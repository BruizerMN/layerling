/**
 * External ribbon icons (Build 0024, native app only). The host keeps the folders (the user's Application Support folder, which wins, and the app bundle), validates
 * every SVG there and tells each page which icon keys have artwork, as addresses on its own scheme (`window.__layerlingRibbonIcons`, and
 * `layerlingSetRibbonIcons` when a file changes). The page only decides where to show them: components/RibbonIcon.tsx. In a browser there is no host, the list is
 * always empty and every icon is the editor's own.
 *
 * A key is the tool's id in kebab case: "cutOut" -> "cut-out", "clearance-check" stays. It does not depend on where a tool sits in the ribbon.
 */
export const RIBBON_ICONS_CHANGED_EVENT = "layerling:ribbon-icons-changed";

export type RibbonIconMap = Readonly<Record<string, string>>;
const NONE: RibbonIconMap = Object.freeze({});
let current: RibbonIconMap | null = null;

export function ribbonIconKey(toolId: string): string {
  return toolId
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function normalizeRibbonIcons(value: unknown): RibbonIconMap {
  if (!value || typeof value !== "object") return NONE;
  const result: Record<string, string> = {};
  for (const [key, address] of Object.entries(value as Record<string, unknown>)) {
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) && typeof address === "string" && address.startsWith("layerling://app/__host__/ribbon-icon/")) result[key] = address;
  }
  return Object.freeze(result);
}

/** The same object until the host tells the page something new (so React can compare it). */
export function currentRibbonIcons(): RibbonIconMap {
  if (typeof window === "undefined") return NONE;
  if (current === null) current = normalizeRibbonIcons((window as unknown as { __layerlingRibbonIcons?: unknown }).__layerlingRibbonIcons);
  return current;
}

export function subscribeRibbonIcons(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(RIBBON_ICONS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(RIBBON_ICONS_CHANGED_EVENT, listener);
}

/** What the host calls when a file is added, changed or removed. */
export function installRibbonIconsReceiver() {
  if (typeof window === "undefined") return;
  (window as unknown as { layerlingSetRibbonIcons?: (value: unknown) => void }).layerlingSetRibbonIcons = (value) => {
    current = normalizeRibbonIcons(value);
    window.dispatchEvent(new Event(RIBBON_ICONS_CHANGED_EVENT));
  };
}
