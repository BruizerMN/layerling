import { beforeAll, describe, expect, it, vi } from "vitest";
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
import { restoreGroupedChildren } from "@/lib/editorBooleans";
import { meshForShape } from "@/lib/editorMeshCore";
import { openGroupLevelsStillOpen } from "@/lib/openGroupParts";
import { rebuildGroupFromParts } from "@/lib/groupReconstruction";
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, bodyStats, makeGroup, maxVertexDeviation, primitive, startKernel, TRIANGLE_LIMIT } from "./support";
import { openParts, poseFieldsDiff, posedFrom } from "./poseLab";

beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });

/*
 * Build 0129 (Bill's decisions of 2026-11-27): what the PRODUCTION strict reconstruction does for one and zero constituents. Written failing first (as `it.fails` against 0128, which refused both) and permanent
 * regression tests since the implementation. Synthetic coverage of every group operation: the real-document census (singleConstituent.fixtures.test.ts) only meets ordinary groups.
 */
const pair = async () => makeGroup([primitive("p1", "box", { width: 20, depth: 10, height: 12 }), primitive("p2", "cylinder", { x: 24, sides: 24, width: 10, depth: 10, height: 14 })]);
const production = (G: WorkplaneShape, parts: WorkplaneShape[], opened: readonly WorkplaneShape[]) => rebuildGroupFromParts(G, parts, { triangleLimit: TRIANGLE_LIMIT, strict: true, opened });
const asRemoved = (r: unknown) => Boolean((r as { removed?: boolean }).removed);
const meshOf = (s: WorkplaneShape) => { const o: number[] = []; meshForShape(s).vertices.forEach((v) => o.push(...v)); return o; };

describe("production strict reconstruction with ONE constituent (Build 0129)", () => {
  it("an ordinary group keeps its identity, name and properties and contains the remaining constituent", async () => {
    const G = { ...(await pair()), name: "Window", color: "#12ab34", hidden: false } as WorkplaneShape;
    const opened = openParts(G);
    const r = await production(G, [opened[1]], opened);
    expect(r.group, "failure" in r ? r.failure : "").toBeTruthy();
    expect(r.group!.id).toBe(G.id); expect(r.group!.name).toBe("Window"); expect(r.group!.color).toBe("#12ab34");
    expect(r.group!.groupedShapes).toHaveLength(1);
  });
  it("a posed group keeps its pose and the surviving constituent's world placement and id", async () => {
    const G = posedFrom(await pair(), { rotation: 30, mirrorX: true, stretch: [1.5, 1.5, 1.5] });
    const opened = openParts(G);
    const r = await production(G, [opened[0]], opened);
    expect(r.group).toBeTruthy();
    expect(poseFieldsDiff(r.group!, G)).toBeLessThan(1e-9);
    expect(r.group!.groupedShapes![0].id).toBe(G.groupedShapes![0].id);
    expect(maxVertexDeviation(meshOf(restoreGroupedChildren(r.group!)[0]), meshOf(opened[0]))).toBeLessThan(1e-9);
  });
  it("a bundle stays a bundle; hull is the hull of the remaining constituent; intersection equals it", async () => {
    const parts = [primitive("h1", "box", { width: 20, depth: 20, height: 20 }), primitive("h2", "sphere", { x: 14, sides: 24, width: 20, depth: 20, height: 20 })];
    for (const op of ["bundle", "hull", "intersection"] as const) {
      const G = { ...(await makeGroup(parts)), groupOperation: op } as WorkplaneShape;
      const opened = openParts(G);
      const r = await production(G, [opened[1]], opened);
      expect(r.group, `${op}: ${"failure" in r ? r.failure : ""}`).toBeTruthy();
      expect(r.group!.groupOperation).toBe(op);
    }
  });
  it("an open-mesh constituent in an ordinary group is retained without modification (nothing is computed from it)", async () => {
    const G = await pair();
    const opened = openParts(G);
    const open = { ...opened[1], importedMesh: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], baseWidth: 1, baseDepth: 1, baseHeight: 1, triangleCount: 1, sourceFormat: "json" } } as unknown as WorkplaneShape;
    const r = await production(G, [open], [opened[0], open]);
    expect(r.group).toBeTruthy();
    expect(r.group!.groupedShapes![0].importedMesh!.positions).toEqual(open.importedMesh!.positions);
  });
  it("a loft left with one sketch is refused, naming the reason, never dissolved or turned into another operation", async () => {
    const G = { ...(await pair()), groupOperation: "loft" } as WorkplaneShape;
    const opened = openParts(G);
    const r = await production(G, [opened[0]], opened);
    expect(r.group).toBeNull();
    expect("failure" in r && r.failure).toMatch(/loft/i);
  });
  it("the browser's non-strict reconstruction is unchanged: it still refuses one constituent (the browser dissolves in the editor)", async () => {
    const G = await pair();
    const r = await rebuildGroupFromParts(G, [openParts(G)[0]], { triangleLimit: TRIANGLE_LIMIT });
    expect(r.group).toBeNull();
  });
});

describe("production strict reconstruction with ZERO constituents (Build 0129)", () => {
  it("is a distinct, successful result: the empty group is to be REMOVED, not an error", async () => {
    const G = await pair();
    const r = await production(G, [], openParts(G));
    expect(asRemoved(r)).toBe(true);
  });
});

describe("an emptied editing context stays open (Build 0129): the level-tracking rule", () => {
  const levels = [{ groupId: "outer", partIds: ["x", "inner"] }, { groupId: "inner", partIds: ["a", "b"] }];
  const rule = openGroupLevelsStillOpen as unknown as (l: typeof levels, ids: ReadonlySet<string>, o?: { keepEmpty: boolean }) => number;
  it("browser (default, unchanged): deleting every part ends the level silently", () => {
    expect(rule(levels, new Set(["x"]))).toBe(1);                    // inner emptied, outer still has x
    expect(rule(levels, new Set())).toBe(0);                          // everything gone: both levels end (this is the behaviour 0129 changes in the native app)
  });
  it("native (keepEmpty): an emptied inner or outer level stays open; only Undo past an opening (the group reappearing) ends it", () => {
    expect(rule(levels, new Set(["x"]), { keepEmpty: true })).toBe(2);
    expect(rule(levels, new Set(), { keepEmpty: true })).toBe(2);                      // both emptied: both stay
    expect(rule(levels, new Set(["inner"]), { keepEmpty: true })).toBe(1);             // Undo past the inner opening: the inner group is back, the outer level stays
    expect(rule(levels, new Set(["outer"]), { keepEmpty: true })).toBe(0);             // Undo past the outer opening: everything ends
  });
});

describe("production: what the single constituent IS, per operation", () => {
  const two = async (op: string) => ({ ...(await makeGroup([primitive("h1", "box", { width: 20, depth: 20, height: 20 }), primitive("h2", "sphere", { x: 14, sides: 24, width: 20, depth: 20, height: 20 })])), groupOperation: op } as WorkplaneShape);
  it("ordinary group: identity, name, colour kept; the group IS its constituent geometrically; the surviving child keeps its id", async () => {
    const G = { ...(await pair()), name: "Window", color: "#12ab34" } as WorkplaneShape;
    const opened = openParts(G);
    const r = await production(G, [opened[1]], opened);
    expect(r.group, "failure" in r ? r.failure : "").toBeTruthy();
    expect(r.group!.groupedShapes![0].id).toBe(G.groupedShapes![1].id);
    expect(Math.abs(bodyStats(r.group!).volume - bodyStats(opened[1]).volume)).toBeLessThan(1e-6);
    expect(maxVertexDeviation(meshOf(restoreGroupedChildren(r.group!)[0]), meshOf(opened[1]))).toBeLessThan(1e-9);
  });
  it("the group keeps its colour whichever constituent is left (the survivor says nothing about the group)", async () => {
    const G = await makeGroup([primitive("c1", "box", { color: "#ff0000", width: 20, depth: 10, height: 12 }), primitive("c2", "box", { x: 24, color: "#0000ff", width: 10, depth: 10, height: 14 })]);
    const opened = openParts(G);
    for (const keep of [0, 1]) expect((await production(G, [opened[keep]], opened)).group!.color).toBe(G.color);
  });
  it("a MOVED surviving constituent also keeps its id and lands where it was put", async () => {
    const G = await pair(); const opened = openParts(G);
    const moved = { ...opened[0], x: opened[0].x + 7 };
    const r = await production(G, [moved], opened);
    expect(r.group!.groupedShapes![0].id).toBe(G.groupedShapes![0].id);
    expect(maxVertexDeviation(meshOf(restoreGroupedChildren(r.group!)[0]), meshOf(moved))).toBeLessThan(1e-9);
  });
  it("hull: the hull of the remaining constituent (a sphere); intersection: the constituent itself; bundle stays a bundle", async () => {
    const H = await two("hull"); const opened = openParts(H);
    const hull = await production(H, [opened[1]], opened);
    expect(hull.group, "failure" in hull ? hull.failure : "").toBeTruthy();
    expect(hull.group!.groupOperation).toBe("hull");
    const I = await two("intersection");
    const inter = await production(I, [openParts(I)[0]], openParts(I));
    expect(inter.group, "failure" in inter ? inter.failure : "").toBeTruthy();
    expect(Math.abs(bodyStats(inter.group!).volume - bodyStats(openParts(I)[0]).volume) / bodyStats(openParts(I)[0]).volume).toBeLessThan(1e-6);
    const B = await two("bundle");
    const bundle = await production(B, [openParts(B)[1]], openParts(B));
    expect(bundle.group!.groupOperation).toBe("bundle");
  });
  it("a hull or intersection of an open mesh is refused naming it (they need a closed solid); an ordinary group keeps it verbatim", async () => {
    const open = (p: WorkplaneShape) => ({ ...p, kind: "mesh", importedMesh: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], baseWidth: 1, baseDepth: 1, baseHeight: 1, triangleCount: 1, sourceFormat: "json" } }) as unknown as WorkplaneShape;
    for (const op of ["hull", "intersection"]) {
      const G = await two(op); const opened = openParts(G);
      const r = await production(G, [open(opened[0])], [open(opened[0]), opened[1]]);
      expect(r.group, op).toBeNull();
      expect("failure" in r && r.failure).toMatch(/not a closed solid/);
    }
  });
  it("a posed hull/intersection of one keeps its pose", async () => {
    for (const op of ["hull", "intersection"]) {
      const G = posedFrom(await two(op), { rotation: 30, mirrorX: true, stretch: [1.5, 1.5, 1.5] });
      const opened = openParts(G);
      const r = await production(G, [opened[0]], opened);
      expect(r.group, `${op}: ${"failure" in r ? r.failure : ""}`).toBeTruthy();
      expect(poseFieldsDiff(r.group!, G)).toBeLessThan(1e-9);
    }
  });
  it("the pose gate still applies to a changed constituent: a turned part in an unevenly resized group is refused as before", async () => {
    const G = posedFrom(await pair(), { rotation: 33, stretch: [2, 1.3, 0.6] });
    const opened = openParts(G);
    const r = await production(G, [{ ...opened[1], rotation: (opened[1].rotation ?? 0) + 25 }], opened);
    expect(r.group).toBeNull();
    expect("failure" in r && r.failure).toMatch(/turned at an angle/);
  });
  it("zero constituents: removed whatever the pose or operation (nothing to refuse)", async () => {
    for (const G of [await pair(), posedFrom(await pair(), { rotation: 30, mirrorX: true, stretch: [1.5, 2, 1] }), { ...(await pair()), groupOperation: "loft" } as WorkplaneShape]) {
      expect(asRemoved(await production(G, [], openParts(G)))).toBe(true);
    }
  });
});
