import { describe, expect, it } from "vitest";
import { notesAfterShapeChange } from "@/lib/noteAnchoring";
import { createVisualGroup, liveObjectIds, membershipMap, moveObjectsToGroup, serializableVisualGroups, EMPTY_VISUAL_GROUPS } from "@/lib/visualGroups";
import type { WorkplaneNote, WorkplaneShape } from "@/types/layerling";
import { primitive } from "./support";

/*
 * Build 0129, step 1: the references a group carries, as the editor's own pure modules treat them (the rules 0129 relies on; no new code). The editor-level wiring (finishOpenGroup) cannot be run headlessly.
 */
const G = primitive("G", "box", { name: "Window" });
const other = primitive("O", "box");
const note: WorkplaneNote = { id: "n1", text: "hi", x: 1, y: 1, z: 1, anchor: { shapeId: "G", normalized: [0.5, 0.5, 0.5] } } as WorkplaneNote;

describe("Visual Groups membership (lazy-valid by live ids)", () => {
  const withMember = () => { const { registry, id } = createVisualGroup(EMPTY_VISUAL_GROUPS, { name: "Doors" }); return { registry: moveObjectsToGroup(registry, ["G", "O"], id), id }; };
  it("a group that keeps its id (one constituent left) stays a member, with no migration", () => {
    const { registry, id } = withMember();
    expect(membershipMap(registry, liveObjectIds([G, other])).get("G")).toBe(id);
  });
  it("an emptied group that is removed drops out of membership and the saved registry, without touching the others; Undo (the id is live again) restores it", () => {
    const { registry, id } = withMember();
    expect(membershipMap(registry, liveObjectIds([other])).has("G")).toBe(false);
    const saved = serializableVisualGroups(registry, liveObjectIds([other]))!;
    expect(JSON.stringify(saved)).not.toContain('"G"'); expect(JSON.stringify(saved)).toContain('"O"');
    expect(membershipMap(registry, liveObjectIds([G, other])).get("G")).toBe(id);   // the registry itself is not undo history and still holds G
  });
});

describe("notes of a group that is kept or removed", () => {
  const moved = { ...G, x: 5 } as WorkplaneShape;
  it("a note pinned to a group that keeps its id stays pinned (the id never leaves the document)", () => {
    expect(notesAfterShapeChange([note], [G, other], [moved, other])[0].anchor?.shapeId).toBe("G");
  });
  it("a note pinned to an emptied group that is removed becomes a free note where it was (not lost, not re-homed to an unrelated shape)", () => {
    const result = notesAfterShapeChange([note], [G, other], [other]);
    expect(result).toHaveLength(1); expect(result[0].anchor).toBeUndefined();
  });
});
