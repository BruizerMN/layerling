import { createLocalId } from "@/lib/localIds";
import type { WorkplaneShape } from "@/types/layerling";

/*
 * Visual Groups: named, nested, ordered collections of objects, for organisation only.
 *
 * - The registry is one ordered tree. A group holds objects (by id) and other groups; the root holds groups only.
 *   Order, nesting and membership are all this one structure, so they cannot disagree.
 * - A group has NO visibility of its own. Its eye is a bulk operation on the objects' own `hidden` flags
 *   (`toggleGroupVisibility`); an object is the only arbiter of its visibility.
 * - The registry is document-level and not part of the undo history. Reads filter by the objects that exist
 *   now (`liveIds`), so after any geometric undo/redo it is valid by construction. Operations that give an object
 *   a new id (merge, ungroup, duplicate) ADD the new id and leave the old one in place; the old id is stale (never
 *   shown) until it is pruned on save, so undoing such an operation finds the original objects in their groups.
 * - Every function is pure and returns the same registry object when nothing changed.
 */

/** An object in a group, by its id. */
export type VisualGroupObject = { object: string };
export type VisualGroupItem = VisualGroupObject | VisualGroup;
export type VisualGroup = { id: string; name: string; items: VisualGroupItem[] };
/** The whole registry. The root holds groups only: an object that is in no group is not listed anywhere. */
export type VisualGroupsRegistry = { items: VisualGroup[] };

export const EMPTY_VISUAL_GROUPS: VisualGroupsRegistry = Object.freeze({ items: [] as VisualGroup[] }) as VisualGroupsRegistry;
export const DEFAULT_VISUAL_GROUP_NAME = "Visual Group";
export const MAX_VISUAL_GROUP_NAME = 200;
const MAX_DEPTH = 32;
const MAX_GROUPS = 10_000;

export function isVisualGroup(item: VisualGroupItem): item is VisualGroup {
  return "items" in item;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cleanVisualGroupName(name: unknown): string {
  const text = typeof name === "string" ? name.trim().slice(0, MAX_VISUAL_GROUP_NAME).trim() : "";
  return text || DEFAULT_VISUAL_GROUP_NAME;
}

export function liveObjectIds(shapes: readonly Pick<WorkplaneShape, "id">[]): Set<string> {
  return new Set(shapes.map((shape) => shape.id));
}

// ---- reading and healing ------------------------------------------------------------------------------------------

/**
 * Builds a valid registry from anything (a file, a browser store). Never throws: what cannot be understood is left out.
 * Unique group ids, each object at most once (first in tree order wins), names cleaned, depth and size bounded. With
 * `liveIds`, objects that do not exist are left out as well.
 */
export function normalizeVisualGroups(raw: unknown, liveIds?: ReadonlySet<string>): VisualGroupsRegistry {
  const rootItems = isRecord(raw) && Array.isArray(raw.items) ? raw.items : [];
  const groupIds = new Set<string>();
  const objectIds = new Set<string>();
  const readGroup = (value: unknown, depth: number): VisualGroup | null => {
    if (!isRecord(value) || typeof value.id !== "string" || !value.id || groupIds.has(value.id) || groupIds.size >= MAX_GROUPS || depth > MAX_DEPTH) return null;
    groupIds.add(value.id);
    const items: VisualGroupItem[] = [];
    if (Array.isArray(value.items)) {
      for (const entry of value.items) {
        if (isRecord(entry) && typeof entry.object === "string") {
          const id = entry.object;
          if (!id || objectIds.has(id) || (liveIds && !liveIds.has(id))) continue;
          objectIds.add(id);
          items.push({ object: id });
        } else {
          const child = readGroup(entry, depth + 1);
          if (child) items.push(child);
        }
      }
    }
    return { id: value.id, name: cleanVisualGroupName(value.name), items };
  };
  const items: VisualGroup[] = [];
  for (const entry of rootItems) {
    const group = readGroup(entry, 0);
    if (group) items.push(group);
  }
  return items.length === 0 ? EMPTY_VISUAL_GROUPS : { items };
}

function pruneItems(items: readonly VisualGroupItem[], live: ReadonlySet<string>): VisualGroupItem[] | null {
  let changed = false;
  const next: VisualGroupItem[] = [];
  for (const item of items) {
    if (isVisualGroup(item)) {
      const inner = pruneItems(item.items, live);
      if (inner) {
        changed = true;
        next.push({ ...item, items: inner });
      } else next.push(item);
    } else if (live.has(item.object)) next.push(item);
    else changed = true;
  }
  return changed ? next : null;
}

/** The registry as the objects that exist now see it: stale ids left out, empty groups kept. This is what a palette shows. */
export function resolveVisualGroups(registry: VisualGroupsRegistry, live: ReadonlySet<string>): VisualGroupsRegistry {
  const items = pruneItems(registry.items, live);
  return items ? { items: items as VisualGroup[] } : registry;
}

/** The registry to write to a file, or undefined when there is nothing to write (no group at all): such a file is unchanged. */
export function serializableVisualGroups(registry: VisualGroupsRegistry, live: ReadonlySet<string>): VisualGroupsRegistry | undefined {
  const resolved = resolveVisualGroups(registry, live);
  return resolved.items.length > 0 ? resolved : undefined;
}

export function hasVisualGroups(registry: VisualGroupsRegistry | null | undefined): boolean {
  return Boolean(registry && registry.items.length > 0);
}

/** A short text that changes whenever anything saved changes (the registry's part of the document's "modified" signature). */
export function visualGroupsFingerprint(registry: VisualGroupsRegistry): string {
  return registry.items.length === 0 ? "" : JSON.stringify(registry);
}

// ---- queries --------------------------------------------------------------------------------------------------------

export function findVisualGroup(registry: VisualGroupsRegistry, groupId: string): VisualGroup | null {
  const search = (items: readonly VisualGroupItem[]): VisualGroup | null => {
    for (const item of items) {
      if (!isVisualGroup(item)) continue;
      if (item.id === groupId) return item;
      const inner = search(item.items);
      if (inner) return inner;
    }
    return null;
  };
  return search(registry.items);
}

/** Where each object is: the id of the group it is directly in. Objects outside `live` (when given) are left out. */
export function membershipMap(registry: VisualGroupsRegistry, live?: ReadonlySet<string>): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (group: VisualGroup) => {
    for (const item of group.items) {
      if (isVisualGroup(item)) walk(item);
      else if ((!live || live.has(item.object)) && !map.has(item.object)) map.set(item.object, group.id);
    }
  };
  registry.items.forEach(walk);
  return map;
}

/** The ids of every object in a group and in the groups inside it, in display order. */
export function descendantObjectIds(registry: VisualGroupsRegistry, groupId: string, live?: ReadonlySet<string>): string[] {
  const group = findVisualGroup(registry, groupId);
  if (!group) return [];
  const ids: string[] = [];
  const walk = (current: VisualGroup) => {
    for (const item of current.items) {
      if (isVisualGroup(item)) walk(item);
      else if (!live || live.has(item.object)) ids.push(item.object);
    }
  };
  walk(group);
  return ids;
}

/** A name for a new group that no group has yet: "Visual Group", "Visual Group 2", ... */
export function defaultVisualGroupName(registry: VisualGroupsRegistry): string {
  const names = new Set<string>();
  const collect = (items: readonly VisualGroupItem[]) => items.forEach((item) => { if (isVisualGroup(item)) { names.add(item.name); collect(item.items); } });
  collect(registry.items);
  if (!names.has(DEFAULT_VISUAL_GROUP_NAME)) return DEFAULT_VISUAL_GROUP_NAME;
  for (let n = 2; ; n += 1) if (!names.has(`${DEFAULT_VISUAL_GROUP_NAME} ${n}`)) return `${DEFAULT_VISUAL_GROUP_NAME} ${n}`;
}

// ---- tree editing (internal) ---------------------------------------------------------------------------------------

/** Applies `edit` to the item list of a group (null: the root list); null when the group does not exist. */
function editChildren(items: readonly VisualGroupItem[], parentId: string | null, edit: (list: VisualGroupItem[]) => VisualGroupItem[]): VisualGroupItem[] | null {
  if (parentId === null) return edit([...items]);
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!isVisualGroup(item)) continue;
    if (item.id === parentId) {
      const next = [...items];
      next[index] = { ...item, items: edit([...item.items]) };
      return next;
    }
    const inner = editChildren(item.items, parentId, edit);
    if (inner) {
      const next = [...items];
      next[index] = { ...item, items: inner };
      return next;
    }
  }
  return null;
}

function withRoot(registry: VisualGroupsRegistry, items: VisualGroupItem[] | null): VisualGroupsRegistry {
  if (!items) return registry;
  return { items: items.filter(isVisualGroup) };
}

function stripObjects(items: readonly VisualGroupItem[], ids: ReadonlySet<string>): VisualGroupItem[] | null {
  let changed = false;
  const next: VisualGroupItem[] = [];
  for (const item of items) {
    if (isVisualGroup(item)) {
      const inner = stripObjects(item.items, ids);
      if (inner) {
        changed = true;
        next.push({ ...item, items: inner });
      } else next.push(item);
    } else if (ids.has(item.object)) changed = true;
    else next.push(item);
  }
  return changed ? next : null;
}

function stripGroup(items: readonly VisualGroupItem[], groupId: string): VisualGroupItem[] | null {
  let changed = false;
  const next: VisualGroupItem[] = [];
  for (const item of items) {
    if (isVisualGroup(item)) {
      if (item.id === groupId) {
        changed = true;
        continue;
      }
      const inner = stripGroup(item.items, groupId);
      if (inner) {
        changed = true;
        next.push({ ...item, items: inner });
        continue;
      }
    }
    next.push(item);
  }
  return changed ? next : null;
}

/** The id of the group that holds `groupId` (null: the root); undefined when there is no such group. */
function parentOfGroup(items: readonly VisualGroupItem[], groupId: string, parent: string | null = null): string | null | undefined {
  for (const item of items) {
    if (!isVisualGroup(item)) continue;
    if (item.id === groupId) return parent;
    const inner = parentOfGroup(item.items, groupId, item.id);
    if (inner !== undefined) return inner;
  }
  return undefined;
}

function insertAt<T>(list: T[], index: number | undefined, entries: readonly T[]): T[] {
  const at = index === undefined || !Number.isFinite(index) ? list.length : Math.min(Math.max(0, Math.trunc(index)), list.length);
  list.splice(at, 0, ...entries);
  return list;
}

function uniqueIds(ids: readonly string[]): string[] {
  return ids.filter((id, index) => id && ids.indexOf(id) === index);
}

// ---- group operations -----------------------------------------------------------------------------------------------

/** A new empty group in `parentId` (root when absent or unknown) at `index` (end when absent). */
export function createVisualGroup(registry: VisualGroupsRegistry, options: { name?: string; parentId?: string | null; index?: number; id?: string } = {}): { registry: VisualGroupsRegistry; id: string } {
  const id = options.id && !findVisualGroup(registry, options.id) ? options.id : createLocalId("vg");
  const group: VisualGroup = { id, name: options.name === undefined ? defaultVisualGroupName(registry) : cleanVisualGroupName(options.name), items: [] };
  const parentId = options.parentId && findVisualGroup(registry, options.parentId) ? options.parentId : null;
  const items = editChildren(registry.items, parentId, (list) => insertAt(list, options.index, [group]));
  return { registry: withRoot(registry, items), id };
}

export function renameVisualGroup(registry: VisualGroupsRegistry, groupId: string, name: string): VisualGroupsRegistry {
  const group = findVisualGroup(registry, groupId);
  const cleaned = cleanVisualGroupName(name);
  if (!group || group.name === cleaned) return registry;
  const parent = parentOfGroup(registry.items, groupId);
  if (parent === undefined) return registry;
  return withRoot(registry, editChildren(registry.items, parent, (list) => list.map((item) => (isVisualGroup(item) && item.id === groupId ? { ...item, name: cleaned } : item))));
}

/**
 * Deletes a group but nothing it holds: its child groups move up into its place, in order; the objects it held directly
 * are in no group any more. Objects in the child groups stay where they are.
 */
export function deleteVisualGroup(registry: VisualGroupsRegistry, groupId: string): VisualGroupsRegistry {
  const group = findVisualGroup(registry, groupId);
  const parent = parentOfGroup(registry.items, groupId);
  if (!group || parent === undefined) return registry;
  const promoted = group.items.filter(isVisualGroup);
  return withRoot(registry, editChildren(registry.items, parent, (list) => list.flatMap((item) => (isVisualGroup(item) && item.id === groupId ? promoted : [item]))));
}

/**
 * Moves a group into `parentId` (null: the top level) at `index` among that parent's remaining items (end when absent):
 * this is both re-ordering (same parent) and re-parenting. A group cannot go into itself or into one of its own groups.
 */
export function moveVisualGroup(registry: VisualGroupsRegistry, groupId: string, parentId: string | null, index?: number): VisualGroupsRegistry {
  const group = findVisualGroup(registry, groupId);
  if (!group) return registry;
  if (parentId !== null && (parentId === groupId || !findVisualGroup(registry, parentId) || findVisualGroup({ items: [group] }, parentId))) return registry;
  const without = stripGroup(registry.items, groupId);
  if (!without) return registry;
  const moved = editChildren(without, parentId, (list) => insertAt(list, index, [group]));
  return withRoot(registry, moved);
}

// ---- membership operations ------------------------------------------------------------------------------------------

/**
 * Puts objects into a group at `index` among the group's remaining items (end when absent), in the order given. An object
 * that is in another group (or elsewhere in this one) leaves it first: an object is in one group at most.
 */
export function moveObjectsToGroup(registry: VisualGroupsRegistry, objectIds: readonly string[], groupId: string, index?: number): VisualGroupsRegistry {
  const ids = uniqueIds(objectIds);
  if (ids.length === 0 || !findVisualGroup(registry, groupId)) return registry;
  const stripped = stripObjects(registry.items, new Set(ids)) ?? registry.items;
  const next = editChildren(stripped, groupId, (list) => insertAt(list, index, ids.map((object) => ({ object }))));
  return withRoot(registry, next);
}

/** Takes objects out of whatever group holds them. The objects themselves are not touched. */
export function removeObjectsFromGroups(registry: VisualGroupsRegistry, objectIds: readonly string[]): VisualGroupsRegistry {
  const stripped = stripObjects(registry.items, new Set(objectIds));
  return stripped ? withRoot(registry, stripped) : registry;
}

/**
 * Gives new objects the group of an existing one, right after it (duplicate, ungroup, split): the anchor stays where it is, stale or
 * not, so undoing the operation finds it in place. An anchor that is in no group changes nothing.
 */
export function insertObjectsNear(registry: VisualGroupsRegistry, anchorId: string, newIds: readonly string[], where: "after" | "before" = "after"): VisualGroupsRegistry {
  const ids = uniqueIds(newIds).filter((id) => id !== anchorId);
  if (ids.length === 0) return registry;
  const owner = membershipMap(registry).get(anchorId);
  if (!owner) return registry;
  const stripped = stripObjects(registry.items, new Set(ids)) ?? registry.items;
  const next = editChildren(stripped, owner, (list) => {
    const at = list.findIndex((item) => !isVisualGroup(item) && item.object === anchorId);
    return insertAt(list, at < 0 ? undefined : where === "after" ? at + 1 : at, ids.map((object) => ({ object })));
  });
  return withRoot(registry, next);
}

// ---- geometric merge ------------------------------------------------------------------------------------------------

export type MergeDestination =
  | { kind: "none" }
  | { kind: "group"; groupId: string }
  | { kind: "conflict"; candidates: string[] };

/**
 * Where the object a merge makes goes. Same group: that group. Some in a group, the rest in none: the group. None in a group:
 * none. Objects in different groups: a conflict, with the groups in the order the objects were given (first object first), for
 * the caller to ask about: the selection's order is not reliable enough to decide silently.
 */
export function mergeDestination(registry: VisualGroupsRegistry, sourceIds: readonly string[]): MergeDestination {
  const owners = membershipMap(registry, new Set(sourceIds));
  const candidates: string[] = [];
  for (const id of sourceIds) {
    const owner = owners.get(id);
    if (owner && !candidates.includes(owner)) candidates.push(owner);
  }
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "group", groupId: candidates[0] };
  return { kind: "conflict", candidates };
}

/**
 * The object a merge made joins `groupId` (null: no group), at the place of the first source that is in that group (else at the end).
 * The sources stay in the registry as stale entries: undoing the merge finds them where they were.
 */
export function applyMerge(registry: VisualGroupsRegistry, sourceIds: readonly string[], resultId: string, groupId: string | null): VisualGroupsRegistry {
  if (groupId === null || !findVisualGroup(registry, groupId)) return registry;
  const stripped = stripObjects(registry.items, new Set([resultId])) ?? registry.items;
  const sources = new Set(sourceIds);
  const next = editChildren(stripped, groupId, (list) => {
    const at = list.findIndex((item) => !isVisualGroup(item) && sources.has(item.object));
    return insertAt(list, at < 0 ? undefined : at, [{ object: resultId }]);
  });
  return withRoot(registry, next);
}

// ---- bulk visibility ------------------------------------------------------------------------------------------------

export type GroupVisibility = "visible" | "hidden" | "mixed" | "empty";

function visibilityOf(visible: number, hidden: number): GroupVisibility {
  if (visible + hidden === 0) return "empty";
  if (hidden === 0) return "visible";
  if (visible === 0) return "hidden";
  return "mixed";
}

/**
 * What each group's eye shows, from the objects' own `hidden` flags: all of them visible, all hidden, mixed, or the group has no
 * object (at any depth). Objects that do not exist are not counted.
 */
export function groupVisibilityStates(registry: VisualGroupsRegistry, shapes: readonly Pick<WorkplaneShape, "id" | "hidden">[]): Map<string, GroupVisibility> {
  const hiddenById = new Map<string, boolean>();
  for (const shape of shapes) hiddenById.set(shape.id, Boolean(shape.hidden));
  const states = new Map<string, GroupVisibility>();
  const walk = (group: VisualGroup): { visible: number; hidden: number } => {
    let visible = 0;
    let hidden = 0;
    for (const item of group.items) {
      if (isVisualGroup(item)) {
        const inner = walk(item);
        visible += inner.visible;
        hidden += inner.hidden;
      } else {
        const flag = hiddenById.get(item.object);
        if (flag === undefined) continue;
        if (flag) hidden += 1;
        else visible += 1;
      }
    }
    states.set(group.id, visibilityOf(visible, hidden));
    return { visible, hidden };
  };
  registry.items.forEach(walk);
  return states;
}

export function groupVisibilityState(registry: VisualGroupsRegistry, groupId: string, shapes: readonly Pick<WorkplaneShape, "id" | "hidden">[]): GroupVisibility {
  return groupVisibilityStates(registry, shapes).get(groupId) ?? "empty";
}

export type GroupVisibilityToggle = {
  /** The shapes with the changed objects' `hidden` flags set; every other shape is the same object as before. */
  shapes: WorkplaneShape[];
  /** True when the group was hidden (all its objects were visible), false when its objects were shown. */
  hide: boolean;
  /** The objects whose flag changed. */
  changedIds: string[];
};

/**
 * The group's eye: if every object in the group (at any depth) is visible, hide them all; otherwise show them all. Only the
 * existing `hidden` flag is written, once, for all of them: the caller commits the result as one step. Null when the group is
 * unknown or holds no object, or nothing would change.
 */
export function toggleGroupVisibility(registry: VisualGroupsRegistry, groupId: string, shapes: readonly WorkplaneShape[]): GroupVisibilityToggle | null {
  const live = liveObjectIds(shapes);
  const ids = new Set(descendantObjectIds(registry, groupId, live));
  if (ids.size === 0) return null;
  const hide = groupVisibilityState(registry, groupId, shapes) === "visible";
  const changedIds: string[] = [];
  const next = shapes.map((shape) => {
    if (!ids.has(shape.id) || Boolean(shape.hidden) === hide) return shape;
    changedIds.push(shape.id);
    return { ...shape, hidden: hide };
  });
  return changedIds.length === 0 ? null : { shapes: next, hide, changedIds };
}

// ---- candidates for the merge question, and undoing a membership change that a merge makes in place -----------------------

export interface MergePickCandidate {
  id: string;
  name: string;
  /** How many of the merged objects are directly in this group. */
  count: number;
}

/** The groups the merged objects are in (they differ), in the order the objects were given, with how many objects each holds: what the question lists. */
export function mergePickCandidates(registry: VisualGroupsRegistry, sourceIds: readonly string[]): MergePickCandidate[] {
  const owners = membershipMap(registry, new Set(sourceIds));
  const found = new Map<string, MergePickCandidate>();
  for (const id of sourceIds) {
    const owner = owners.get(id);
    if (!owner) continue;
    const entry = found.get(owner) ?? { id: owner, name: findVisualGroup(registry, owner)?.name ?? "", count: 0 };
    entry.count += 1;
    found.set(owner, entry);
  }
  return [...found.values()];
}

/** Where an object is filed: its group and its place among that group's items (stale entries count, so the place is raw). */
export interface Placement {
  groupId: string;
  index: number;
}

export function placementOf(registry: VisualGroupsRegistry, objectId: string): Placement | null {
  const search = (group: VisualGroup): Placement | null => {
    for (let index = 0; index < group.items.length; index += 1) {
      const item = group.items[index];
      if (isVisualGroup(item)) {
        const inner = search(item);
        if (inner) return inner;
      } else if (item.object === objectId) return { groupId: group.id, index };
    }
    return null;
  };
  for (const group of registry.items) {
    const found = search(group);
    if (found) return found;
  }
  return null;
}

/**
 * A change to the group of an object that keeps its id (a geometric group that something was added to: it is modified in place, so the stale-entry
 * mechanism does not cover it). It is kept with the geometric history step, so Undo and Redo can take it back and bring it again.
 */
export interface MembershipChange {
  id: string;
  before: Placement | null;
  after: Placement | null;
}

/**
 * Undo (`direction` "undo") or redo of one change. If the person has filed the object somewhere else since, their later choice stays; a group that is
 * gone is no place, so the object is then in none.
 */
export function revertMembership(registry: VisualGroupsRegistry, change: MembershipChange, direction: "undo" | "redo"): VisualGroupsRegistry {
  const from = direction === "undo" ? change.after : change.before;
  const to = direction === "undo" ? change.before : change.after;
  const now = placementOf(registry, change.id);
  if ((now?.groupId ?? null) !== (from?.groupId ?? null)) return registry;
  if (!to || !findVisualGroup(registry, to.groupId)) return removeObjectsFromGroups(registry, [change.id]);
  return moveObjectsToGroup(registry, [change.id], to.groupId, to.index);
}
