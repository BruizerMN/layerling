import { describe, expect, it } from "vitest";
import {
  EMPTY_VISUAL_GROUPS,
  applyMerge,
  createVisualGroup,
  defaultVisualGroupName,
  deleteVisualGroup,
  descendantObjectIds,
  findVisualGroup,
  groupVisibilityState,
  groupVisibilityStates,
  insertObjectsNear,
  liveObjectIds,
  membershipMap,
  mergeDestination,
  moveObjectsToGroup,
  moveVisualGroup,
  normalizeVisualGroups,
  removeObjectsFromGroups,
  renameVisualGroup,
  resolveVisualGroups,
  serializableVisualGroups,
  toggleGroupVisibility,
  visualGroupsFingerprint,
  type VisualGroupsRegistry,
} from "@/lib/visualGroups";
import { documentSignature, type SignatureParts } from "@/lib/host/documentRevision";
import type { WorkplaneShape } from "@/types/layerling";

/*
 * Visual Groups (registry, membership, nesting, bulk visibility): pure functions, no editor.
 */

const shape = (id: string, hidden?: boolean): WorkplaneShape => ({ id, name: id, kind: "box", color: "#123456", x: 0, z: 0, size: 10, width: 10, depth: 10, height: 10, rotation: 0, ...(hidden === undefined ? {} : { hidden }) });

/** Pedestal { a, b, Cornice { c, d } }, Lamp { e }, and the unassigned f. */
function sample() {
  let r: VisualGroupsRegistry = EMPTY_VISUAL_GROUPS;
  r = createVisualGroup(r, { id: "ped", name: "Pedestal" }).registry;
  r = moveObjectsToGroup(r, ["a", "b"], "ped");
  r = createVisualGroup(r, { id: "cor", name: "Cornice", parentId: "ped" }).registry;
  r = createVisualGroup(r, { id: "lamp", name: "Lamp" }).registry;
  r = moveObjectsToGroup(r, ["c", "d"], "cor");
  r = moveObjectsToGroup(r, ["e"], "lamp");
  return r;
}
const shapes = (hidden: Record<string, boolean> = {}) => ["a", "b", "c", "d", "e", "f"].map((id) => shape(id, hidden[id]));
const names = (r: VisualGroupsRegistry) => r.items.map((g) => g.name);

describe("building and reading the tree", () => {
  it("creates nested groups and keeps order", () => {
    const r = sample();
    expect(names(r)).toEqual(["Pedestal", "Lamp"]);
    expect(descendantObjectIds(r, "ped")).toEqual(["a", "b", "c", "d"]);
    expect(descendantObjectIds(r, "cor")).toEqual(["c", "d"]);
    expect(membershipMap(r).get("c")).toBe("cor");
    expect(membershipMap(r).has("f")).toBe(false);
  });

  it("is empty by default and does not invent a default group", () => {
    expect(EMPTY_VISUAL_GROUPS.items).toEqual([]);
    expect(serializableVisualGroups(EMPTY_VISUAL_GROUPS, new Set())).toBeUndefined();
    expect(visualGroupsFingerprint(EMPTY_VISUAL_GROUPS)).toBe("");
  });

  it("names new groups so that none repeats, and cleans names", () => {
    let r = createVisualGroup(EMPTY_VISUAL_GROUPS).registry;
    expect(r.items[0].name).toBe("Visual Group");
    expect(defaultVisualGroupName(r)).toBe("Visual Group 2");
    r = createVisualGroup(r).registry;
    expect(names(r)).toEqual(["Visual Group", "Visual Group 2"]);
    expect(createVisualGroup(r, { name: "   " }).registry.items[2].name).toBe("Visual Group");
    expect(createVisualGroup(r, { name: "x".repeat(500) }).registry.items[2].name).toHaveLength(200);
  });

  it("creates at an index and in an unknown parent falls back to the top level", () => {
    let r = sample();
    r = createVisualGroup(r, { id: "first", name: "First", index: 0 }).registry;
    expect(names(r)).toEqual(["First", "Pedestal", "Lamp"]);
    r = createVisualGroup(r, { id: "x", name: "X", parentId: "nope" }).registry;
    expect(names(r)).toEqual(["First", "Pedestal", "Lamp", "X"]);
  });

  it("renames and leaves the rest alone", () => {
    const r = sample();
    const renamed = renameVisualGroup(r, "cor", "Top trim");
    expect(findVisualGroup(renamed, "cor")?.name).toBe("Top trim");
    expect(renameVisualGroup(renamed, "cor", "Top trim")).toBe(renamed);
    expect(renameVisualGroup(r, "missing", "x")).toBe(r);
  });
});

describe("membership", () => {
  it("an object is in one group at most", () => {
    let r = sample();
    r = moveObjectsToGroup(r, ["a"], "lamp");
    expect(membershipMap(r).get("a")).toBe("lamp");
    expect(descendantObjectIds(r, "ped")).toEqual(["b", "c", "d"]);
    expect(descendantObjectIds(r, "lamp")).toEqual(["e", "a"]);
  });

  it("moves to an index, which counts the group's remaining items", () => {
    let r = sample();
    r = moveObjectsToGroup(r, ["b"], "ped", 0);
    expect(findVisualGroup(r, "ped")?.items.map((i) => ("object" in i ? i.object : i.id))).toEqual(["b", "a", "cor"]);
    r = moveObjectsToGroup(r, ["b"], "ped"); // to the end
    expect(findVisualGroup(r, "ped")?.items.map((i) => ("object" in i ? i.object : i.id))).toEqual(["a", "cor", "b"]);
  });

  it("removes objects from their groups without touching other things; unknown ids change nothing", () => {
    const r = sample();
    const removed = removeObjectsFromGroups(r, ["c", "e"]);
    expect(membershipMap(removed).has("c")).toBe(false);
    expect(descendantObjectIds(removed, "lamp")).toEqual([]);
    expect(findVisualGroup(removed, "lamp")).not.toBeNull();
    expect(removeObjectsFromGroups(r, ["zzz"])).toBe(r);
    expect(moveObjectsToGroup(r, ["a"], "missing")).toBe(r);
  });

  it("empty groups are allowed", () => {
    const r = createVisualGroup(EMPTY_VISUAL_GROUPS, { id: "e", name: "Empty" }).registry;
    expect(groupVisibilityState(r, "e", [])).toBe("empty");
    expect(toggleGroupVisibility(r, "e", [])).toBeNull();
    expect(serializableVisualGroups(r, new Set())).toBeDefined();
  });
});

describe("deleting a group", () => {
  it("promotes child groups into its place, in order, and un-assigns the objects it held directly", () => {
    let r = sample();
    r = createVisualGroup(r, { id: "base", name: "Base", parentId: "ped", index: 0 }).registry; // ped: base, a, b, cor
    const out = deleteVisualGroup(r, "ped");
    expect(names(out)).toEqual(["Base", "Cornice", "Lamp"]);
    expect(membershipMap(out).has("a")).toBe(false);
    expect(membershipMap(out).get("c")).toBe("cor"); // objects in the promoted child group stay
  });

  it("promotes into a parent group when nested", () => {
    let r = sample();
    r = createVisualGroup(r, { id: "deep", name: "Deep", parentId: "cor" }).registry;
    r = moveObjectsToGroup(r, ["f"], "deep");
    const out = deleteVisualGroup(r, "cor");
    const ped = findVisualGroup(out, "ped")!;
    expect(ped.items.map((i) => ("object" in i ? i.object : i.id))).toEqual(["a", "b", "deep"]);
    expect(membershipMap(out).has("c")).toBe(false);
    expect(membershipMap(out).get("f")).toBe("deep");
  });

  it("never changes an object's own visibility (no shapes are involved)", () => {
    const hidden = shapes({ a: true, c: true });
    const before = groupVisibilityStates(sample(), hidden);
    expect(before.get("ped")).toBe("mixed");
    const after = deleteVisualGroup(sample(), "ped");
    expect(hidden.filter((s) => s.hidden).map((s) => s.id)).toEqual(["a", "c"]);
    expect(groupVisibilityStates(after, hidden).get("cor")).toBe("mixed");
  });

  it("deleting an unknown group changes nothing", () => {
    const r = sample();
    expect(deleteVisualGroup(r, "nope")).toBe(r);
  });
});

describe("nesting and re-ordering groups", () => {
  it("re-orders among siblings", () => {
    const r = moveVisualGroup(sample(), "lamp", null, 0);
    expect(names(r)).toEqual(["Lamp", "Pedestal"]);
  });

  it("re-parents a group, with its content", () => {
    const r = moveVisualGroup(sample(), "lamp", "cor");
    expect(names(r)).toEqual(["Pedestal"]);
    expect(descendantObjectIds(r, "ped")).toEqual(["a", "b", "c", "d", "e"]);
    expect(membershipMap(r).get("e")).toBe("lamp");
  });

  it("refuses to put a group into itself or into one of its own groups", () => {
    const r = sample();
    expect(moveVisualGroup(r, "ped", "ped")).toBe(r);
    expect(moveVisualGroup(r, "ped", "cor")).toBe(r);
    expect(moveVisualGroup(r, "ped", "missing")).toBe(r);
    expect(moveVisualGroup(r, "missing", null)).toBe(r);
  });

  it("takes a nested group to the top level", () => {
    const r = moveVisualGroup(sample(), "cor", null);
    expect(names(r)).toEqual(["Pedestal", "Lamp", "Cornice"]);
    expect(descendantObjectIds(r, "ped")).toEqual(["a", "b"]);
  });
});

describe("hierarchical bulk visibility", () => {
  it("shows aggregate states: all visible, all hidden, mixed, empty", () => {
    const r = sample();
    expect(groupVisibilityState(r, "ped", shapes())).toBe("visible");
    expect(groupVisibilityState(r, "ped", shapes({ a: true, b: true, c: true, d: true }))).toBe("hidden");
    expect(groupVisibilityState(r, "ped", shapes({ c: true }))).toBe("mixed");
    expect(groupVisibilityState(r, "cor", shapes({ c: true }))).toBe("mixed");
    expect(groupVisibilityState(r, "lamp", shapes({ e: true }))).toBe("hidden");
  });

  it("all visible: the eye hides every descendant, recursively, in one result", () => {
    const toggle = toggleGroupVisibility(sample(), "ped", shapes())!;
    expect(toggle.hide).toBe(true);
    expect(toggle.changedIds).toEqual(["a", "b", "c", "d"]);
    expect(toggle.shapes.filter((s) => s.hidden).map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("otherwise the eye shows them all (mixed or all hidden)", () => {
    const mixed = toggleGroupVisibility(sample(), "ped", shapes({ b: true, d: true }))!;
    expect(mixed.hide).toBe(false);
    expect(mixed.changedIds).toEqual(["b", "d"]);
    expect(mixed.shapes.every((s) => !s.hidden)).toBe(true);
    const hidden = toggleGroupVisibility(sample(), "cor", shapes({ c: true, d: true }))!;
    expect(hidden.hide).toBe(false);
    expect(hidden.changedIds).toEqual(["c", "d"]);
  });

  it("writes only the hidden flag, only where it changes, and leaves other shapes the same objects", () => {
    const input = shapes({ a: true });
    const toggle = toggleGroupVisibility(sample(), "ped", input)!; // mixed -> show all
    expect(toggle.changedIds).toEqual(["a"]);
    const byId = new Map(toggle.shapes.map((s) => [s.id, s]));
    for (const id of ["b", "c", "d", "e", "f"]) expect(byId.get(id)).toBe(input.find((s) => s.id === id));
    expect({ ...byId.get("a")!, hidden: true }).toEqual(input[0]);
  });

  it("a nested group's own result is independent of its parent: members may end up mixed", () => {
    const r = sample();
    const hideAll = toggleGroupVisibility(r, "ped", shapes())!;
    const showCornice = toggleGroupVisibility(r, "cor", hideAll.shapes)!; // cornice all hidden -> show
    expect(showCornice.hide).toBe(false);
    expect(groupVisibilityState(r, "ped", showCornice.shapes)).toBe("mixed");
    expect(groupVisibilityState(r, "cor", showCornice.shapes)).toBe("visible");
  });

  it("ignores objects that do not exist (stale ids)", () => {
    const r = moveObjectsToGroup(sample(), ["gone"], "ped");
    expect(groupVisibilityState(r, "ped", shapes())).toBe("visible");
    expect(toggleGroupVisibility(r, "ped", shapes())!.changedIds).toEqual(["a", "b", "c", "d"]);
  });

  it("works on locked objects (the lock rules allow hidden) and does not touch anything else", () => {
    const locked = shapes().map((s) => (s.id === "a" ? { ...s, locked: true } : s));
    const toggle = toggleGroupVisibility(sample(), "ped", locked)!;
    expect(toggle.shapes.find((s) => s.id === "a")).toEqual({ ...locked[0], hidden: true });
  });
});

describe("merge destination and propagation", () => {
  it("applies the four rules", () => {
    const r = sample();
    expect(mergeDestination(r, ["a", "b"])).toEqual({ kind: "group", groupId: "ped" }); // same group
    expect(mergeDestination(r, ["a", "f"])).toEqual({ kind: "group", groupId: "ped" }); // assigned + unassigned
    expect(mergeDestination(r, ["f", "a"])).toEqual({ kind: "group", groupId: "ped" });
    expect(mergeDestination(r, ["f", "zz"])).toEqual({ kind: "none" }); // two unassigned
    expect(mergeDestination(r, ["e", "a"])).toEqual({ kind: "conflict", candidates: ["lamp", "ped"] }); // first-given group first
    expect(mergeDestination(r, ["a", "c"])).toEqual({ kind: "conflict", candidates: ["ped", "cor"] }); // a group and a group inside it are different groups
  });

  it("the merged object takes the place of the first source in that group and the sources stay as stale ids", () => {
    const r = applyMerge(sample(), ["b", "a"], "ab", "ped");
    expect(findVisualGroup(r, "ped")!.items.map((i) => ("object" in i ? i.object : i.id))).toEqual(["ab", "a", "b", "cor"]);
    // After the merge the sources are gone from the scene: the palette sees only the result.
    const afterMerge = resolveVisualGroups(r, new Set(["ab", "c", "d", "e", "f"]));
    expect(descendantObjectIds(afterMerge, "ped")).toEqual(["ab", "c", "d"]);
    // Undo brings the sources back: they are in their group again, the result is not shown.
    const afterUndo = resolveVisualGroups(r, new Set(["a", "b", "c", "d", "e", "f"]));
    expect(descendantObjectIds(afterUndo, "ped")).toEqual(["a", "b", "c", "d"]);
  });

  it("a conflict resolved to another group puts the result at the end of that group", () => {
    const r = applyMerge(sample(), ["a", "e"], "ae", "lamp");
    expect(findVisualGroup(r, "lamp")!.items.map((i) => ("object" in i ? i.object : i.id))).toEqual(["ae", "e"]);
    const toPed = applyMerge(sample(), ["e", "f"], "ef", "ped");
    expect(findVisualGroup(toPed, "ped")!.items.map((i) => ("object" in i ? i.object : i.id))).toEqual(["a", "b", "cor", "ef"]);
  });

  it("no group means no change", () => {
    const r = sample();
    expect(applyMerge(r, ["f", "g"], "fg", null)).toBe(r);
    expect(applyMerge(r, ["a"], "x", "missing")).toBe(r);
  });

  it("ungroup, split and duplicate: new objects go right after the anchor, which stays", () => {
    const r = insertObjectsNear(sample(), "a", ["a1", "a2"]);
    expect(findVisualGroup(r, "ped")!.items.map((i) => ("object" in i ? i.object : i.id))).toEqual(["a", "a1", "a2", "b", "cor"]);
    const undone = resolveVisualGroups(r, new Set(["a", "b", "c", "d", "e", "f"]));
    expect(descendantObjectIds(undone, "ped")).toEqual(["a", "b", "c", "d"]);
    expect(insertObjectsNear(sample(), "f", ["f1"])).toEqual(sample()); // unassigned anchor: the new ones are unassigned
    const before = insertObjectsNear(sample(), "b", ["b0"], "before");
    expect(findVisualGroup(before, "ped")!.items.map((i) => ("object" in i ? i.object : i.id))).toEqual(["a", "b0", "b", "cor"]);
  });
});

describe("validity after geometric undo/redo", () => {
  it("stale ids are never shown, and come back with their object", () => {
    const r = sample();
    const withoutC = resolveVisualGroups(r, new Set(["a", "b", "d", "e", "f"])); // c deleted
    expect(descendantObjectIds(withoutC, "ped")).toEqual(["a", "b", "d"]);
    expect(membershipMap(withoutC).has("c")).toBe(false);
    const undone = resolveVisualGroups(r, liveObjectIds(shapes())); // c is back
    expect(descendantObjectIds(undone, "ped")).toEqual(["a", "b", "c", "d"]);
  });

  it("resolve keeps the same object when nothing is stale", () => {
    const r = sample();
    expect(resolveVisualGroups(r, liveObjectIds(shapes()))).toBe(r);
  });
});

describe("healing and serialization", () => {
  it("normalizes anything without throwing", () => {
    for (const raw of [undefined, null, 7, "x", [], {}, { items: 5 }, { items: [null, 3, "x", {}] }]) {
      expect(normalizeVisualGroups(raw)).toEqual({ items: [] });
    }
  });

  it("drops duplicate group ids and duplicate objects, cleans names, ignores unknown parts", () => {
    const r = normalizeVisualGroups({
      items: [
        { id: "g1", name: "  A  ", items: [{ object: "x" }, { object: "x" }, { object: "" }, { nonsense: 1 }, { id: "g2", name: 5, items: [{ object: "x" }, { object: "y" }] }] },
        { id: "g1", name: "dup", items: [{ object: "z" }] },
        { id: "g3", items: [] },
        { object: "orphan-at-root" },
      ],
    });
    expect(names(r)).toEqual(["A", "Visual Group"]);
    expect(descendantObjectIds(r, "g1")).toEqual(["x", "y"]);
    expect(findVisualGroup(r, "g2")!.name).toBe("Visual Group");
    expect(membershipMap(r).get("x")).toBe("g1");
    expect(findVisualGroup(r, "g3")).not.toBeNull();
  });

  it("bounds the depth", () => {
    let raw: unknown = { id: "leaf", name: "leaf", items: [] };
    for (let i = 0; i < 100; i++) raw = { id: `g${i}`, name: `g${i}`, items: [raw] };
    const r = normalizeVisualGroups({ items: [raw] });
    let depth = 0;
    let cursor: VisualGroupsRegistry["items"] = r.items;
    while (cursor.length) {
      depth += 1;
      const next = cursor[0].items.find((i) => "items" in i);
      cursor = next && "items" in next ? [next] : [];
    }
    expect(depth).toBeLessThanOrEqual(33);
  });

  it("with live ids, drops objects that do not exist; serializable prunes the same way and keeps empty groups", () => {
    const r = sample();
    const out = serializableVisualGroups(r, new Set(["a", "c"]))!;
    expect(descendantObjectIds(out, "ped")).toEqual(["a", "c"]);
    expect(findVisualGroup(out, "lamp")).not.toBeNull();
    expect(descendantObjectIds(normalizeVisualGroups(r, new Set(["e"])), "lamp")).toEqual(["e"]);
  });

  it("survives a JSON round trip unchanged", () => {
    const r = sample();
    expect(normalizeVisualGroups(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it("its fingerprint changes with every saved difference", () => {
    const r = sample();
    const prints = new Set([
      visualGroupsFingerprint(r),
      visualGroupsFingerprint(renameVisualGroup(r, "ped", "P")),
      visualGroupsFingerprint(moveVisualGroup(r, "lamp", null, 0)),
      visualGroupsFingerprint(moveObjectsToGroup(r, ["a"], "lamp")),
      visualGroupsFingerprint(deleteVisualGroup(r, "lamp")),
      visualGroupsFingerprint(removeObjectsFromGroups(r, ["a"])),
    ]);
    expect(prints.size).toBe(6);
  });
});

describe("the document's modified signature", () => {
  const parts = (visualGroups?: string): SignatureParts => ({
    entryFingerprint: "scene", attachments: "", workspace: { width: 200 }, snapGrid: 1, placementElevation: 0, placementWorkplane: "base", savedViews: "", cornerRulers: "", tape: "",
    ...(visualGroups === undefined ? {} : { visualGroups }),
  });

  it("changes when the groups change, and is the same without groups as for a caller that knows nothing of them", () => {
    const r = sample();
    const base = documentSignature(parts());
    expect(documentSignature(parts(""))).toBe(base);
    const signatures = new Set([base, documentSignature(parts(visualGroupsFingerprint(r))), documentSignature(parts(visualGroupsFingerprint(renameVisualGroup(r, "ped", "P"))))]);
    expect(signatures.size).toBe(3);
  });

  it("undoing a delete (the object is back) changes what a save would write, so the signature follows the live objects", () => {
    const r = sample();
    const print = (live: string[]) => visualGroupsFingerprint(resolveVisualGroups(r, new Set(live)));
    expect(print(["a", "b", "c", "d", "e"])).not.toBe(print(["a", "b", "d", "e"]));
  });
});
