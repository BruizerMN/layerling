import { findVisualGroup, groupVisibilityStates, isVisualGroup, liveObjectIds, resolveVisualGroups, type GroupVisibility, type VisualGroup, type VisualGroupItem, type VisualGroupsRegistry } from "@/lib/visualGroups";
import type { WorkplaneShape } from "@/types/layerling";

/*
 * What the host's Visual Groups palette is shown: the registry as the objects that exist now see it, with each object's name and
 * own `hidden` flag and each group's aggregate eye. Pure: the editor stays the only source of truth, the palette only draws this.
 */

export interface PaletteObject {
  type: "object";
  id: string;
  name: string;
  kind: string;
  hidden: boolean;
  /** The object's own Lock Object flag (shape.locked). Groups carry no lock state. */
  locked: boolean;
  /** A geometric group that is open for editing: its row stays where it is, marked; the editor says so, the palette keeps no state of its own. */
  editing?: true;
}
export interface PaletteGroup {
  type: "group";
  id: string;
  name: string;
  /** All of its objects (at any depth) visible, all hidden, mixed, or it has none. */
  visibility: GroupVisibility;
  items: Array<PaletteGroup | PaletteObject>;
}
export interface VisualGroupsPaletteState {
  /** A history state is shown: the palette changes nothing. */
  readOnly: boolean;
  /** Build 0132: a group is being edited: every action except browsing, searching, expanding and collapsing is unavailable (the engine refuses them; the palette shows it). */
  locked?: boolean;
  groups: PaletteGroup[];
  /** The selected objects that are in a group, in selection order. */
  selected: string[];
}
/** The groups only, for the chooser that asks where objects should go. */
export interface ChooserGroup {
  id: string;
  name: string;
  groups: ChooserGroup[];
}

export function visualGroupsPaletteState(
  registry: VisualGroupsRegistry,
  shapes: readonly WorkplaneShape[],
  selectedIds: readonly string[],
  nameOf: (shape: WorkplaneShape) => string,
  readOnly: boolean,
  /** The original groups of the levels the editor has open: while open they are not among `shapes` (their parts are), but they keep their Visual Group. */
  openGroups: readonly WorkplaneShape[] = [],
): VisualGroupsPaletteState {
  const locked = openGroups.length > 0;
  if (registry.items.length === 0) return { readOnly, ...(locked ? { locked } : {}), groups: [], selected: [] };
  const live = liveObjectIds(shapes);
  const editingGroups = new Map(openGroups.filter((group) => !live.has(group.id)).map((group) => [group.id, group]));
  const resolved = resolveVisualGroups(registry, editingGroups.size > 0 ? new Set([...live, ...editingGroups.keys()]) : live);
  const byId = new Map<string, WorkplaneShape>([...editingGroups, ...shapes.map((shape): [string, WorkplaneShape] => [shape.id, shape])]);
  const states = groupVisibilityStates(resolved, shapes);
  const member = new Set<string>();
  const build = (group: VisualGroup): PaletteGroup => ({
    type: "group",
    id: group.id,
    name: group.name,
    visibility: states.get(group.id) ?? "empty",
    items: group.items.map((item: VisualGroupItem) => {
      if (isVisualGroup(item)) return build(item);
      const shape = byId.get(item.object) as WorkplaneShape;
      member.add(shape.id);
      return { type: "object" as const, id: shape.id, name: nameOf(shape), kind: shape.kind, hidden: Boolean(shape.hidden), locked: Boolean(shape.locked), ...(editingGroups.has(shape.id) ? { editing: true as const } : {}) };
    }),
  });
  const groups = resolved.items.map(build);
  // Only objects that exist are selectable; an open group is not one of them.
  return { readOnly, ...(locked ? { locked } : {}), groups, selected: selectedIds.filter((id) => member.has(id) && !editingGroups.has(id)) };
}

export function visualGroupsOutline(registry: VisualGroupsRegistry): ChooserGroup[] {
  const outline = (group: VisualGroup): ChooserGroup => ({ id: group.id, name: group.name, groups: group.items.filter(isVisualGroup).map(outline) });
  return registry.items.map(outline);
}

/** How deep a group tree may go to be shown as nested menus, and how many entries: past either the chooser is used (the host's menus nest 6 deep and hold 300 entries in all). */
export const MENU_MAX_GROUP_DEPTH = 5;
export const MENU_MAX_GROUP_ENTRIES = 120;

/** Whether the groups can be a cascading menu (the menu's own other items also count against the host's limit). */
export function visualGroupsMenuFits(groups: readonly ChooserGroup[]): boolean {
  let entries = 0;
  const fits = (list: readonly ChooserGroup[], depth: number): boolean => {
    if (list.length === 0) return true;
    if (depth > MENU_MAX_GROUP_DEPTH) return false;
    for (const group of list) {
      entries += group.groups.length > 0 ? 2 : 1; // a group that holds groups also has its own "Add to" line
      if (entries > MENU_MAX_GROUP_ENTRIES || !fits(group.groups, depth + 1)) return false;
    }
    return true;
  };
  return fits(groups, 1);
}

/** The id of a group that exists, or null: a palette or chooser that answers late may name one that is gone. */
export function existingGroupId(registry: VisualGroupsRegistry, id: unknown): string | null {
  return typeof id === "string" && findVisualGroup(registry, id) ? id : null;
}
