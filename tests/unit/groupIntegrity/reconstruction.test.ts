import { beforeAll, describe, expect, it, vi } from "vitest";
import { restoreGroupedChildren } from "@/lib/editorBooleans";
import { derivedLocalId } from "@/lib/localIds";
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, compareGroups, editThroughChain, flatLeaves, makeGroup, maxVertexDeviation, openAndFinish, primitive, propertyDiffs, startKernel } from "./support";

const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));

beforeAll(async () => {
  kernel.runtime = Promise.resolve(await startKernel());
  await assertKernelLive();
});

/*
 * Tests of the production reconstruction (lib/groupReconstruction.ts, what Done runs) on synthetic groups.
 *
 * Two kinds of tests, kept apart on purpose:
 *  - plain tests state what is correct today: a failure is a REGRESSION;
 *  - `it.fails("KNOWN DEFECT ...")` state the behaviour we REQUIRE but do not have yet (Findings 1 and 2). They pass while the defect exists and
 *    start FAILING when it is fixed, which is the signal to turn them into plain tests. Nothing is weakened to make existing behaviour pass.
 */

const wall = () => primitive("wall", "box", { width: 100, depth: 10, height: 60 });
const window_ = (x = 10) => primitive("win", "box", { hole: true, x, width: 20, depth: 14, height: 30, elevation: 15 });
const plainParts = () => [primitive("a", "box", { x: -20, width: 20, depth: 10, height: 15 }), primitive("b", "cylinder", { x: 8, z: 3, elevation: 4, width: 12, depth: 12, height: 9, sides: 48 })];

describe("reconstruction of untransformed groups (current behaviour that must hold)", () => {
  it("a plain group opened and finished unchanged keeps leaves, order, names and properties", async () => {
    const group = await makeGroup(plainParts());
    const { result } = await openAndFinish(group);
    expect(result.group).toBeTruthy();
    const c = compareGroups(group, result.group!);
    expect(c.structureSame).toBe(true);
    expect(c.maxLeafDeviation).toBe(0);
    expect(c.properties).toEqual({});
    expect(c.bboxDeviation).toBeLessThan(1e-9);
  });

  it("a solid with a cutting hole keeps its body", async () => {
    const group = await makeGroup([wall(), window_()]);
    const { result } = await openAndFinish(group);
    const c = compareGroups(group, result.group!);
    expect(c.structureSame).toBe(true);
    expect(c.maxLeafDeviation).toBe(0);
    expect(c.properties).toEqual({});
    expect(Math.abs(c.relativeVolume)).toBeLessThan(1e-9);
  });

  it("the rebuilt group keeps its own id, name and part order", async () => {
    const group = { ...(await makeGroup(plainParts())), name: "Fence" } as WorkplaneShape;
    const { result } = await openAndFinish(group);
    expect(result.group!.id).toBe(group.id);
    expect(result.group!.name).toBe("Fence");
    expect(result.group!.groupedShapes!.map((part) => part.name)).toEqual(group.groupedShapes!.map((part) => part.name));
  });

  it("a nested group goes through open and finish with every leaf exact", async () => {
    const inner = await makeGroup([wall(), window_()]);
    const door = await makeGroup([primitive("leaf", "box", { x: -40, width: 18, depth: 4, height: 50 }), primitive("knob", "sphere", { x: -33, z: 3, elevation: 20, width: 3, depth: 3, height: 3, sides: 16 })]);
    const top = await makeGroup([{ ...inner, name: "WallGroup" }, { ...door, name: "DoorGroup", x: 30, z: 20 }, primitive("pillar", "cylinder", { x: -60, z: 40, width: 8, depth: 8, height: 70, sides: 64 })]);
    const { result } = await openAndFinish(top);
    const c = compareGroups(top, result.group!);
    expect(c.structureSame).toBe(true);
    expect(c.maxLeafDeviation).toBe(0);
    expect(Math.abs(c.relativeVolume)).toBeLessThan(1e-9);
  });
});

describe("one deliberate change to a deeply nested object", () => {
  it("changes only that leaf; every other leaf and every untouched nested body stays exact", async () => {
    const l3 = await makeGroup([primitive("p1", "box", { x: -5, width: 6, depth: 6, height: 6 }), primitive("p2", "box", { x: 5, width: 6, depth: 6, height: 6 })]);
    const l2 = await makeGroup([{ ...l3, name: "L3", x: 40 }, primitive("sibling2", "box", { x: -40, width: 8, depth: 8, height: 8 })]);
    const l1 = await makeGroup([{ ...l2, name: "L2" }, primitive("sibling1", "cylinder", { z: 40, width: 9, depth: 9, height: 9, sides: 32 })]);
    const top = await makeGroup([{ ...l1, name: "L1" }, primitive("bystander", "box", { x: 200, width: 12, depth: 12, height: 12 })]);
    const before = flatLeaves(top);
    // the route names the group whose parts are edited: top -> L1 (0) -> L2 (0) -> L3 (0); p2 is its part 1
    const out = await editThroughChain(top, [0, 0, 0], (parts) => parts.map((part, index) => (index === 1 ? { ...part, x: part.x + 1 } : part)));
    expect(out.ok, out.ok ? "" : `failed at level ${out.level}: ${out.failure}`).toBe(true);
    if (!out.ok) return;
    const after = flatLeaves(out.result);
    expect(after.length).toBe(before.length);
    const moved = before.map((leaf, index) => maxVertexDeviation(leaf.verts, after[index].verts));
    expect(moved.filter((deviation) => deviation > 1e-9)).toHaveLength(1);
    expect(Math.max(...moved)).toBeCloseTo(1, 9);
    expect(after.map((leaf) => leaf.shape.name)).toEqual(before.map((leaf) => leaf.shape.name));
  });
});

describe("known defects (Findings 1 and 2): required behaviour, not yet delivered", () => {
  const transformed = async () => ({ ...(await makeGroup(plainParts())), x: 100, z: 50, rotation: 30, mirrorX: true } as WorkplaneShape);

  it.fails("KNOWN DEFECT D2a: a rotated and mirrored group keeps its own rotation and mirror after Done (build 0122 pose-preserving rebuild)", async () => {
    const group = await transformed();
    const { result } = await openAndFinish(group);
    expect(propertyDiffs(group, result.group!)).toEqual({});
  });

  it.fails("KNOWN DEFECT D2b: a hole-only group keeps its own colour after Done (as in the real documents: orange hole groups turn hole grey)", async () => {
    const cutter = async (id: string, x: number) => ({
      ...(await makeGroup([primitive(`${id}b`, "box", { x, color: "#f5831f" }), primitive(`${id}c`, "cylinder", { x, hole: true, sides: 32, width: 4, depth: 4, height: 14, elevation: -2 })])),
      id, hole: true, color: "#f5831f",
    } as WorkplaneShape);
    const group = { ...(await makeGroup([await cutter("c1", 0), await cutter("c2", 20)])), color: "#f5831f" } as WorkplaneShape;
    const { result } = await openAndFinish(group);
    expect(result.group!.color).toBe("#f5831f");
  });

  it.fails("KNOWN DEFECT D2c: a group's own shape lock survives Done", async () => {
    const group = { ...(await makeGroup(plainParts())), shapeLocked: true } as WorkplaneShape;
    const { result } = await openAndFinish(group);
    expect(Boolean(result.group!.shapeLocked)).toBe(true);
  });

  it.fails("KNOWN DEFECT D2d: finishing a hidden group does not hide its parts or empty its body", async () => {
    const group = { ...(await makeGroup(plainParts())), hidden: true } as WorkplaneShape;
    const { result } = await openAndFinish(group);
    expect(result.group!.groupedShapes!.every((part) => !part.hidden)).toBe(true);
  });

  it.fails("KNOWN DEFECT D2e: an unchanged session restores the original group exactly, including its part ids (build 0122)", async () => {
    const group = await makeGroup(plainParts());
    const { result } = await openAndFinish(group);
    expect(result.group!.groupedShapes!.map((part) => part.id)).toEqual(group.groupedShapes!.map((part) => part.id));
  });

  it("documents why: opening mints new part ids every time (derivedLocalId) and the opened parts are world-placed copies", async () => {
    const group = await makeGroup(plainParts());
    const first = restoreGroupedChildren(group).map((part) => part.id);
    const second = restoreGroupedChildren(group).map((part) => part.id);
    expect(first).not.toEqual(second);
    expect(derivedLocalId(first[0], "ungroup")).not.toBe(first[0]);
  });
});
