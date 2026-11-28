import { replaceAtFirst } from "@/lib/openGroupParts";
import { notesAfterShapeChange } from "@/lib/noteAnchoring";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import type { GroupReconstruction } from "@/lib/groupReconstruction";
import type { WorkplaneNote, WorkplaneShape } from "@/types/layerling";

/**
 * Build 0132 (native Group Editing): the TRANSACTIONAL completion of a chain of open editing levels, as a pure function over the editor's data.
 *
 * Every level from the deepest outwards is computed IN MEMORY with the production strict reconstruction (the unchanged-level exact restore and the emptied-group removal included). The result is either the complete
 * outcome, to be committed ONCE (one history step), or the first refusal with NO outcome: nothing of a successfully computed inner level survives a refusal, and the inputs are never written. `keepOpen` is how many
 * outermost levels stay open: 0 is whole-session Done; k is a click on the breadcrumb of the level at index k - 1 (the levels deeper than it complete).
 */
export type ChainLevel = { original: WorkplaneShape; childIds: string[]; openedParts?: WorkplaneShape[] };
export type ChainRebuild = (original: WorkplaneShape, parts: WorkplaneShape[], opened: readonly WorkplaneShape[] | undefined) => Promise<GroupReconstruction>;
export type ChainResult<L extends ChainLevel> =
  | {
    ok: true;
    /** The document's shapes after every deeper level completed: commit exactly once. */
    shapes: WorkplaneShape[];
    /** The levels that stay open, their member lists adjusted for groups that were emptied and removed. */
    open: L[];
    /** The group the outermost completed level became (it keeps its id), or null when there is none (kept open nothing, or it was emptied and removed). */
    result: WorkplaneShape | null;
    /** The outermost completed level's group, for the message. */
    completedOriginal: WorkplaneShape | null;
    /** The document's shapes after EACH completed level, deepest first (the states the per-level path committed one by one): needed so the notes follow exactly the same re-pinning sequence. */
    states: WorkplaneShape[][];
  }
  | { ok: false; level: number; message: string };

const sameShape = (a: WorkplaneShape, b: WorkplaneShape) => JSON.stringify(canonicalizeShape({ ...a, locked: false })) === JSON.stringify(canonicalizeShape({ ...b, locked: false }));

export async function finishChain<L extends ChainLevel>(shapes: readonly WorkplaneShape[], levels: readonly L[], keepOpen: number, rebuild: ChainRebuild): Promise<ChainResult<L>> {
  let cur: WorkplaneShape[] = [...shapes];
  const removedIds = new Set<string>();
  let result: WorkplaneShape | null = null;
  const states: WorkplaneShape[][] = [];
  const stop = Math.max(0, Math.min(keepOpen, levels.length));
  for (let k = levels.length - 1; k >= stop; k -= 1) {
    const level = levels[k];
    const present = new Map(cur.map((s) => [s.id, s]));
    // in their original order, unlocked: a part locked while the group was open still belongs in it
    const parts = level.childIds.flatMap((id) => (present.has(id) ? [{ ...present.get(id)!, locked: false }] : []));
    result = null;
    if (parts.length === 0) { removedIds.add(level.original.id); states.push(cur); continue; }                  // an emptied group is removed (0129)
    const opened = level.openedParts;
    if (opened && parts.length === opened.length && parts.every((p, i) => sameShape(p, opened[i]))) {
      result = level.original;                                                                 // an unchanged level comes back exactly (0122)
      cur = replaceAtFirst(cur, parts.map((p) => p.id), [level.original]);
      states.push(cur);
      continue;
    }
    const rebuilt = await rebuild(level.original, parts, opened);
    if ("removed" in rebuilt && rebuilt.removed) { removedIds.add(level.original.id); states.push(cur); continue; }
    if (!rebuilt.group) return { ok: false, level: k, message: rebuilt.failure };
    result = rebuilt.group;
    cur = replaceAtFirst(cur, parts.map((p) => p.id), [rebuilt.group]);
    states.push(cur);
  }
  const open = levels.slice(0, stop).map((level) => (level.childIds.some((id) => removedIds.has(id)) ? { ...level, childIds: level.childIds.filter((id) => !removedIds.has(id)) } : level)) as L[];
  return { ok: true, shapes: cur, open, result, completedOriginal: stop < levels.length ? levels[stop].original : null, states };
}

/**
 * The notes after completing the chain, re-pinned in EXACTLY the sequence the per-level path used (one step per completed level, each holding the groups still open around it): the note behaviour of Group Editing is
 * unchanged by committing once. (A single re-pinning against the final result would attach a few more notes to the final group; that would be a new behaviour and is not chosen here.)
 */
export function notesAfterChain(notes: WorkplaneNote[], before: readonly WorkplaneShape[], states: readonly WorkplaneShape[][], levels: readonly { original: WorkplaneShape }[]): WorkplaneNote[] {
  let current = notes;
  let previous: readonly WorkplaneShape[] = before;
  states.forEach((state, index) => {
    const held = new Set(levels.slice(0, levels.length - 1 - index).map((level) => level.original.id));
    current = notesAfterShapeChange(current, previous, state, held, true);
    previous = state;
  });
  return current;
}
