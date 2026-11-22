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
): VisualGroupsPaletteState {
  if (registry.items.length === 0) return { readOnly, groups: [], selected: [] };
  const live = liveObjectIds(shapes);
  const resolved = resolveVisualGroups(registry, live);
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));
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
      return { type: "object" as const, id: shape.id, name: nameOf(shape), kind: shape.kind, hidden: Boolean(shape.hidden) };
    }),
  });
  const groups = resolved.items.map(build);
  return { readOnly, groups, selected: selectedIds.filter((id) => member.has(id)) };
}

export function visualGroupsOutline(registry: VisualGroupsRegistry): ChooserGroup[] {
  const outline = (group: VisualGroup): ChooserGroup => ({ id: group.id, name: group.name, groups: group.items.filter(isVisualGroup).map(outline) });
  return registry.items.map(outline);
}

/** The id of a group that exists, or null: a palette or chooser that answers late may name one that is gone. */
export function existingGroupId(registry: VisualGroupsRegistry, id: unknown): string | null {
  return typeof id === "string" && findVisualGroup(registry, id) ? id : null;
}
