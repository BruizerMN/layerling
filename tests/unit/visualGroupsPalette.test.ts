import { describe, expect, it } from "vitest";
import { parseHostEvent, VISUAL_GROUPS_CAPABILITY, VISUAL_GROUPS_OPS } from "@/lib/host/hostProtocol";
import { parseVisualGroupsInvoke } from "@/lib/host/nativeVisualGroups";
import { EMPTY_VISUAL_GROUPS, createVisualGroup, moveObjectsToGroup, type VisualGroupsRegistry } from "@/lib/visualGroups";
import { MENU_MAX_GROUP_DEPTH, existingGroupId, visualGroupsMenuFits, visualGroupsOutline, visualGroupsPaletteState, type ChooserGroup } from "@/lib/visualGroupsSnapshot";
import type { WorkplaneShape } from "@/types/layerling";

/*
 * The Visual Groups palette's two ends on the page: what is published (a pure snapshot of registry + shapes + selection) and what is accepted
 * (host commands, checked). The host protocol messages are checked the way the ribbon's are.
 */

const shape = (id: string, hidden?: boolean, name = id): WorkplaneShape => ({ id, name, kind: "box", color: "#123456", x: 0, z: 0, size: 10, width: 10, depth: 10, height: 10, rotation: 0, ...(hidden ? { hidden } : {}) });
const nameOf = (s: WorkplaneShape) => `<${s.name}>`;

function sample(): VisualGroupsRegistry {
  let r = createVisualGroup(EMPTY_VISUAL_GROUPS, { id: "ped", name: "Pedestal" }).registry;
  r = moveObjectsToGroup(r, ["a", "b"], "ped");
  r = createVisualGroup(r, { id: "cor", name: "Cornice", parentId: "ped" }).registry;
  r = moveObjectsToGroup(r, ["c", "gone"], "cor");
  return r;
}
const SHAPES = [shape("a"), shape("b", true), shape("c"), shape("loose")];

describe("the palette's snapshot", () => {
  it("is empty without groups, whatever is selected", () => {
    expect(visualGroupsPaletteState(EMPTY_VISUAL_GROUPS, SHAPES, ["a"], nameOf, false)).toEqual({ readOnly: false, groups: [], selected: [] });
  });

  it("lists groups, nested groups and members with names and own hidden flags, and leaves out what does not exist", () => {
    const state = visualGroupsPaletteState(sample(), SHAPES, ["c", "loose", "a"], nameOf, false);
    expect(state.groups).toEqual([
      {
        type: "group", id: "ped", name: "Pedestal", visibility: "mixed",
        items: [
          { type: "object", id: "a", name: "<a>", kind: "box", hidden: false },
          { type: "object", id: "b", name: "<b>", kind: "box", hidden: true },
          { type: "group", id: "cor", name: "Cornice", visibility: "visible", items: [{ type: "object", id: "c", name: "<c>", kind: "box", hidden: false }] },
        ],
      },
    ]);
    expect(state.selected).toEqual(["c", "a"]); // members only, in selection order
  });

  it("carries the read-only flag (a history state is shown)", () => {
    expect(visualGroupsPaletteState(sample(), SHAPES, [], nameOf, true).readOnly).toBe(true);
  });

  it("changes when a name or a flag changes, and not otherwise (the page sends on change only)", () => {
    const a = JSON.stringify(visualGroupsPaletteState(sample(), SHAPES, [], nameOf, false));
    expect(JSON.stringify(visualGroupsPaletteState(sample(), [...SHAPES], [], nameOf, false))).toBe(a);
    expect(JSON.stringify(visualGroupsPaletteState(sample(), SHAPES.map((s) => (s.id === "a" ? shape("a", true) : s)), [], nameOf, false))).not.toBe(a);
    expect(JSON.stringify(visualGroupsPaletteState(sample(), SHAPES, [], (s) => s.name.toUpperCase(), false))).not.toBe(a);
  });

  it("the chooser outline holds groups only, nested", () => {
    expect(visualGroupsOutline(sample())).toEqual([{ id: "ped", name: "Pedestal", groups: [{ id: "cor", name: "Cornice", groups: [] }] }]);
  });

  it("a group named late that is gone is not a place", () => {
    expect(existingGroupId(sample(), "cor")).toBe("cor");
    expect(existingGroupId(sample(), "deleted")).toBeNull();
    expect(existingGroupId(sample(), 5)).toBeNull();
  });
});

describe("commands from the palette", () => {
  it("accepts the known commands with the right fields", () => {
    expect(parseVisualGroupsInvoke("create", {})).toEqual({ op: "create" });
    expect(parseVisualGroupsInvoke("create", { name: "X", parentId: "p" })).toEqual({ op: "create", name: "X", parentId: "p" });
    expect(parseVisualGroupsInvoke("rename", { groupId: "g", name: "" })).toEqual({ op: "rename", groupId: "g", name: "" });
    expect(parseVisualGroupsInvoke("delete", { groupId: "g" })).toEqual({ op: "delete", groupId: "g" });
    expect(parseVisualGroupsInvoke("toggleGroup", { groupId: "g" })).toEqual({ op: "toggleGroup", groupId: "g" });
    expect(parseVisualGroupsInvoke("toggleObject", { id: "o" })).toEqual({ op: "toggleObject", id: "o" });
    expect(parseVisualGroupsInvoke("removeObject", { id: "o" })).toEqual({ op: "removeObject", id: "o" });
    expect(parseVisualGroupsInvoke("select", { ids: ["a", "b"], mode: "toggle" })).toEqual({ op: "select", ids: ["a", "b"], mode: "toggle" });
    expect(parseVisualGroupsInvoke("assign", { objectIds: ["a"], groupId: "g" })).toEqual({ op: "assign", objectIds: ["a"], groupId: "g" });
    expect(parseVisualGroupsInvoke("assign", { objectIds: ["a"], newName: "New", parentId: "p" })).toEqual({ op: "assign", objectIds: ["a"], newName: "New", parentId: "p" });
    expect(parseVisualGroupsInvoke("pickResult", { requestId: "pick1", cancelled: false, groupId: "g" })).toEqual({ op: "pickResult", requestId: "pick1", cancelled: false, groupId: "g" });
    expect(parseVisualGroupsInvoke("pickResult", { requestId: "pick1", cancelled: false })).toEqual({ op: "pickResult", requestId: "pick1", cancelled: false });
    expect(parseVisualGroupsInvoke("pickResult", { requestId: "pick1", cancelled: true })).toEqual({ op: "pickResult", requestId: "pick1", cancelled: true });
    expect(parseVisualGroupsInvoke("move", { items: [{ kind: "group", id: "g" }, { kind: "object", id: "o" }], parentId: "p", index: 2 })).toEqual({ op: "move", items: [{ kind: "group", id: "g" }, { kind: "object", id: "o" }], parentId: "p", index: 2 });
    expect(parseVisualGroupsInvoke("move", { items: [{ kind: "group", id: "g" }], index: -1 })).toEqual({ op: "move", items: [{ kind: "group", id: "g" }], parentId: null, index: -1 });
    expect(parseVisualGroupsInvoke("move", { items: [{ kind: "group", id: "g" }], parentId: null, index: 1.9 })).toEqual({ op: "move", items: [{ kind: "group", id: "g" }], parentId: null, index: 1 });
  });

  it("drops anything else", () => {
    for (const [op, args] of [
      ["rename", { groupId: "g" }], ["rename", { name: "x" }], ["delete", {}], ["toggleGroup", { groupId: 3 }], ["toggleObject", { id: "" }],
      ["select", { ids: "a", mode: "replace" }], ["select", { ids: ["a"], mode: "other" }], ["select", { ids: [1], mode: "replace" }],
      ["assign", { objectIds: [], groupId: "g" }], ["assign", { objectIds: ["a"] }], ["assign", { objectIds: [3], groupId: "g" }], ["explode", {}], ["pickResult", { cancelled: true }], ["pickResult", { requestId: "p" }], ["pickResult", { requestId: "", cancelled: false }], ["move", { items: [], index: 0 }], ["move", { items: [{ kind: "row", id: "g" }], index: 0 }], ["move", { items: [{ kind: "group", id: "" }], index: 0 }], ["move", { items: "g", index: 0 }], ["move", { items: [{ kind: "group", id: "g" }] }], ["move", { items: [{ kind: "group", id: "g" }], parentId: 5, index: 0 }], ["move", { items: [null], index: 0 }],
    ] as Array<[string, Record<string, unknown>]>) expect(parseVisualGroupsInvoke(op, args), `${op} ${JSON.stringify(args)}`).toBeNull();
  });
});

describe("visualGroups.v1 messages", () => {
  const base = { session: "s-1234567", protocol: 3, id: "e1" };
  it("names the capability and the commands", () => {
    expect(VISUAL_GROUPS_CAPABILITY).toBe("visualGroups.v1");
    expect([...VISUAL_GROUPS_OPS]).toEqual(["create", "rename", "delete", "toggleGroup", "toggleObject", "removeObject", "select", "assign", "pickResult", "move"]);
  });

  it("parses the host's events", () => {
    expect(parseHostEvent({ ...base, type: "visualGroups.invoke", payload: { documentId: "d", op: "toggleGroup", args: { groupId: "g" } } }))
      .toEqual({ ...base, type: "visualGroups.invoke", payload: { documentId: "d", op: "toggleGroup", args: { groupId: "g" } } });
    expect(parseHostEvent({ ...base, type: "visualGroups.watch", payload: { documentId: "d", watching: true } }))
      .toEqual({ ...base, type: "visualGroups.watch", payload: { documentId: "d", watching: true } });
  });

  it("refuses malformed events", () => {
    for (const event of [
      { ...base, type: "visualGroups.invoke", payload: { documentId: "d", op: "nope", args: {} } },
      { ...base, type: "visualGroups.invoke", payload: { documentId: "d", op: "create" } },
      { ...base, type: "visualGroups.invoke", payload: { op: "create", args: {} } },
      { ...base, type: "visualGroups.watch", payload: { documentId: "d", watching: "yes" } },
      { ...base, type: "visualGroups.watch", payload: { watching: true } },
    ]) expect(parseHostEvent(event)).toHaveProperty("invalid");
  });
});

describe("the cascading menu or the chooser", () => {
  const chain = (depth: number): ChooserGroup[] => {
    let node: ChooserGroup = { id: `g${depth}`, name: `g${depth}`, groups: [] };
    for (let i = depth - 1; i >= 1; i--) node = { id: `g${i}`, name: `g${i}`, groups: [node] };
    return [node];
  };
  it("a menu is used for nesting up to the host's depth and for a modest number of groups", () => {
    expect(visualGroupsMenuFits([])).toBe(true);
    expect(visualGroupsMenuFits(visualGroupsOutline(sample()))).toBe(true);
    expect(visualGroupsMenuFits(chain(MENU_MAX_GROUP_DEPTH))).toBe(true);
  });
  it("a hierarchy too deep, or with too many groups, uses the chooser", () => {
    expect(visualGroupsMenuFits(chain(MENU_MAX_GROUP_DEPTH + 1))).toBe(false);
    const many = Array.from({ length: 121 }, (_, i): ChooserGroup => ({ id: `m${i}`, name: `m${i}`, groups: [] }));
    expect(visualGroupsMenuFits(many.slice(0, 120))).toBe(true);
    expect(visualGroupsMenuFits(many)).toBe(false);
  });
});

describe("an opened geometric group keeps its row in the palette, marked as being edited", () => {
  // The group "b" is open: it is not among the shapes (its parts b1, b2 are), but the editor still has it as an open level.
  const shapesOpen = [shape("a"), shape("b1"), shape("b2"), shape("c"), shape("loose")];
  const openB = shape("b", true, "Cabinet");

  it("lists it where it is, flagged, with the group's own name and hidden flag", () => {
    const state = visualGroupsPaletteState(sample(), shapesOpen, ["a", "b1"], nameOf, false, [openB]);
    const ped = state.groups[0];
    expect(ped.items.map((item) => item.id)).toEqual(["a", "b", "cor"]);   // b is in the Pedestal group in the sample: its row stays while the group is open
    expect((ped.items[1] as { editing?: true }).editing).toBe(true);
  });

  it("is in the same place after the group was put into its Visual Group", () => {
    let r = sample();
    r = moveObjectsToGroup(r, ["b"], "ped", 1);
    const state = visualGroupsPaletteState(r, shapesOpen, ["a", "b1"], nameOf, false, [openB]);
    const ped = state.groups[0];
    expect(ped.items.map((item) => item.id)).toEqual(["a", "b", "cor"]);
    expect(ped.items[1]).toEqual({ type: "object", id: "b", name: "<Cabinet>", kind: "box", hidden: true, editing: true });
    expect("editing" in (ped.items[0] as object)).toBe(false);
  });

  it("is not selectable, and does not count for the groups' eye (bulk visibility acts on objects in the scene)", () => {
    const r = moveObjectsToGroup(sample(), ["b"], "ped", 1);
    const state = visualGroupsPaletteState(r, shapesOpen, ["b"], nameOf, false, [openB]);
    expect(state.selected).toEqual([]);
    expect(state.groups[0].visibility).toBe("visible"); // a, c, (d, e not in shapes): the open group's flag is not counted
  });

  it("a group that is open but in no Visual Group shows nothing; once it is done it is an ordinary object again", () => {
    const state = visualGroupsPaletteState(sample(), shapesOpen, [], nameOf, false, [shape("z", false, "Loose group")]);
    expect(JSON.stringify(state)).not.toContain("editing");
    const done = visualGroupsPaletteState(sample(), [...shapesOpen, shape("b")], [], nameOf, false, []);
    expect(JSON.stringify(done)).not.toContain("editing");
    expect(done.groups[0].items.map((item) => item.id)).toEqual(["a", "b", "cor"]);
  });

  it("an open level whose group is also in the scene (not open any more) is just an object", () => {
    const r = moveObjectsToGroup(sample(), ["b"], "ped", 1);
    const state = visualGroupsPaletteState(r, [...shapesOpen, shape("b")], [], nameOf, false, [shape("b")]);
    expect(JSON.stringify(state)).not.toContain("editing");
  });
});
