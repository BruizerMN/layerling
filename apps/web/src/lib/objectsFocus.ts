import { groupCanKeepParts } from "@/lib/groupScale";
import { rowIdFor } from "@/lib/objectsSnapshot";
import { shapeDepth, shapeWidth } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/layerling";

/*
 * Nested navigational focus (Objects Sidebar, Build 0116; docs/OBJECTS-SIDEBAR-DESIGN.md section 2).
 *
 * The engine selects only live objects: the top level, and the parts of a group being edited. An object inside a CLOSED group cannot be a selection. The Objects Sidebar can still
 * point at it: a click on such a row establishes FOCUS on that exact object, a transient page state (a path: the live group the path starts at and the position of each next
 * object inside the one before). Focus is not selection, changes no document and makes no Undo step; establishing it clears the engine's selection so no ancestor or earlier
 * selection stays the target of a modeling operation. This module resolves a path against the current shapes. Pure: the (stored) shapes in, a description out.
 */

export interface NestedFocusPath {
  rootId: string;
  /** Position of each next object in the `groupedShapes` of the one before; the last one is the focused object. Never empty. */
  indices: number[];
}

/**
 * How the Workspace may mark the focused object:
 * - `exact`: the group around it lays its parts where its box says (`groupCanKeepParts`: not mirrored, deformed, filleted, textured, ...), so the part's own place and shape are reliable;
 * - `none`: they do not (or the object is hidden), so NOTHING is drawn: a mark in the wrong place would mislead more than none.
 * The viewport may still fall back from `exact` to the part's nominal bounding box when it cannot outline its geometry.
 */
export type NestedFocusPlacement = "exact" | "none";

export interface NestedFocusTarget {
  path: NestedFocusPath;
  /** The row id the host's outline uses for this object (the engine id, or `<parent>#<index>` for a part without one). */
  rowId: string;
  /** The names of the groups on the way and the object, outermost first. */
  names: string[];
  /** The focused object as the editor would place it if its groups were opened: in world coordinates, at the size the groups give it. */
  placed: WorkplaneShape;
  /** The object as stored (inside its group). */
  stored: WorkplaneShape;
  /** The group directly around it, as stored. */
  parent: WorkplaneShape;
  placement: NestedFocusPlacement;
}

/** `restore`: the editor's `restoreGroupedChildren` (a group's parts in world coordinates, one for each part, in order). */
export function resolveNestedFocus(
  shapes: readonly WorkplaneShape[],
  path: NestedFocusPath,
  nameOf: (shape: WorkplaneShape) => string,
  restore: (group: WorkplaneShape) => WorkplaneShape[],
): NestedFocusTarget | null {
  const root = shapes.find((shape) => shape.id === path.rootId);
  if (!root?.groupedShapes?.length || path.indices.length === 0) return null;
  let storedGroup: WorkplaneShape = root;
  let placedGroup: WorkplaneShape = root;
  let reliable = groupCanKeepParts(root);
  let parentRowId = root.id;
  const names = [nameOf(root)];
  for (let step = 0; step < path.indices.length; step += 1) {
    const index = path.indices[step];
    const storedPart = storedGroup.groupedShapes?.[index];
    if (!storedPart) return null;
    const rowId = rowIdFor(storedPart, parentRowId, index);
    names.push(nameOf(storedPart));
    const placedPart = restore(placedGroup)[index];
    if (!placedPart) return null;
    if (step === path.indices.length - 1) {
      const hidden = Boolean(storedPart.hidden);
      return { path, rowId, names, placed: placedPart, stored: storedPart, parent: storedGroup, placement: reliable && !hidden ? "exact" : "none" };
    }
    // Another group on the way down.
    if (!storedPart.groupedShapes?.length) return null;
    reliable = reliable && groupCanKeepParts(storedPart);
    storedGroup = storedPart;
    placedGroup = placedPart;
    parentRowId = rowId;
  }
  return null;
}

/**
 * The shapes with the object at `path` replaced by `update(object)`: the groups on the way are copied (never mutated), everything else is shared. Null when the path does not exist.
 * Used for the property edits the engine takes safely on an object inside a closed group (its name, its shape lock), which are metadata of the part and leave the group's own
 * geometry (a baked mesh the group carries) untouched.
 */
export function replaceNestedShape(shapes: readonly WorkplaneShape[], path: NestedFocusPath, update: (shape: WorkplaneShape) => WorkplaneShape): WorkplaneShape[] | null {
  const at = shapes.findIndex((shape) => shape.id === path.rootId);
  if (at < 0 || path.indices.length === 0) return null;
  const replaceIn = (group: WorkplaneShape, step: number): WorkplaneShape | null => {
    const children = group.groupedShapes;
    const index = path.indices[step];
    const child = children?.[index];
    if (!children || !child) return null;
    let replacement: WorkplaneShape | null;
    if (step === path.indices.length - 1) replacement = update(child);
    else replacement = child.groupedShapes?.length ? replaceIn(child, step + 1) : null;
    if (!replacement) return null;
    const next = [...children];
    next[index] = replacement;
    return { ...group, groupedShapes: next };
  };
  const replaced = replaceIn(shapes[at], 0);
  if (!replaced) return null;
  const result = [...shapes];
  result[at] = replaced;
  return result;
}

/** What the compact read-only Inspector card shows. */
export interface NestedFocusCardData {
  name: string;
  /** A group (or bundle) rather than an ordinary object: the section reads "Group Info". */
  isGroup: boolean;
  kind: string;
  hole: boolean;
  color: string | null;
  hidden: boolean;
  shapeLocked: boolean;
  /** Width, depth, height as the groups give them. */
  size: [number, number, number];
  /** Groups on the way and the object, outermost first. */
  pathNames: string[];
  placement: NestedFocusPlacement;
}

export function nestedFocusCard(target: NestedFocusTarget, displayName: string): NestedFocusCardData {
  const { placed, stored } = target;
  return {
    name: displayName,
    isGroup: Boolean(stored.groupedShapes?.length),
    kind: stored.kind,
    hole: Boolean(stored.hole),
    color: typeof stored.color === "string" && stored.color ? stored.color : null,
    hidden: Boolean(stored.hidden),
    shapeLocked: Boolean(stored.shapeLocked),
    size: [shapeWidth(placed), shapeDepth(placed), placed.height],
    pathNames: target.names,
    placement: target.placement,
  };
}
