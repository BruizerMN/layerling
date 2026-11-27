import { describe, expect, it } from "vitest";
import { buildObjectRows, diffObjects, flattenObjectRows, objectRowName, OBJECTS_MAX_DEPTH } from "@/lib/objectsSnapshot";
import { parseObjectsInvoke } from "@/lib/host/nativeObjects";
import { parseHostEvent } from "@/lib/host/hostProtocol";
import type { WorkplaneShape } from "@/types/layerling";

const shape = (id: string, extra: Record<string, unknown> = {}): WorkplaneShape => ({ id, kind: "box", color: "#ff0000", ...extra }) as unknown as WorkplaneShape;
const nameOf = (s: WorkplaneShape) => s.name ?? `Box ${s.id}`;

describe("objects.v1 snapshot", () => {
  it("keeps the engine's order and nesting, and only sets flags that are true", () => {
    const group = shape("g", { kind: "group", groupedShapes: [shape("p1"), shape("p2", { hole: true })] });
    const bundle = shape("b", { kind: "group", groupOperation: "bundle", groupedShapes: [shape("q")] });
    const rows = buildObjectRows([shape("a", { hidden: true, locked: true, shapeLocked: true }), group, bundle], nameOf)!;
    expect(rows.map((r) => r.id)).toEqual(["a", "g", "b"]);
    expect(rows[0]).toEqual({ id: "a", name: "Box a", kind: "box", hidden: true, locked: true, shapeLocked: true, color: "#ff0000" });
    expect(rows[1].group).toBe("group");
    expect(rows[1].items?.map((r) => r.id)).toEqual(["p1", "p2"]);
    expect(rows[1].items?.[1].hole).toBe(true);
    expect(rows[2].group).toBe("bundle");
    expect(rows[0]).not.toHaveProperty("hole");
  });
  it("gives a part without an id a stable id of its own", () => {
    const rows = buildObjectRows([shape("g", { groupedShapes: [shape(""), shape("")] })], nameOf)!;
    expect(rows[0].items?.map((r) => r.id)).toEqual(["g#0", "g#1"]);
  });
  it("refuses a hierarchy beyond the depth bound", () => {
    let deep = shape("leaf");
    for (let i = 0; i < OBJECTS_MAX_DEPTH + 2; i += 1) deep = shape(`g${i}`, { groupedShapes: [deep] });
    expect(buildObjectRows([deep], nameOf)).toBeNull();
  });
  it("names rows like the object list", () => {
    const tr = (key: string) => ({ "shape.group": "Group", "shape.box": "Box" })[key] ?? "";
    const display = (s: WorkplaneShape) => s.name ?? "";
    expect(objectRowName(shape("a", { name: " Lid " }), () => "Lid", tr)).toBe("Lid");
    expect(objectRowName(shape("a"), display, tr)).toBe("Box");
    expect(objectRowName(shape("a", { groupedShapes: [shape("x")] }), display, tr)).toBe("Group");
    expect(objectRowName(shape("a", { kind: "weird" }), display, tr)).toBe("weird");
  });
});

describe("objects.v1 diff: the three costs", () => {
  const filler = (over: Record<string, unknown> = {}) => Array.from({ length: 10 }, (_, i) => shape(`x${i}`, i < 2 ? over : {}));
  const make = (a: Record<string, unknown> = {}, c: Record<string, unknown> = {}, fill: Record<string, unknown> = {}) =>
    flattenObjectRows(buildObjectRows([shape("a", a), shape("b", { groupedShapes: [shape("c", c)] }), shape("d"), ...filler(fill)], nameOf)!);
  it("sends the whole tree for the first publish and for a structural change", () => {
    expect(diffObjects(null, make()).kind).toBe("tree");
    const moved = flattenObjectRows(buildObjectRows([shape("b", { groupedShapes: [shape("c")] }), shape("a"), shape("d"), ...filler()], nameOf)!);
    expect(diffObjects(make(), moved).kind).toBe("tree");
    const regrouped = flattenObjectRows(buildObjectRows([shape("a"), shape("b", { groupedShapes: [shape("c"), shape("d")] }), ...filler()], nameOf)!);
    expect(diffObjects(make(), regrouped).kind).toBe("tree");
  });
  it("sends nothing when nothing changed (a selection change never reaches here)", () => {
    expect(diffObjects(make(), make()).kind).toBe("none");
  });
  it("sends only the changed rows for a property change, nested rows included", () => {
    const diff = diffObjects(make(), make({ name: "Renamed" }, { hidden: true }));
    expect(diff.kind).toBe("patch");
    if (diff.kind === "patch") expect(diff.rows.map((r) => r.id).sort()).toEqual(["a", "c"]);
  });
  it("falls back to the whole tree when a patch would be most of it", () => {
    expect(diffObjects(make(), make({ hidden: true }, { hidden: true }, { hidden: true })).kind).toBe("tree");
  });
});

describe("objects.v1 protocol", () => {
  it("accepts only the known invoke ops with sound arguments", () => {
    expect(parseObjectsInvoke("select", { ids: ["a", "b"], mode: "replace" })).toEqual({ op: "select", ids: ["a", "b"], mode: "replace" });
    expect(parseObjectsInvoke("select", { ids: ["a", ""], mode: "replace" })).toBeNull();
    expect(parseObjectsInvoke("select", { ids: ["a"], mode: "add" })).toBeNull();
    expect(parseObjectsInvoke("openGroupPart", { groupId: "g", partId: "p" })).toEqual({ op: "openGroupPart", groupId: "g", partId: "p" });
    expect(parseObjectsInvoke("openGroupPart", { groupId: "g" })).toBeNull();
    expect(parseObjectsInvoke("rename", { id: "a", name: "x" })).toBeNull();
  });
  it("parses the host's objects events and rejects malformed ones", () => {
    const base = { session: "s", protocol: 3, id: "e1" };
    expect(parseHostEvent({ ...base, type: "objects.watch", payload: { documentId: "d", watching: true } })).toMatchObject({ type: "objects.watch" });
    expect(parseHostEvent({ ...base, type: "objects.watch", payload: { documentId: "d" } })).toHaveProperty("invalid");
    expect(parseHostEvent({ ...base, type: "objects.invoke", payload: { documentId: "d", op: "select", args: { ids: [], mode: "replace" } } })).toMatchObject({ type: "objects.invoke" });
    expect(parseHostEvent({ ...base, type: "objects.invoke", payload: { documentId: "d", op: "delete", args: {} } })).toHaveProperty("invalid");
  });
});
