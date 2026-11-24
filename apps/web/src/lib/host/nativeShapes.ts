import { SHAPE_LIBRARY_SECTION_LABELS, shapeLibrarySections, type LibraryShape } from "@/lib/shapeLibrarySections";
import { t } from "@/lib/i18n";

/**
 * The shape catalogue as the native Shapes popover needs it (Build 0061; rides on `ribbon.state` of capability `ribbon.v1`, key `shapes`). There is no second
 * catalogue: the host draws what the editor publishes here, from the very same library the web chooser lists (`libraryShapeAssets`, the simple-mode filter, the
 * sections, the localized names, the colour a new shape starts with), and asks the editor to put a shape in with `ribbon.invoke` and the tool id `shape:<asset id>`,
 * which runs the web chooser's own handler (click-to-place, saved defaults, recently used, undo, the special shapes). Nothing is created by the host.
 */
export const NATIVE_SHAPE_TOOL_PREFIX = "shape:";

export interface NativeShapeEntry {
  id: string;
  /** The name in the current language, as the web chooser shows it. */
  name: string;
  /** The picture, relative to the site root (the grey library icon); the host draws it from its bundled copy of the site. */
  icon: string;
  /** The colour the picture wears (the one a new shape starts with, saved defaults included); null while "Shapes in colour" is off. */
  color: string | null;
}
export interface NativeShapesSection {
  id: string;
  label: string;
  shapeIds: string[];
}
export interface NativeShapesCatalog {
  shapes: NativeShapeEntry[];
  sections: NativeShapesSection[];
  /** Recently used shape ids, newest first. */
  recent: string[];
  /** The heading of the recently used shapes, in the current language. */
  recentLabel: string;
}

export function nativeShapeTool(id: string): string {
  return `${NATIVE_SHAPE_TOOL_PREFIX}${id}`;
}

/** The asset id a `ribbon.invoke` tool id asks for, or null when it is not a shape request. */
export function nativeShapeIdFromTool(toolId: string): string | null {
  return toolId.startsWith(NATIVE_SHAPE_TOOL_PREFIX) && toolId.length > NATIVE_SHAPE_TOOL_PREFIX.length ? toolId.slice(NATIVE_SHAPE_TOOL_PREFIX.length) : null;
}

export function buildNativeShapesCatalog<T extends LibraryShape & { menuIcon: string }>(input: {
  shapes: readonly T[];
  label: (shape: T) => string;
  color: (shape: T) => string;
  colors: boolean;
  recent: readonly string[];
}): NativeShapesCatalog {
  const known = new Set(input.shapes.map((shape) => shape.id));
  return {
    shapes: input.shapes.map((shape) => ({ id: shape.id, name: input.label(shape), icon: shape.menuIcon.replace(/^\/+/, ""), color: input.colors ? input.color(shape) : null })),
    sections: shapeLibrarySections(input.shapes).map((section) => ({ id: section.id, label: t(SHAPE_LIBRARY_SECTION_LABELS[section.id]), shapeIds: section.shapes.map((shape) => shape.id) })),
    recent: input.recent.filter((id) => known.has(id)),
    recentLabel: t("library.recent"),
  };
}
