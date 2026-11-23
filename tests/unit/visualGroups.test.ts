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
  mergePickCandidates,
  focusGroupVisibility,
  moveItemsToGroup,
  placeDerivedObjects,
  placeReplacementObjects,
  copyPairs,
  placementOf,
  revertMembership,
  normalizeVisualGroups,
  removeObjectsFromGroups,
  renameVisualGroup,
  resolveVisualGroups,
  serializableVisualGroups,
  setGroupLocked,
  setObjectsLocked,
  toggleGroupVisibility,
  toggleObjectLocked,
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

describe("the merge question's candidates", () => {
  it("lists the groups the objects are in, first given first, with their counts", () => {
    const r = sample();
    expect(mergePickCandidates(r, ["e", "a", "b", "c", "f"])).toEqual([
      { id: "lamp", name: "Lamp", count: 1 },
      { id: "ped", name: "Pedestal", count: 2 },
      { id: "cor", name: "Cornice", count: 1 },
    ]);
    expect(mergePickCandidates(r, ["f", "zz"])).toEqual([]);
  });
});

describe("membership changes that keep the object's id (undo and redo of a geometric step)", () => {
  const move = (r: VisualGroupsRegistry, id: string, groupId: string | null, index?: number) =>
    groupId ? moveObjectsToGroup(r, [id], groupId, index) : removeObjectsFromGroups(r, [id]);

  it("reports where an object is filed", () => {
    const r = sample();
    expect(placementOf(r, "b")).toEqual({ groupId: "ped", index: 1 });
    expect(placementOf(r, "c")).toEqual({ groupId: "cor", index: 0 });
    expect(placementOf(r, "f")).toBeNull();
  });

  it("undo puts the object back, redo moves it again", () => {
    const start = sample();
    const before = placementOf(start, "a");
    const moved = move(start, "a", "lamp");
    const change = { id: "a", before, after: placementOf(moved, "a") };
    const undone = revertMembership(moved, change, "undo");
    expect(placementOf(undone, "a")).toEqual(before);
    const redone = revertMembership(undone, change, "redo");
    expect(placementOf(redone, "a")?.groupId).toBe("lamp");
  });

  it("an object that was in no group goes back to none", () => {
    const moved = move(sample(), "f", "lamp");
    const change = { id: "f", before: null, after: placementOf(moved, "f") };
    expect(placementOf(revertMembership(moved, change, "undo"), "f")).toBeNull();
    expect(placementOf(revertMembership(revertMembership(moved, change, "undo"), change, "redo"), "f")?.groupId).toBe("lamp");
  });

  it("leaves it alone when the person filed the object elsewhere since", () => {
    const moved = move(sample(), "f", "lamp");
    const change = { id: "f", before: null, after: placementOf(moved, "f") };
    const later = move(moved, "f", "cor");
    expect(revertMembership(later, change, "undo")).toBe(later);
  });

  it("a group that is gone is no place: the object is then in none", () => {
    const start = sample();
    const change = { id: "a", before: placementOf(start, "a"), after: { groupId: "lamp", index: 1 } };
    const moved = move(start, "a", "lamp");
    const withoutPed = deleteVisualGroup(moved, "ped");
    expect(placementOf(revertMembership(withoutPed, change, "undo"), "a")).toBeNull();
  });
});

describe("objects that replace a source (ungroup, split, separate, take out)", () => {
  const items = (r: VisualGroupsRegistry, id: string) => findVisualGroup(r, id)!.items.map((i) => ("object" in i ? i.object : i.id));

  it("each source's new objects take its place in its own group", () => {
    const r = placeDerivedObjects(sample(), [["a", ["a1", "a2"]], ["e", ["e1"]]]);
    expect(items(r, "ped")).toEqual(["a", "a1", "a2", "b", "cor"]);
    expect(items(r, "lamp")).toEqual(["e", "e1"]);
  });

  it("a source in no group gives nothing, and unknown sources change nothing", () => {
    const r = sample();
    expect(placeDerivedObjects(r, [["f", ["f1"]], ["nope", ["x"]]])).toBe(r);
    expect(placeDerivedObjects(r, [])).toBe(r);
  });

  it("works for a source that is already gone (a group that is not coming back): its stale entry is the anchor", () => {
    const r = placeDerivedObjects(sample(), [["b", ["b-part"]]]);
    const live = resolveVisualGroups(r, new Set(["a", "b-part", "c", "d", "e", "f"]));
    expect(descendantObjectIds(live, "ped")).toEqual(["a", "b-part", "c", "d"]);
  });

  it("undo finds the source in its group and not its parts; redo the parts and not the source", () => {
    const r = placeDerivedObjects(sample(), [["a", ["a1", "a2"]]]);
    expect(descendantObjectIds(resolveVisualGroups(r, new Set(["a", "b", "c", "d", "e", "f"])), "ped")).toEqual(["a", "b", "c", "d"]);
    expect(descendantObjectIds(resolveVisualGroups(r, new Set(["a1", "a2", "b", "c", "d", "e", "f"])), "ped")).toEqual(["a1", "a2", "b", "c", "d"]);
  });
});

describe("objects a tool makes from other objects, and copies", () => {
  const items = (r: VisualGroupsRegistry, id: string) => findVisualGroup(r, id)!.items.map((i) => ("object" in i ? i.object : i.id));

  it("a tool's new objects take the merge rules' group, right after the first source in it", () => {
    const r = placeReplacementObjects(sample(), ["f", "b"], ["lid", "body"]); // f unassigned, b in Pedestal
    expect(items(r, "ped")).toEqual(["a", "b", "lid", "body", "cor"]);
  });

  it("sources in different groups, or none in a group, leave the new objects unassigned (nobody is asked here)", () => {
    const r = sample();
    expect(placeReplacementObjects(r, ["a", "e"], ["x"])).toBe(r);
    expect(placeReplacementObjects(r, ["f", "g"], ["x"])).toBe(r);
    expect(placeReplacementObjects(r, ["a"], [])).toBe(r);
  });

  it("an id that is also a source stays where it is", () => {
    const r = placeReplacementObjects(sample(), ["a", "b"], ["a", "ab"]);
    expect(items(r, "ped")).toEqual(["a", "ab", "b", "cor"]);
  });

  it("a cut-out: the new group takes the host's group and the part is untouched", () => {
    const r = placeReplacementObjects(sample(), ["b"], ["cut"]); // host b in Pedestal; the part (e, in Lamp) is not a source
    expect(items(r, "ped")).toEqual(["a", "b", "cut", "cor"]);
    expect(items(r, "lamp")).toEqual(["e"]);
  });

  it("copies of one source stay together in order, each source's copies after it", () => {
    expect(copyPairs([["a", "a1"], ["b", "b1"], ["a", "a2"], ["b", "b2"]])).toEqual([["a", ["a1", "a2"]], ["b", ["b1", "b2"]]]);
    const r = placeDerivedObjects(sample(), copyPairs([["a", "a1"], ["b", "b1"], ["a", "a2"], ["e", "e1"]]));
    expect(items(r, "ped")).toEqual(["a", "a1", "a2", "b", "b1", "cor"]);
    expect(items(r, "lamp")).toEqual(["e", "e1"]);
  });

  it("copies of an unassigned object are unassigned", () => {
    const r = sample();
    expect(placeDerivedObjects(r, copyPairs([["f", "f1"]]))).toBe(r);
  });

  it("undo of Duplicate: the copies are stale, the original in place", () => {
    const r = placeDerivedObjects(sample(), copyPairs([["a", "a1"]]));
    expect(descendantObjectIds(resolveVisualGroups(r, new Set(["a", "b", "c", "d", "e", "f"])), "ped")).toEqual(["a", "b", "c", "d"]);
  });
});

describe("the palette's drop (reorder, nest, move between groups)", () => {
  const live = new Set(["a", "b", "c", "d", "e", "f"]);
  const rowIds = (r: VisualGroupsRegistry, id: string) => findVisualGroup(r, id)!.items.map((i) => ("object" in i ? i.object : i.id));
  const g = (id: string) => ({ kind: "group" as const, id });
  const o = (id: string) => ({ kind: "object" as const, id });

  it("reorders objects among their siblings (index counts the rows left after the dragged ones are taken out)", () => {
    // Pedestal shows: a, b, Cornice. Drag a to after Cornice: remaining rows are b, Cornice: index 2.
    const r = moveItemsToGroup(sample(), [o("a")], "ped", 2, live);
    expect(rowIds(r, "ped")).toEqual(["b", "cor", "a"]);
    const back = moveItemsToGroup(r, [o("a")], "ped", 0, live);
    expect(rowIds(back, "ped")).toEqual(["a", "b", "cor"]);
  });

  it("reorders top-level groups", () => {
    const r = moveItemsToGroup(sample(), [g("lamp")], null, 0, live);
    expect(names(r)).toEqual(["Lamp", "Pedestal"]);
    expect(names(moveItemsToGroup(r, [g("lamp")], null, 99, live))).toEqual(["Pedestal", "Lamp"]);
  });

  it("nests a group, with everything in it, into another", () => {
    const r = moveItemsToGroup(sample(), [g("lamp")], "cor", -1, live);
    expect(names(r)).toEqual(["Pedestal"]);
    expect(descendantObjectIds(r, "ped")).toEqual(["a", "b", "c", "d", "e"]);
    expect(membershipMap(r).get("e")).toBe("lamp");
    expect(findVisualGroup(r, "cor")!.items.some((i) => "id" in i && i.id === "lamp")).toBe(true);
  });

  it("takes a nested group to the top level", () => {
    const r = moveItemsToGroup(sample(), [g("cor")], null, 1, live);
    expect(names(r)).toEqual(["Pedestal", "Cornice", "Lamp"]);
    expect(descendantObjectIds(r, "ped")).toEqual(["a", "b"]);
  });

  it("moves objects between groups at a place, in the order given, and an object stays in one group", () => {
    const r = moveItemsToGroup(sample(), [o("a"), o("c")], "lamp", 0, live);
    expect(rowIds(r, "lamp")).toEqual(["a", "c", "e"]);
    expect(membershipMap(r).get("a")).toBe("lamp");
    expect(rowIds(r, "ped")).toEqual(["b", "cor"]);
    expect(rowIds(r, "cor")).toEqual(["d"]);
  });

  it("moves groups and objects together", () => {
    const r = moveItemsToGroup(sample(), [g("cor"), o("e")], "lamp", -1, live);
    expect(rowIds(r, "lamp")).toEqual(["cor", "e"]);
    expect(descendantObjectIds(r, "lamp")).toEqual(["c", "d", "e"]);
  });

  it("places by the rows that exist, not by raw position: stale entries do not shift the drop", () => {
    // Pedestal holds a, GONE, b, Cornice; the palette shows a, b, Cornice. Dropping f at index 2 means between b and Cornice.
    const withStale = moveObjectsToGroup(sample(), ["gone"], "ped", 1);
    expect(rowIds(withStale, "ped")).toEqual(["a", "gone", "b", "cor"]);
    const r = moveItemsToGroup(withStale, [o("f")], "ped", 2, live);
    expect(rowIds(r, "ped")).toEqual(["a", "gone", "b", "f", "cor"]);
    expect(descendantObjectIds(resolveVisualGroups(r, live), "ped")).toEqual(["a", "b", "f", "c", "d"]);
  });

  it("a group cannot go into itself or into a group inside it", () => {
    const r = sample();
    expect(moveItemsToGroup(r, [g("ped")], "ped", -1, live)).toBe(r);
    expect(moveItemsToGroup(r, [g("ped")], "cor", -1, live)).toBe(r);
  });

  it("a group dragged together with one of its own groups carries it along", () => {
    const r = moveItemsToGroup(sample(), [g("ped"), g("cor")], "lamp", -1, live);
    expect(names(r)).toEqual(["Lamp"]);
    expect(findVisualGroup(r, "cor")).not.toBeNull();
    expect(membershipMap(r).get("c")).toBe("cor");
  });

  it("only groups go to the top level, and unknown parents or rows change nothing", () => {
    const r = sample();
    expect(moveItemsToGroup(r, [o("a")], null, 0, live)).toBe(r);
    expect(moveItemsToGroup(r, [g("lamp"), o("a")], null, 0, live)).toBe(r);
    expect(moveItemsToGroup(r, [o("a")], "nope", 0, live)).toBe(r);
    expect(moveItemsToGroup(r, [g("nope")], null, 0, live)).toBe(r);
    expect(moveItemsToGroup(r, [o("not-live")], "ped", 0, live)).toBe(r);
    expect(moveItemsToGroup(r, [], "ped", 0, live)).toBe(r);
  });

  it("dropping where things already are changes nothing", () => {
    const r = sample();
    expect(moveItemsToGroup(r, [o("a")], "ped", 0, live)).toBe(r);
    expect(moveItemsToGroup(r, [g("lamp")], null, 1, live)).toBe(r);
  });

  it("never touches visibility (no shapes are involved) and keeps the objects' own order inside a moved group", () => {
    const r = moveItemsToGroup(sample(), [g("cor")], "lamp", -1, live);
    expect(descendantObjectIds(r, "cor")).toEqual(["c", "d"]);
  });
});

describe("Option-click on a group's eye: focus the group", () => {
  it("hides every object that is not in the group, unassigned ones too, and shows the group's objects at any depth", () => {
    const input = shapes({ a: true, c: true, e: true }); // a, c (in Pedestal) and e (in Lamp) hidden; f unassigned visible
    const focus = focusGroupVisibility(sample(), "ped", input)!;
    const hidden = new Set(focus.shapes.filter((s) => s.hidden).map((s) => s.id));
    expect([...hidden].sort()).toEqual(["e", "f"]);
    expect(focus.shownIds.sort()).toEqual(["a", "c"]);
    expect(focus.hiddenIds.sort()).toEqual(["f"]);
  });

  it("a nested group focuses on its own objects only", () => {
    const focus = focusGroupVisibility(sample(), "cor", shapes())!;
    expect(focus.shapes.filter((s) => !s.hidden).map((s) => s.id)).toEqual(["c", "d"]);
  });

  it("is one-way: doing it twice changes nothing the second time, and it keeps shapes that did not change", () => {
    const input = shapes();
    const first = focusGroupVisibility(sample(), "lamp", input)!;
    expect(focusGroupVisibility(sample(), "lamp", first.shapes)).toBeNull();
    const byId = new Map(first.shapes.map((s) => [s.id, s]));
    expect(byId.get("e")).toBe(input.find((s) => s.id === "e")); // already visible: the same object
  });

  it("writes only the hidden flag", () => {
    const focus = focusGroupVisibility(sample(), "lamp", shapes())!;
    for (const shape of focus.shapes) expect({ ...shape, hidden: undefined }).toEqual({ ...shapes().find((s) => s.id === shape.id)!, hidden: undefined });
  });

  it("an empty or unknown group changes nothing", () => {
    const r = createVisualGroup(sample(), { id: "empty", name: "Empty" }).registry;
    expect(focusGroupVisibility(r, "empty", shapes())).toBeNull();
    expect(focusGroupVisibility(r, "nope", shapes())).toBeNull();
  });

  it("stale entries are ignored (objects that do not exist cannot be shown)", () => {
    const r = moveObjectsToGroup(sample(), ["gone"], "lamp");
    const focus = focusGroupVisibility(r, "lamp", shapes({ e: true }))!;
    expect(focus.shapes.filter((s) => !s.hidden).map((s) => s.id)).toEqual(["e"]);
  });
});

describe("bulk lock (Build 0056): Lock Object for the objects of a group, one-shot", () => {
  const locked = (ids: string[]) => shapes().map((s) => (ids.includes(s.id) ? { ...s, locked: true } : s));

  it("Lock All writes shape.locked for every object in the group at any depth, and nothing else", () => {
    const input = shapes();
    const change = setGroupLocked(sample(), "ped", input, true)!;
    expect(change.changedIds).toEqual(["a", "b", "c", "d"]);
    expect(change.shapes.filter((s) => s.locked).map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
    const byId = new Map(change.shapes.map((s) => [s.id, s]));
    for (const id of ["e", "f"]) expect(byId.get(id)).toBe(input.find((s) => s.id === id)); // other shapes are the same objects
    expect(change.shapes.every((s) => s.shapeLocked === undefined)).toBe(true); // Lock Properties is not touched
  });

  it("a nested group locks only its own objects", () => {
    expect(setGroupLocked(sample(), "cor", shapes(), true)!.changedIds).toEqual(["c", "d"]);
  });

  it("Unlock All clears the flag for the same objects", () => {
    const change = setGroupLocked(sample(), "ped", locked(["a", "b", "c", "d", "e"]), false)!;
    expect(change.changedIds).toEqual(["a", "b", "c", "d"]);
    expect(change.shapes.filter((s) => s.locked).map((s) => s.id)).toEqual(["e"]);
  });

  it("both are available whatever the members' current locks are (mixed, all locked, none)", () => {
    expect(setGroupLocked(sample(), "ped", locked(["a"]), true)!.changedIds).toEqual(["b", "c", "d"]);
    expect(setGroupLocked(sample(), "ped", locked(["a"]), false)!.changedIds).toEqual(["a"]);
    expect(setGroupLocked(sample(), "ped", locked(["a", "b", "c", "d"]), false)!.changedIds).toEqual(["a", "b", "c", "d"]);
  });

  it("is null when nothing would change, the group is empty, or it is unknown", () => {
    expect(setGroupLocked(sample(), "ped", locked(["a", "b", "c", "d"]), true)).toBeNull();
    expect(setGroupLocked(sample(), "ped", shapes(), false)).toBeNull();
    let r = createVisualGroup(sample(), { id: "empty", name: "Empty" }).registry;
    expect(setGroupLocked(r, "empty", shapes(), true)).toBeNull();
    expect(setGroupLocked(r, "nope", shapes(), true)).toBeNull();
    r = removeObjectsFromGroups(r, ["a"]);
    expect(setGroupLocked(r, "ped", shapes(), true)!.changedIds).toEqual(["b", "c", "d"]);
  });

  it("objects that do not exist are not counted, and hidden objects are locked like any other", () => {
    const some = shapes({ a: true }).filter((s) => s.id !== "b");
    expect(setGroupLocked(sample(), "ped", some, true)!.changedIds).toEqual(["a", "c", "d"]);
  });

  it("keeps no state: an object added later keeps the lock it has, and the registry is untouched", () => {
    const registry = sample();
    setGroupLocked(registry, "ped", shapes(), true);
    const after = moveObjectsToGroup(registry, ["f"], "ped");
    const change = setGroupLocked(after, "ped", locked(["a", "b", "c", "d"]), true)!;
    expect(change.changedIds).toEqual(["f"]); // f was not locked just because the group's objects were
    expect(Object.keys(findVisualGroup(registry, "ped")!)).toEqual(["id", "name", "items"]);
  });

  it("the object row's button flips that object's own lock", () => {
    expect(toggleObjectLocked(shapes(), "a")!.shapes.find((s) => s.id === "a")!.locked).toBe(true);
    expect(toggleObjectLocked(locked(["a"]), "a")!.shapes.find((s) => s.id === "a")!.locked).toBe(false);
    expect(toggleObjectLocked(shapes(), "nope")).toBeNull();
    expect(toggleObjectLocked(locked(["a"]), "a")!.changedIds).toEqual(["a"]);
  });

  it("setObjectsLocked ignores ids that are not shapes", () => {
    expect(setObjectsLocked(shapes(), new Set(["zzz"]), true)).toBeNull();
  });
});
