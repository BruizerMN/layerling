import { normalizeAppThemePreference } from "@/lib/appTheme";
import { readAppPrefs } from "@/lib/appPrefs";
import { normalizeCustomShortcuts } from "@/lib/customShortcuts";
import { getLanguage } from "@/lib/i18n";
import { normalizePrintMaterial, normalizeInfillPercent, normalizeWalls } from "@/lib/printEstimate";
import { normalizeRibbonFold } from "@/lib/ribbonFold";
import { normalizeRibbonHidden } from "@/lib/ribbonHidden";
import { normalizeRibbonOrder } from "@/lib/ribbonOrder";
import { normalizeRibbonToolOrder } from "@/lib/ribbonToolOrder";
import { normalizeSectionCutFace } from "@/lib/sectionCaps";
import { normalizeShapeColors } from "@/lib/shapeColors";
import { normalizeSimpleModeChoice, resolveSimpleMode } from "@/lib/simpleMode";
import { normalizeStencilBridgeTool } from "@/lib/stencilBridgeTool";
import { rememberedPatternColor } from "@/lib/surfaceTextureShape";
import { isTouchHandleMode } from "@/lib/touchHandleMode";
import { normalizeToolbarSize } from "@/lib/toolbarSize";
import { normalizeViewCubePosition } from "@/lib/viewCubePosition";

/**
 * Build 0080: the EFFECTIVE value of every supported application preference (what the editor would use right now, defaults included), for the native
 * host's "Export Preferences…". Read-only by construction: it reads `localStorage` through each preference's own normalizer and never writes (the
 * application settings are read through a storage view whose writes are dropped, because `readAppPrefs` seeds a missing store).
 *
 * Only the keys listed here are supported. Panel layout and window state (object list width/open/order, inspector cards/visibility, pinned menus, closed
 * shape sections), last-used tool memory (edge modifier amounts) and migration markers are deliberately not preferences in this sense.
 * The host adds the native side; the host's list of web keys is `PortablePreferences.exportedKeys`.
 */
function raw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function json(key: string, fallback: unknown): unknown {
  try {
    const text = raw(key);
    return text === null ? fallback : JSON.parse(text);
  } catch {
    return fallback;
  }
}

/** A flag that is on unless stored as "false" (`!== "false"` in the editor), or off unless stored as "true". */
const onUnlessFalse = (key: string) => raw(key) !== "false";
const offUnlessTrue = (key: string) => raw(key) === "true";

function readOnlyStorage(): Storage {
  return {
    get length() {
      return window.localStorage.length;
    },
    key: (index: number) => window.localStorage.key(index),
    getItem: (key: string) => window.localStorage.getItem(key),
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  } as Storage;
}

export function preferencesSnapshot(): Record<string, unknown> {
  const invert = json("layerling.spaceMouseInvert", {}) as Record<string, unknown>;
  const result: Record<string, unknown> = {
    "layerling.theme": normalizeAppThemePreference(raw("layerling.theme")),
    "layerling.language": getLanguage(),
    "layerling.toolbarSize": normalizeToolbarSize(raw("layerling.toolbarSize")),
    "layerling.shapeColors": normalizeShapeColors(raw("layerling.shapeColors")),
    "layerling.viewCubePosition": normalizeViewCubePosition(raw("layerling.viewCubePosition")),
    "layerling.simpleMode": resolveSimpleMode(normalizeSimpleModeChoice(raw("layerling.simpleMode")), null),
    "layerling.appPrefs.v1": readAppPrefs(readOnlyStorage()),
    // The workspace defaults saved for new documents; null: none saved, the application defaults apply.
    "layerling.workspaceDefault.global": json("layerling.workspaceDefault.global", null),
    "layerling.ribbonOrder": [...normalizeRibbonOrder(json("layerling.ribbonOrder", []))],
    "layerling.ribbonHidden": [...normalizeRibbonHidden(json("layerling.ribbonHidden", []))].sort(),
    "layerling.ribbonFold": normalizeRibbonFold(json("layerling.ribbonFold", {})),
    "layerling.ribbonToolOrder": normalizeRibbonToolOrder(json("layerling.ribbonToolOrder", {})),
    "layerling.customShortcuts": normalizeCustomShortcuts(json("layerling.customShortcuts", {})),
    "layerling.viewScrollbars": raw("layerling.viewScrollbars") === "on",
    "layerling.touchHandleMode": isTouchHandleMode(raw("layerling.touchHandleMode")) ? raw("layerling.touchHandleMode") : "all",
    "layerling.spaceMouseInvert": { lift: invert.lift === true, shift: invert.shift === true, tilt: invert.tilt === true, twist: invert.twist === true, zoom: invert.zoom === true },
    "layerling.stencilBridgeTool": normalizeStencilBridgeTool({ ...(json("layerling.stencilBridgeTool", null) as object | null), height: null }),
    "layerling.importKeepSvgPage": raw("layerling.importKeepSvgPage") === "1",
    "layerling.printMaterial": normalizePrintMaterial(raw("layerling.printMaterial")),
    "layerling.printInfill": normalizeInfillPercent(raw("layerling.printInfill")),
    "layerling.printWalls": normalizeWalls(raw("layerling.printWalls")),
    "layerling.sketch.keepProportions": offUnlessTrue("layerling.sketch.keepProportions"),
    "layerling.sketch.showPartEdges": offUnlessTrue("layerling.sketch.showPartEdges"),
    "layerling.editor.startInPerspective": onUnlessFalse("layerling.editor.startInPerspective"),
    "layerling.editor.originDimensionsEnabled": onUnlessFalse("layerling.editor.originDimensionsEnabled"),
    "layerling.editor.moveDimensionsEnabled": onUnlessFalse("layerling.editor.moveDimensionsEnabled"),
    "layerling.editor.startWithCornerRuler": offUnlessTrue("layerling.editor.startWithCornerRuler"),
    "layerling.editor.keepProportions": offUnlessTrue("layerling.editor.keepProportions"),
    "layerling.editor.simplifyKeepEdges": onUnlessFalse("layerling.editor.simplifyKeepEdges"),
    "layerling.editor.sectionCutFace": normalizeSectionCutFace(raw("layerling.editor.sectionCutFace")),
    // The remembered pattern colour; null: none remembered (the pattern contrasts with the body).
    "layerling.editor.surfacePatternColor": rememberedPatternColor(),
    "layerling.editor.historyViewSpeed": ["slow", "normal", "fast"].includes(raw("layerling.editor.historyViewSpeed") ?? "") ? raw("layerling.editor.historyViewSpeed") : "normal",
  };
  return result;
}

declare global {
  interface Window {
    layerlingPreferencesSnapshot?: () => Record<string, unknown>;
  }
}

/** Makes the snapshot reachable for the host (`window.layerlingPreferencesSnapshot()`); a no-op outside a browser. */
export function installPreferencesSnapshot() {
  if (typeof window === "undefined") return;
  window.layerlingPreferencesSnapshot = preferencesSnapshot;
}
