import { rebuildGroupFromParts } from "@/lib/groupReconstruction";
import { replaceAtFirst } from "@/lib/openGroupParts";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/layerling";
import { TRIANGLE_LIMIT } from "./support";

/*
 * Build 0132 STAGE 1 PROTOTYPE (test tree only; nothing in src uses it): the TRANSACTIONAL completion of a chain of open editing levels, as a pure function over the editor's data. It computes every level from the deepest
 * outwards IN MEMORY with the production strict reconstruction and returns either the complete result (to be committed ONCE) or the first refusal with NO result: nothing of a successfully computed inner level survives.
 * `keepOpen` is how many outermost levels stay open: 0 = whole-session Done; k = a click on breadcrumb k (levels deeper than it complete). A production version would be a pure lib module the editor calls.
 */
export type ChainLevel = { original: WorkplaneShape; childIds: string[]; openedParts: WorkplaneShape[] };
export type ChainResult = { ok: true; shapes: WorkplaneShape[]; open: ChainLevel[] } | { ok: false; level: number; message: string };

const sameShape = (a: WorkplaneShape, b: WorkplaneShape) => JSON.stringify(canonicalizeShape({ ...a, locked: false })) === JSON.stringify(canonicalizeShape({ ...b, locked: false }));

export async function finishChain(shapes: readonly WorkplaneShape[], levels: readonly ChainLevel[], keepOpen = 0): Promise<ChainResult> {
  let cur: WorkplaneShape[] = [...shapes];
  for (let k = levels.length - 1; k >= keepOpen; k -= 1) {
    const level = levels[k];
    const present = new Map(cur.map((s) => [s.id, s]));
    const parts = level.childIds.flatMap((id) => (present.has(id) ? [{ ...present.get(id)!, locked: false }] : []));
    if (parts.length === 0) continue;                                                           // an emptied group is removed (0129)
    if (parts.length === level.openedParts.length && parts.every((p, i) => sameShape(p, level.openedParts[i]))) {
      cur = replaceAtFirst(cur, parts.map((p) => p.id), [level.original]);                      // an unchanged level comes back exactly (0122)
      continue;
    }
    const r = await rebuildGroupFromParts(level.original, parts, { triangleLimit: TRIANGLE_LIMIT, strict: true, opened: level.openedParts });
    if ("removed" in r && r.removed) continue;
    if (!r.group) return { ok: false, level: k, message: r.failure };
    cur = replaceAtFirst(cur, parts.map((p) => p.id), [r.group]);
  }
  return { ok: true, shapes: cur, open: levels.slice(0, keepOpen) as ChainLevel[] };
}

/** What happens TODAY in effect: each level is finished and COMMITTED on its own; a refusal at an outer level comes after the inner levels have already been committed. Returns the state at the moment it stopped. */
export async function finishChainPerLevel(shapes: readonly WorkplaneShape[], levels: readonly ChainLevel[], keepOpen = 0): Promise<{ shapes: WorkplaneShape[]; open: ChainLevel[]; refused: { level: number; message: string } | null }> {
  let cur: WorkplaneShape[] = [...shapes];
  let open = [...levels];
  while (open.length > keepOpen) {
    const step = await finishChain(cur, open, open.length - 1);
    if (!step.ok) return { shapes: cur, open, refused: { level: step.level, message: step.message } };
    cur = step.shapes; open = step.open;
  }
  return { shapes: cur, open, refused: null };
}
