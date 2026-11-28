import { displayShapeName } from "@/lib/shapeCatalog";
import type { WorkplaneNote, WorkplaneShape } from "@/types/layerling";

/**
 * One group being edited: the group as it was, the ids of its loose parts,
 * and the notes pinned to it when it was opened, where they stood - cancelling
 * puts them back.
 */
/**
 * Build 0127 (native app): `openedParts` are the world parts this level opened with (what `restoreGroupedChildren` made), so that Done can tell which parts the person touched: the ones not
 * touched are taken verbatim from `original` and a group's pose (rotation, mirror, resize) is kept (lib/groupPose.ts).
 */
export type OpenGroupLevel = { original: WorkplaneShape; childIds: string[]; notes: WorkplaneNote[]; session?: OpenGroupSession; openedParts?: WorkplaneShape[] };

/**
 * Build 0122 (native app): what the scene was right after this level opened, so finishing or cancelling can tell that nothing changed (the original comes back
 * exactly, with no rebuild). (Build 0123: the history side of a session is the session history frame, lib/historyFrames.ts.)
 */
export type OpenGroupSession = { shapesFingerprint: string; notes: WorkplaneNote[] };

/**
 * The list with `replacedIds` taken out and `replacement` put where the first of them stood (at the end if none is in the list). Opening a group puts its parts in the
 * group's place, and Done and Cancel put the group back where its first part stands: the user's order is never rearranged by group editing.
 */
export function replaceAtFirst<T extends { id: string }>(shapes: readonly T[], replacedIds: Iterable<string>, replacement: readonly T[]): T[] {
  const replaced = new Set(replacedIds);
  const at = shapes.findIndex((shape) => replaced.has(shape.id));
  const rest = shapes.filter((shape) => !replaced.has(shape.id));
  if (at < 0) return [...rest, ...replacement];
  // `at` counts the replaced ones before it too, but none stand before the first, so it is also the index in `rest`.
  return [...rest.slice(0, at), ...replacement, ...rest.slice(at)];
}

export function mcpOpenGroupSummary(level: OpenGroupLevel) {
  return { groupId: level.original.id, name: displayShapeName(level.original), partIds: level.childIds };
}

/**
 * Which objects on the workplane belong to the groups that are open for editing.
 *
 * Groups can be opened inside each other: the outermost one first, each next
 * one a part of the one before. Every level notes its parts by id. Many edits
 * replace a part with a new object under a new id - grouping two parts,
 * cutting, separating, ungrouping a group among them - and Done would then
 * leave that result outside the rebuilt group. The rule here: when one step
 * removes at least one part and brings in new objects, those objects take the
 * removed part's place, in the innermost level that lost a part. A step that
 * removes nothing (a new shape, a paste, a duplicate) adds nobody.
 *
 * Ids are only ever added, never dropped: undo and redo bring back the earlier
 * objects under their old ids, which are then still on the list. Done takes the
 * ids that are on the workplane at that moment. The same holds for a group
 * opened inside another one: it keeps its id through Done and Cancel, so the
 * level around it needs no change.
 */
export function trackOpenGroupLevels(
  levels: readonly (readonly string[])[],
  previous: readonly { id: string }[],
  next: readonly { id: string }[],
  /**
   * Build 0130 (native app): `addToInnermost` makes the rule central. A step that removes no part but ADDS objects (a new shape, a duplicate, a paste, an import, any tool added later) joins them to the
   * INNERMOST level, so the active editing context is the destination of every creation. Without it (the browser) such a step adds nobody, as before.
   */
  options: { addToInnermost?: boolean } = {},
): readonly (readonly string[])[] {
  const nextIds = new Set(next.map((shape) => shape.id));
  const previousIds = new Set(previous.map((shape) => shape.id));
  const removed = (id: string) => previousIds.has(id) && !nextIds.has(id);
  const replacing = levels.findLastIndex((partIds) => partIds.some(removed));
  const level = replacing >= 0 ? replacing : options.addToInnermost ? levels.length - 1 : -1;
  if (level < 0) return levels;
  const known = new Set(levels.flat());
  const added = next.map((shape) => shape.id).filter((id) => !previousIds.has(id) && !known.has(id));
  if (!added.length) return levels;
  const partIds = levels[level];
  // Where the first replaced part stood, so the rebuilt group keeps its order.
  const at = replacing >= 0 ? partIds.findIndex(removed) + 1 : partIds.length;
  const tracked = [...partIds.slice(0, at), ...added, ...partIds.slice(at)];
  return levels.map((ids, index) => (index === level ? tracked : ids));
}

/** The same rule for a single open group. */
export function trackOpenGroupParts(
  partIds: readonly string[],
  previous: readonly { id: string }[],
  next: readonly { id: string }[],
): readonly string[] {
  return trackOpenGroupLevels([partIds], previous, next)[0];
}

/**
 * How many levels, counted from the outermost, are still open after the
 * workplane changed to `presentIds`. A level ends when its group is back on the
 * workplane (undo went past its opening) or when nothing of it is left. A group
 * open inside it counts as one of its parts, so a level whose only remaining
 * part is the group open inside it stays open. When a level ends, every level
 * inside it ends too.
 */
export function openGroupLevelsStillOpen(
  levels: readonly { groupId: string; partIds: readonly string[] }[],
  presentIds: ReadonlySet<string>,
  /**
   * Build 0129 (native): a level whose parts are all gone is an EMPTY editing context, not a finished one: it stays open until Done (removes the group), Cancel (restores it) or Undo past its opening
   * (the group is back among the objects) resolves it. Without this (the browser) deleting every part ends the level silently, as before.
   */
  options: { keepEmpty?: boolean } = {},
): number {
  const reopened = levels.findIndex((level) => presentIds.has(level.groupId));
  const candidates = reopened < 0 ? levels.length : reopened;
  if (options.keepEmpty) return candidates;
  let open = candidates;
  let innerAlive = false;
  for (let index = candidates - 1; index >= 0; index -= 1) {
    const alive: boolean = innerAlive || levels[index].partIds.some((id) => presentIds.has(id));
    if (!alive) open = index;
    innerAlive = alive;
  }
  return open;
}

/** A group can be edited when nothing is open, or when it is a part of the innermost open group. */
export function canEditGroupAtLevel(levels: readonly { partIds: readonly string[] }[], groupId: string): boolean {
  const innermost = levels.at(-1);
  return !innermost || innermost.partIds.includes(groupId);
}
