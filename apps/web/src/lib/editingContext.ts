import { trackOpenGroupLevels } from "@/lib/openGroupParts";
import type { WorkplaneNote, WorkplaneShape } from "@/types/layerling";

/**
 * Build 0130: the editing context as a BOUNDARY FOR MODELING OPERATIONS (native app only; the browser never has one).
 *
 * Isolation is a model integrity guarantee, not a viewport feature: everything here is about the data, whether the surroundings are drawn fully, faintly or not at all.
 * Three properties of an object O with respect to the innermost open context C, kept apart on purpose (docs/BUILD-0130-PLAN.md section 3):
 *  - VISIBILITY: whether O is drawn (the persistent `hidden` flag; 0131 adds the Surroundings opacity). Not decided here.
 *  - EDITABILITY: whether a command may select, change, remove, hide, lock, rename, copy or consume O as a modeling operand: membership in C, and nothing else (`editableIds`).
 *  - REFERENCE ELIGIBILITY: whether O may be a snap target, alignment or measuring partner or a face a workplane is set on, WITHOUT being modified. A surrounding is an eligible reference, never an eligible operand.
 * Pure: levels and shapes in, answers out.
 */
export type ContextLevelIds = readonly (readonly string[])[];

/** The innermost level's members that exist now; null when no context is open (no restriction). */
export function editableIds(levels: ContextLevelIds, presentIds: ReadonlySet<string>): ReadonlySet<string> | null {
  const innermost = levels.at(-1);
  if (!innermost) return null;
  return new Set(innermost.filter((id) => presentIds.has(id)));
}

/** The members of the innermost context among `ids` (nothing open: all of them). The one rule for selection, marquee, Select All, Invert, the Sidebar and MCP. */
export function onlyEditable<T extends string>(members: ReadonlySet<string> | null, ids: readonly T[]): T[] {
  return members ? ids.filter((id) => members.has(id)) : [...ids];
}

/** Central membership: a step that removes a part keeps the placement rule of `trackOpenGroupLevels`; a step that only ADDS objects (new, duplicate, paste, import, any future tool) joins them to the innermost level. */
export function trackContextMembership(levels: ContextLevelIds, previous: readonly { id: string }[], next: readonly { id: string }[]): ContextLevelIds {
  return trackOpenGroupLevels(levels, previous, next, { addToInnermost: true });
}

export type ContextViolation = { kind: "changed" | "removed" | "reordered"; id: string };

/**
 * Same object, or the same fields BY REFERENCE (a tool's `{ ...shape }` shares the big nested data: meshes, children), and only when a field was recreated a deep comparison of that shape.
 * Reference equality is a reliable "unchanged" only because shapes are never mutated in place (the history keeps references; verified by tests/unit/groupIntegrity/immutability.test.ts).
 */
export function sameShapeData(a: WorkplaneShape, b: WorkplaneShape): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  let shallow = true;
  for (const key of ka) {
    if ((a as unknown as Record<string, unknown>)[key] !== (b as unknown as Record<string, unknown>)[key]) {
      shallow = false;
      break;
    }
  }
  return shallow || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The commit guard. A step may add objects and change or remove members, but must leave every object that is not a member as it was (same data) and in the same relative order.
 * Run on the tool's `next` BEFORE canonicalization. Group transitions and history navigation are exempt, declared by their callers, never inferred here.
 */
export function contextViolation(members: ReadonlySet<string> | null, previous: readonly WorkplaneShape[], next: readonly WorkplaneShape[]): ContextViolation | null {
  if (!members) return null;
  const nextById = new Map<string, WorkplaneShape>();
  for (const shape of next) nextById.set(shape.id, shape);
  const survivors: string[] = [];
  for (const shape of previous) {
    if (members.has(shape.id)) continue;
    const now = nextById.get(shape.id);
    if (!now) return { kind: "removed", id: shape.id };
    if (!sameShapeData(shape, now)) return { kind: "changed", id: shape.id };
    survivors.push(shape.id);
  }
  const surviving = new Set(survivors);
  const order = next.filter((shape) => surviving.has(shape.id)).map((shape) => shape.id);
  for (let index = 0; index < survivors.length; index += 1) if (order[index] !== survivors[index]) return { kind: "reordered", id: survivors[index] };
  return null;
}

/**
 * Surroundings are carried forward BY THEIR EXISTING REFERENCES: the guard has shown they are unchanged, so the rest of the commit pipeline (canonicalization) must not recreate or alter them either.
 * Members and new objects are canonicalized as always. (Not an application-wide change to canonicalization: the deferred inventory F2 stays.)
 */
export function carryProtected(members: ReadonlySet<string> | null, previous: readonly WorkplaneShape[], next: readonly WorkplaneShape[], canonicalize: (shape: WorkplaneShape) => WorkplaneShape): WorkplaneShape[] {
  if (!members) return next.map(canonicalize);
  const before = new Map<string, WorkplaneShape>();
  for (const shape of previous) before.set(shape.id, shape);
  return next.map((shape) => {
    const was = before.get(shape.id);
    return was && !members.has(shape.id) ? was : canonicalize(shape);
  });
}

/** A group-level action (a Visual Group's lock all, hide all, ...) is all or nothing: allowed only when every object it would touch is editable. */
export const groupActionAllowed = (members: ReadonlySet<string> | null, objectIds: readonly string[]) => !members || objectIds.every((id) => members.has(id));

/**
 * The activation of an editing context: a counter that changes on EVERY successful context transition (open, descend, finish, cancel, a session ending any other way, a document replaced).
 * An operation that began in one activation completes only in the same one: entering A, starting an import, entering B, finishing B and returning to A is a different activation (the session id and the group id match again, the generation does not).
 */
export type ContextActivation = { generation: number };
export const newContextActivation = (): ContextActivation => ({ generation: 0 });
export const activationChanged = (started: number, now: number) => started !== now;

/**
 * Notes are associated data. A note attached to an object that exists but is not a member (a surrounding) may not be changed, removed, detached or reassigned, and no note may be attached to one: the id of the first
 * offending note, or null. Notes attached to the open group itself (absent while it is open) or to members, and free notes, are the session's to change (its Undo, Redo and Cancel carry them).
 */
export function notesViolation(members: ReadonlySet<string> | null, presentIds: ReadonlySet<string>, previous: readonly WorkplaneNote[], next: readonly WorkplaneNote[]): string | null {
  if (!members) return null;
  const protectedNote = (note: WorkplaneNote) => Boolean(note.anchor && presentIds.has(note.anchor.shapeId) && !members.has(note.anchor.shapeId));
  const before = new Map(previous.map((note) => [note.id, note]));
  const after = new Map(next.map((note) => [note.id, note]));
  for (const note of previous) {
    if (!protectedNote(note)) continue;
    const now = after.get(note.id);
    if (!now || JSON.stringify(now) !== JSON.stringify(note)) return note.id;
  }
  for (const note of next) {
    if (!protectedNote(note)) continue;
    const was = before.get(note.id);
    if (!was || JSON.stringify(was) !== JSON.stringify(note)) return note.id;
  }
  return null;
}

export type PreparedContextCommit = { ok: true; shapes: WorkplaneShape[] } | { ok: false; violation: ContextViolation };

/**
 * The context part of a commit, in one pure function (the part `commitShapes` runs before anything is written): the guard on the tool's own result (BEFORE canonicalization, reference first), then the shapes as they
 * will be stored: surroundings carried forward by their existing references, members and new objects canonicalized. With no context (members null) it is exactly `next.map(canonicalize)`.
 * Acceptance criterion (Bill, 2026-11-28): the surroundings are unchanged after the ENTIRE pipeline, not merely when the proposed change enters it.
 */
export function prepareContextCommit(members: ReadonlySet<string> | null, previous: readonly WorkplaneShape[], next: readonly WorkplaneShape[], canonicalize: (shape: WorkplaneShape) => WorkplaneShape): PreparedContextCommit {
  const violation = contextViolation(members, previous, next);
  if (violation) return { ok: false, violation };
  return { ok: true, shapes: carryProtected(members, previous, next, canonicalize) };
}

/** The chain of open groups as one string: the activation of the editing context changes whenever it does. */
export const contextChain = (levels: readonly { original: { id: string } }[]) => levels.map((level) => level.original.id).join("/");
