import { describe, expect, it } from "vitest";
import { nestedFocusCard, replaceNestedShape, resolveNestedFocus } from "@/lib/objectsFocus";
import { buildObjectRows } from "@/lib/objectsSnapshot";
import { parseObjectsInvoke } from "@/lib/host/nativeObjects";
import type { WorkplaneShape } from "@/types/layerling";

const shape = (id: string, extra: Record<string, unknown> = {}): WorkplaneShape => ({ id, kind: "box", color: "#ff0000", x: 0, z: 0, elevation: 0, width: 10, depth: 10, size: 10, height: 10, rotation: 0, ...extra }) as unknown as WorkplaneShape;
const nameOf = (s: WorkplaneShape) => s.name ?? `Box ${s.id}`;
// a restore that places parts 100 mm further along x per level, so a wrong level or index is visible in the result
const restore = (group: WorkplaneShape) => (group.groupedShapes ?? []).map((part, i) => ({ ...part, x: group.x + 100 + i }) as WorkplaneShape);

const deep = shape("g0", { groupedShapes: [shape("a"), shape("g1", { name: "Inner", groupedShapes: [shape("b"), shape("g2", { groupedShapes: [shape("leaf", { name: "Window" })] })] })] });
const doc = [shape("top"), deep, shape("z")];

describe("nested navigational focus: resolving a path", () => {
  it("finds the exact object at any depth, placed through every level", () => {
    const t = resolveNestedFocus(doc, { rootId: "g0", indices: [1, 1, 0] }, nameOf, restore)!;
    expect(t.stored.id).toBe("leaf");
    expect(t.names).toEqual(["Box g0", "Inner", "Box g2", "Window"]);
    expect(t.rowId).toBe("leaf");
    expect(t.parent.id).toBe("g2");
    expect(t.placed.x).toBe(302);   // three levels of restore: (100+1) + (100+1) + (100+0)
    expect(t.placement).toBe("exact");
  });
  it("finds a direct part and a part with a different index than its siblings", () => {
    expect(resolveNestedFocus(doc, { rootId: "g0", indices: [0] }, nameOf, restore)!.stored.id).toBe("a");
    expect(resolveNestedFocus(doc, { rootId: "g0", indices: [1, 0] }, nameOf, restore)!.stored.id).toBe("b");
  });
  it("never resolves to a top-level object or an ancestor in place of the focused one", () => {
    for (const indices of [[1, 1, 0], [1, 0], [0]]) {
      const t = resolveNestedFocus(doc, { rootId: "g0", indices }, nameOf, restore)!;
      expect(["top", "z", "g0"]).not.toContain(t.stored.id);
    }
  });
  it("returns null for a path that does not exist (a stale focus is dropped, not redirected)", () => {
    expect(resolveNestedFocus(doc, { rootId: "g0", indices: [5] }, nameOf, restore)).toBeNull();
    expect(resolveNestedFocus(doc, { rootId: "g0", indices: [0, 0] }, nameOf, restore)).toBeNull();   // "a" is not a group
    expect(resolveNestedFocus(doc, { rootId: "gone", indices: [0] }, nameOf, restore)).toBeNull();
    expect(resolveNestedFocus(doc, { rootId: "top", indices: [0] }, nameOf, restore)).toBeNull();     // not a group
    expect(resolveNestedFocus(doc, { rootId: "g0", indices: [] }, nameOf, restore)).toBeNull();
  });
  it("the row id is the one the outline uses", () => {
    const rows = buildObjectRows(doc, nameOf)!;
    const outlineIds: string[] = [];
    const walk = (list: typeof rows) => list.forEach((r) => { outlineIds.push(r.id); if (r.items) walk(r.items); });
    walk(rows);
    for (const indices of [[0], [1], [1, 0], [1, 1], [1, 1, 0]]) {
      expect(outlineIds).toContain(resolveNestedFocus(doc, { rootId: "g0", indices }, nameOf, restore)!.rowId);
    }
    const noId = [shape("g", { groupedShapes: [shape(""), shape("")] })];
    expect(resolveNestedFocus(noId, { rootId: "g", indices: [1] }, nameOf, restore)!.rowId).toBe("g#1");
  });
});

describe("nested focus: how reliably the Workspace may mark it", () => {
  it("is exact for plain groups, and not drawn when a group on the way cannot be trusted", () => {
    const mirrored = [shape("g0", { groupedShapes: [shape("g1", { mirrorX: true, groupedShapes: [shape("leaf")] })] })];
    expect(resolveNestedFocus(mirrored, { rootId: "g0", indices: [0, 0] }, nameOf, restore)!.placement).toBe("none");
    const filleted = [shape("g0", { edgeTreatments: [{ kind: "fillet" }], groupedShapes: [shape("leaf")] })];
    expect(resolveNestedFocus(filleted, { rootId: "g0", indices: [0] }, nameOf, restore)!.placement).toBe("none");
    const hull = [shape("g0", { groupOperation: "hull", groupedShapes: [shape("leaf")] })];
    expect(resolveNestedFocus(hull, { rootId: "g0", indices: [0] }, nameOf, restore)!.placement).toBe("none");
    expect(resolveNestedFocus(doc, { rootId: "g0", indices: [1, 1, 0] }, nameOf, restore)!.placement).toBe("exact");
  });
  it("a hidden object is not marked (it is not drawn, so a mark would mislead)", () => {
    const hidden = [shape("g0", { groupedShapes: [shape("leaf", { hidden: true })] })];
    expect(resolveNestedFocus(hidden, { rootId: "g0", indices: [0] }, nameOf, restore)!.placement).toBe("none");
  });
});

describe("nested focus: the card and the protocol", () => {
  it("the card describes the exact object", () => {
    const t = resolveNestedFocus([shape("g0", { groupedShapes: [shape("leaf", { name: "Window", hole: true, shapeLocked: true, width: 20, size: 20, depth: 5, height: 30, color: "#00ff00" })] })], { rootId: "g0", indices: [0] }, nameOf, restore)!;
    const card = nestedFocusCard(t, "Window");
    expect(card).toMatchObject({ name: "Window", kind: "box", hole: true, shapeLocked: true, hidden: false, color: "#00ff00", pathNames: ["Box g0", "Window"] });
    expect(card.size[2]).toBe(30);
  });
  it("focus is an op with a non-empty path of non-negative integers", () => {
    expect(parseObjectsInvoke("focus", { rootId: "g", indices: [1, 0] })).toEqual({ op: "focus", rootId: "g", indices: [1, 0] });
    expect(parseObjectsInvoke("focus", { rootId: "g", indices: [] })).toBeNull();
    expect(parseObjectsInvoke("focus", { rootId: "g", indices: [-1] })).toBeNull();
    expect(parseObjectsInvoke("focus", { indices: [0] })).toBeNull();
  });
});

describe("nested property edits (Build 0117): replaceNestedShape", () => {
  const path = { rootId: "g0", indices: [1, 1, 0] };
  it("replaces only the object at the path, copying the groups on the way and sharing everything else", () => {
    const next = replaceNestedShape(doc, path, (part) => ({ ...part, name: "Renamed" }))!;
    expect(next).not.toBe(doc);
    const leafOf = (shapes: WorkplaneShape[]) => shapes[1].groupedShapes![1].groupedShapes![1].groupedShapes![0];
    expect(leafOf(next).name).toBe("Renamed");
    expect(leafOf(doc as WorkplaneShape[]).name).toBe("Window");   // the original is untouched
    expect(next[0]).toBe(doc[0]);                                   // other top-level shapes are the very same objects
    expect(next[2]).toBe(doc[2]);
    expect(next[1]).not.toBe(doc[1]);                               // the groups on the way are copies
    expect(next[1].groupedShapes![0]).toBe(doc[1].groupedShapes![0]);   // siblings are shared
    expect(next[1].groupedShapes![1].groupedShapes![0]).toBe(doc[1].groupedShapes![1].groupedShapes![0]);
  });
  it("keeps the order of everything and the baked mesh of the groups", () => {
    const meshed = [shape("g", { importedMesh: { id: "baked" }, groupedShapes: [shape("a"), shape("b")] })];
    const next = replaceNestedShape(meshed, { rootId: "g", indices: [1] }, (part) => ({ ...part, shapeLocked: true }))!;
    expect(next.map((s) => s.id)).toEqual(["g"]);
    expect(next[0].groupedShapes!.map((s) => s.id)).toEqual(["a", "b"]);
    expect((next[0] as unknown as { importedMesh: unknown }).importedMesh).toBe((meshed[0] as unknown as { importedMesh: unknown }).importedMesh);
    expect(next[0].groupedShapes![1].shapeLocked).toBe(true);
    expect(next[0].groupedShapes![0].shapeLocked).toBeUndefined();
  });
  it("returns null for a path that does not exist", () => {
    expect(replaceNestedShape(doc, { rootId: "g0", indices: [9] }, (s) => s)).toBeNull();
    expect(replaceNestedShape(doc, { rootId: "g0", indices: [0, 0] }, (s) => s)).toBeNull();   // "a" is not a group
    expect(replaceNestedShape(doc, { rootId: "nope", indices: [0] }, (s) => s)).toBeNull();
    expect(replaceNestedShape(doc, { rootId: "g0", indices: [] }, (s) => s)).toBeNull();
  });
  it("the card says whether the object is a group", () => {
    const t = resolveNestedFocus(doc, { rootId: "g0", indices: [1] }, nameOf, restore)!;
    expect(nestedFocusCard(t, "Inner").isGroup).toBe(true);
    expect(nestedFocusCard(resolveNestedFocus(doc, { rootId: "g0", indices: [0] }, nameOf, restore)!, "a").isGroup).toBe(false);
  });
  it("the row actions are ops with sound targets and values", () => {
    expect(parseObjectsInvoke("rename", { id: "a", name: "New" })).toEqual({ op: "rename", target: { id: "a" }, name: "New" });
    expect(parseObjectsInvoke("rename", { rootId: "g", indices: [1, 0], name: "" })).toEqual({ op: "rename", target: { rootId: "g", indices: [1, 0] }, name: "" });
    expect(parseObjectsInvoke("rename", { name: "x" })).toBeNull();
    expect(parseObjectsInvoke("rename", { id: "a", name: 5 })).toBeNull();
    expect(parseObjectsInvoke("rename", { id: "a", name: "x".repeat(1001) })).toBeNull();
    expect(parseObjectsInvoke("setHidden", { id: "a", value: true })).toEqual({ op: "setHidden", id: "a", value: true });
    expect(parseObjectsInvoke("setHidden", { rootId: "g", indices: [0], value: true })).toBeNull();   // hiding inside a closed group is not offered
    expect(parseObjectsInvoke("setLocked", { id: "a", value: false })).toEqual({ op: "setLocked", id: "a", value: false });
    expect(parseObjectsInvoke("setLocked", { rootId: "g", indices: [0], value: true })).toBeNull();   // no ordinary lock on nested objects
    expect(parseObjectsInvoke("setShapeLocked", { id: "a", value: true })).toEqual({ op: "setShapeLocked", target: { id: "a" }, value: true });
    expect(parseObjectsInvoke("setShapeLocked", { rootId: "g", indices: [0, 1], value: true })).toEqual({ op: "setShapeLocked", target: { rootId: "g", indices: [0, 1] }, value: true });
    expect(parseObjectsInvoke("setShapeLocked", { id: "a" })).toBeNull();
  });
});
