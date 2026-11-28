import { trackOpenGroupLevels } from "@/lib/openGroupParts";
import type { WorkplaneShape } from "@/types/layerling";

/*
 * Build 0130 STEP 1 PROTOTYPE (test tree only; nothing in src uses it). The pure predicates the central rule would be made of, so the failing-first tests and the census can show the design works before it is built.
 * The names are what a production `lib/editingContext.ts` would export.
 */
export type ContextLevels = readonly (readonly string[])[];   // each level's member ids, outermost first (OpenGroupLevel.childIds)

/** EDITABILITY: the innermost level's members that exist now (nothing open: everything). */
export function editableIds(levels: ContextLevels, presentIds: ReadonlySet<string>): ReadonlySet<string> | null {
  const innermost = levels.at(-1);
  if (!innermost) return null;                                        // no context: no restriction
  return new Set(innermost.filter((id) => presentIds.has(id)));
}

/** The central membership rule: a commit that removes a part keeps today's placement rule; a commit that ADDS objects joins them to the innermost level even when it removed nothing. */
export function trackMembership(levels: ContextLevels, previous: readonly { id: string }[], next: readonly { id: string }[]): ContextLevels {
  if (!levels.length) return levels;
  const viaRemoval = trackOpenGroupLevels(levels, previous, next);
  const known = new Set(viaRemoval.flat());
  const previousIds = new Set(previous.map((shape) => shape.id));
  const added = next.map((shape) => shape.id).filter((id) => !previousIds.has(id) && !known.has(id));
  if (!added.length) return viaRemoval;
  const last = viaRemoval.length - 1;
  return viaRemoval.map((ids, index) => (index === last ? [...ids, ...added] : ids));
}

export type ContextViolation = { kind: "changed" | "removed" | "reordered"; id: string } | null;

/** Same object, or the same fields by REFERENCE (a tool's `{ ...shape }` shares the big nested data: mesh arrays, children), and only when a field was recreated a deep comparison of that shape. */
function sameShape(a: WorkplaneShape, b: WorkplaneShape) {
  if (a === b) return true;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  let shallow = true;
  for (const k of ka) if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) { shallow = false; break; }
  return shallow || JSON.stringify(a) === JSON.stringify(b);
}
const deepEqual = sameShape;

/**
 * The commit guard: a step may add objects and change or remove members, but must leave every object that is not a member as it was (same data) and in the same relative order. History navigation and group
 * transitions are exempt BY THE CALLER (they pass `exempt`), never inferred here.
 */
export function contextViolation(members: ReadonlySet<string> | null, previous: readonly WorkplaneShape[], next: readonly WorkplaneShape[], exempt = false): ContextViolation {
  if (!members || exempt) return null;
  const nextById = new Map<string, WorkplaneShape>();
  for (const shape of next) nextById.set(shape.id, shape);
  const survivors: string[] = [];
  for (const shape of previous) {
    if (members.has(shape.id)) continue;
    const now = nextById.get(shape.id);
    if (!now) return { kind: "removed", id: shape.id };
    if (!deepEqual(shape, now)) return { kind: "changed", id: shape.id };
    survivors.push(shape.id);
  }
  // relative order of the surroundings
  const surviving = new Set(survivors);
  const order = next.filter((shape) => surviving.has(shape.id)).map((shape) => shape.id);
  for (let i = 0; i < survivors.length; i += 1) if (order[i] !== survivors[i]) return { kind: "reordered", id: survivors[i] };
  return null;
}

/** Selection is only ever of editable objects (a context open); with none open everything is selectable. */
export const selectableOnly = (members: ReadonlySet<string> | null, ids: readonly string[]) => (members ? ids.filter((id) => members.has(id)) : [...ids]);

/** Q9: a group-level action on a Visual Group (lock all, hide all, ...) is all or nothing: refused when any object it would touch is not editable. */
export const groupActionAllowed = (members: ReadonlySet<string> | null, objectIds: readonly string[]) => !members || objectIds.every((id) => members.has(id));

/** The async safeguard: an operation that began in one context completes only in that same context (session and innermost group). */
export const contextToken = (sessionId: string | null, innermostGroupId: string | null) => `${sessionId ?? "-"}/${innermostGroupId ?? "-"}`;
