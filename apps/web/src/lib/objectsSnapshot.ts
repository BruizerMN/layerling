import type { WorkplaneShape } from "@/types/layerling";

/*
 * What the host's Objects Sidebar shows (capability `objects.v1`): the document's object hierarchy, exactly as the editor's own object list sees it (the shapes in the
 * design's own order; a group or bundle holds its parts, to any depth). Pure: the editor stays the only source of truth, the host only draws this.
 *
 * Three costs, kept apart so that ordinary selection never retransmits the hierarchy (see lib/host/nativeObjects.ts):
 *   - the STRUCTURE (which ids, in which order, nested how)  -> the whole tree (`objects.tree`), only when this changed;
 *   - the ROW PROPERTIES of an unchanged structure (name, hidden, locked, ...) -> only the rows that changed (`objects.patch`);
 *   - the SELECTION -> ids only (`objects.selection`), not computed here.
 */

/** The properties of one row. Flags are present only when true, and the colour only when the shape has one, to keep the message small. */
export interface ObjectProps {
  id: string;
  /** The name the editor's own object list shows (in the interface language). */
  name: string;
  /** The shape kind ("box", "cylinder", "group", ...). */
  kind: string;
  hole?: true;
  hidden?: true;
  /** Lock Object (the padlock). */
  locked?: true;
  /** Lock Shape (the shield). */
  shapeLocked?: true;
  color?: string;
  /** Present on a group or bundle: which. */
  group?: "group" | "bundle";
  /** The object carries a name somebody gave it (not the editor's default name): what "Sort named objects A-Z" puts first. */
  ownName?: true;
  /** A group that is open for editing: it keeps its place in the hierarchy, marked, with its live parts (which the engine can select) as its items. */
  editing?: true;
}
export interface ObjectRow extends ObjectProps {
  items?: ObjectRow[];
}

/** What the host accepts: depth and total rows (the host validates the same bounds). */
export const OBJECTS_MAX_DEPTH = 40;
export const OBJECTS_MAX_ROWS = 200_000;
/** A patch that would touch more rows than this (or a quarter of all rows) is sent as a whole tree instead. */
export const OBJECTS_PATCH_MAX_ROWS = 2_000;

/** The name the editor's object list shows for a shape (the same rules as ObjectListPanel's getShapeDisplayName, with `displayName` = shapeCatalog.displayShapeName). */
export function objectRowName(shape: WorkplaneShape, displayName: (shape: WorkplaneShape) => string, translate: (key: string) => string): string {
  if (shape.name?.trim()) return displayName(shape);
  if (shape.groupedShapes?.length) return translate("shape.group");
  if (shape.importedMesh) return translate("shape.importedMesh");
  return translate(`shape.${shape.kind}`) || shape.kind;
}

/** The id a row has in the outline: the engine's id, or, for a part of a group that carries none, a stable one made from its group's row id and its position. */
export function rowIdFor(shape: Pick<WorkplaneShape, "id">, parentRowId: string, index: number): string {
  return shape.id || `${parentRowId}#${index}`;
}

/** A group being edited: the group as it was, and the ids of its loose parts (the editor's `OpenGroupLevel`). Levels run outermost first. */
export interface OpenLevelInfo {
  original: WorkplaneShape;
  childIds: readonly string[];
}

/**
 * The hierarchy, or null when it is beyond the bounds (the host then shows no outline rather than a partial one). Groups open for editing keep their place: while a group is
 * edited its parts stand loose in the editor's list, in the group's place (see `replaceAtFirst`), and here they are shown under the group's own row, marked `editing`, so the
 * hierarchy does not change shape while it is edited.
 */
export function buildObjectRows(shapes: readonly WorkplaneShape[], nameOf: (shape: WorkplaneShape) => string, openLevels: readonly OpenLevelInfo[] = [], hasOwnName?: (shape: WorkplaneShape) => boolean): ObjectRow[] | null {
  let count = 0;
  const flags = (row: ObjectRow, shape: WorkplaneShape) => {
    if (shape.hole) row.hole = true;
    if (shape.hidden) row.hidden = true;
    if (shape.locked) row.locked = true;
    if (shape.shapeLocked) row.shapeLocked = true;
    if (typeof shape.color === "string" && shape.color) row.color = shape.color;
    if (hasOwnName?.(shape)) row.ownName = true;
  };
  const build = (list: readonly WorkplaneShape[], depth: number, parentId: string): ObjectRow[] | null => {
    if (depth > OBJECTS_MAX_DEPTH) return null;
    const rows: ObjectRow[] = [];
    for (let index = 0; index < list.length; index += 1) {
      const row = one(list[index], depth, parentId, index);
      if (!row) return null;
      rows.push(row);
    }
    return rows;
  };
  const one = (shape: WorkplaneShape, depth: number, parentId: string, index: number): ObjectRow | null => {
    if (++count > OBJECTS_MAX_ROWS || depth > OBJECTS_MAX_DEPTH) return null;
    // A part inside a group may carry no id of its own; it still needs a stable one for the host's outline.
    const row: ObjectRow = { id: rowIdFor(shape, parentId, index), name: nameOf(shape), kind: shape.kind };
    flags(row, shape);
    if (shape.groupedShapes?.length) {
      row.group = shape.groupOperation === "bundle" ? "bundle" : "group";
      const items = build(shape.groupedShapes, depth + 1, row.id);
      if (!items) return null;
      row.items = items;
    }
    return row;
  };
  if (openLevels.length === 0) return build(shapes, 1, "");

  // Groups being edited: walk the list in its own order; a part of level k stands under the rows of the groups of levels 0..k, which appear where their first part stands.
  const levelOf = new Map<string, number>();
  openLevels.forEach((level, index) => level.childIds.forEach((id) => levelOf.set(id, index)));
  const editingRows: Array<ObjectRow | null> = openLevels.map(() => null);
  const root: ObjectRow[] = [];
  for (const shape of shapes) {
    const level = levelOf.get(shape.id) ?? -1;
    let container = root;
    for (let k = 0; k <= level; k += 1) {
      let editing = editingRows[k];
      if (!editing) {
        const original = openLevels[k].original;
        if (++count > OBJECTS_MAX_ROWS || k + 1 > OBJECTS_MAX_DEPTH) return null;
        editing = { id: original.id, name: nameOf(original), kind: original.kind, group: original.groupOperation === "bundle" ? "bundle" : "group", editing: true, items: [] };
        flags(editing, original);
        editingRows[k] = editing;
        container.push(editing);
      }
      container = editing.items as ObjectRow[];
    }
    const row = one(shape, level + 2, "", container.length);
    if (!row) return null;
    container.push(row);
  }
  return root;
}

/** A hierarchy reduced to what the three costs compare: the structure as one string, and each row's properties as one string by id. */
export interface ObjectsFlat {
  structure: string;
  props: Map<string, string>;
  rows: Map<string, ObjectProps>;
  count: number;
}

export function flattenObjectRows(rows: readonly ObjectRow[]): ObjectsFlat {
  const parts: string[] = [];
  const props = new Map<string, string>();
  const byId = new Map<string, ObjectProps>();
  const walk = (list: readonly ObjectRow[]) => {
    for (const row of list) {
      const { items, ...own } = row;
      // Opening or closing a group changes what its descendants are (selectable or not), so it is a change of structure, never a patch.
      parts.push(row.editing ? `${row.id}\u0003` : row.id);
      props.set(row.id, JSON.stringify(own));
      byId.set(row.id, own);
      if (items) {
        parts.push("\u0001"); // enter
        walk(items);
        parts.push("\u0002"); // leave
      }
    }
  };
  walk(rows);
  return { structure: parts.join("\u0000"), props, rows: byId, count: byId.size };
}

export type ObjectsDiff = { kind: "none" } | { kind: "tree" } | { kind: "patch"; rows: ObjectProps[] };

/**
 * What the host needs to learn about `next`, given that it has `prev` (null: it has nothing). A different structure (or a different read-only state, which the caller
 * folds into `prev`) needs the whole tree; the same structure with other properties needs only the rows that changed.
 */
export function diffObjects(prev: ObjectsFlat | null, next: ObjectsFlat): ObjectsDiff {
  if (!prev || prev.structure !== next.structure) return { kind: "tree" };
  const changed: ObjectProps[] = [];
  for (const [id, key] of next.props) {
    if (prev.props.get(id) !== key) changed.push(next.rows.get(id) as ObjectProps);
  }
  if (changed.length === 0) return { kind: "none" };
  if (changed.length > OBJECTS_PATCH_MAX_ROWS || changed.length * 4 > next.count) return { kind: "tree" };
  return { kind: "patch", rows: changed };
}
