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
import { singleConstituent } from "./singleProto";

beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });

/*
 * Build 0129, FAILING FIRST (Bill's decisions of 2026-11-27): what the PRODUCTION strict reconstruction must do for one and zero constituents. They are `it.fails` against today's production code (which refuses both);
 * they flip to plain tests when 0129 is implemented. The PROTOTYPE tests in the same file (plain) show the behaviour is achievable with the existing conventions. Nothing here changes production behaviour.
 */
const pair = async () => makeGroup([primitive("p1", "box", { width: 20, depth: 10, height: 12 }), primitive("p2", "cylinder", { x: 24, sides: 24, width: 10, depth: 10, height: 14 })]);
const production = (G: WorkplaneShape, parts: WorkplaneShape[], opened: readonly WorkplaneShape[]) => rebuildGroupFromParts(G, parts, { triangleLimit: TRIANGLE_LIMIT, strict: true, opened });
const asRemoved = (r: unknown) => Boolean((r as { removed?: boolean }).removed);
const meshOf = (s: WorkplaneShape) => { const o: number[] = []; meshForShape(s).vertices.forEach((v) => o.push(...v)); return o; };

describe("production strict reconstruction with ONE constituent (required; fails until 0129)", () => {
  it.fails("an ordinary group keeps its identity, name and properties and contains the remaining constituent", async () => {
    const G = { ...(await pair()), name: "Window", color: "#12ab34", hidden: false } as WorkplaneShape;
    const opened = openParts(G);
    const r = await production(G, [opened[1]], opened);
    expect(r.group, "failure" in r ? r.failure : "").toBeTruthy();
    expect(r.group!.id).toBe(G.id); expect(r.group!.name).toBe("Window"); expect(r.group!.color).toBe("#12ab34");
    expect(r.group!.groupedShapes).toHaveLength(1);
  });
  it.fails("a posed group keeps its pose and the surviving constituent's world placement and id", async () => {
    const G = posedFrom(await pair(), { rotation: 30, mirrorX: true, stretch: [1.5, 1.5, 1.5] });
    const opened = openParts(G);
    const r = await production(G, [opened[0]], opened);
    expect(r.group).toBeTruthy();
    expect(poseFieldsDiff(r.group!, G)).toBeLessThan(1e-9);
    expect(r.group!.groupedShapes![0].id).toBe(G.groupedShapes![0].id);
    expect(maxVertexDeviation(meshOf(restoreGroupedChildren(r.group!)[0]), meshOf(opened[0]))).toBeLessThan(1e-9);
  });
  it.fails("a bundle stays a bundle; hull is the hull of the remaining constituent; intersection equals it", async () => {
    const parts = [primitive("h1", "box", { width: 20, depth: 20, height: 20 }), primitive("h2", "sphere", { x: 14, sides: 24, width: 20, depth: 20, height: 20 })];
    for (const op of ["bundle", "hull", "intersection"] as const) {
      const G = { ...(await makeGroup(parts)), groupOperation: op } as WorkplaneShape;
      const opened = openParts(G);
      const r = await production(G, [opened[1]], opened);
      expect(r.group, `${op}: ${"failure" in r ? r.failure : ""}`).toBeTruthy();
      expect(r.group!.groupOperation).toBe(op);
    }
  });
  it.fails("an open-mesh constituent in an ordinary group is retained without modification (nothing is computed from it)", async () => {
    const G = await pair();
    const opened = openParts(G);
    const open = { ...opened[1], importedMesh: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], baseWidth: 1, baseDepth: 1, baseHeight: 1, triangleCount: 1, sourceFormat: "json" } } as unknown as WorkplaneShape;
    const r = await production(G, [open], [opened[0], open]);
    expect(r.group).toBeTruthy();
    expect(r.group!.groupedShapes![0].importedMesh!.positions).toEqual(open.importedMesh!.positions);
  });
  it.fails("a loft left with one sketch is refused, naming the reason, never dissolved or turned into another operation", async () => {
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

describe("production strict reconstruction with ZERO constituents (required; fails until 0129)", () => {
  it.fails("is a distinct, successful result: the empty group is to be REMOVED, not an error", async () => {
    const G = await pair();
    const r = await production(G, [], openParts(G));
    expect(asRemoved(r)).toBe(true);
  });
});

describe("an emptied editing context stays open (required; fails until 0129): the level-tracking rule", () => {
  const levels = [{ groupId: "outer", partIds: ["x", "inner"] }, { groupId: "inner", partIds: ["a", "b"] }];
  const rule = openGroupLevelsStillOpen as unknown as (l: typeof levels, ids: ReadonlySet<string>, o?: { keepEmpty: boolean }) => number;
  it("today: deleting every part ends the level silently", () => {
    expect(rule(levels, new Set(["x"]))).toBe(1);                    // inner emptied: it ends, outer still has x
    expect(rule(levels, new Set())).toBe(0);                          // everything gone: both levels end (this is the behaviour 0129 changes in the native app)
  });
  it.fails("native (keepEmpty): an emptied inner or outer level stays open; only Undo past an opening (the group reappearing) ends it", () => {
    expect(rule(levels, new Set(["x"]), { keepEmpty: true })).toBe(2);
    expect(rule(levels, new Set(), { keepEmpty: true })).toBe(2);                      // both emptied: both stay
    expect(rule(levels, new Set(["inner"]), { keepEmpty: true })).toBe(1);             // Undo past the inner opening: the inner group is back, the outer level stays
    expect(rule(levels, new Set(["outer"]), { keepEmpty: true })).toBe(0);             // Undo past the outer opening: everything ends
  });
});

describe("the PROTOTYPE (tests only) shows the behaviour is achievable with the existing conventions", () => {
  it("one constituent: identity, name, colour kept; the group IS its constituent geometrically", async () => {
    const G = { ...(await pair()), name: "Window", color: "#12ab34" } as WorkplaneShape;
    const opened = openParts(G);
    const r = await singleConstituent(G, [opened[1]], opened);
    expect(r.group, r.failure).toBeTruthy();
    expect(r.group!.id).toBe(G.id); expect(r.group!.name).toBe("Window"); expect(r.group!.color).toBe("#12ab34");
    expect(r.group!.groupedShapes![0].id).toBe(G.groupedShapes![1].id);
    expect(Math.abs(bodyStats(r.group!).volume - bodyStats(opened[1]).volume)).toBeLessThan(1e-6);
    expect(maxVertexDeviation(meshOf(restoreGroupedChildren(r.group!)[0]), meshOf(opened[1]))).toBeLessThan(1e-9);
  });
  it("hull of one constituent is the hull (a sphere's hull is the sphere's mesh, a concave part's is larger); intersection of one equals it", async () => {
    const G = { ...(await makeGroup([primitive("h1", "box", { width: 20, depth: 20, height: 20 }), primitive("h2", "sphere", { x: 14, sides: 24, width: 20, depth: 20, height: 20 })])), groupOperation: "hull" } as WorkplaneShape;
    const opened = openParts(G);
    const hull = await singleConstituent(G, [opened[1]], opened);
    expect(hull.group, hull.failure).toBeTruthy();
    expect(hull.group!.groupOperation).toBe("hull");
    expect(hull.group!.importedMesh).toBeTruthy();
    const I = { ...G, groupOperation: "intersection" } as WorkplaneShape;
    const inter = await singleConstituent(I, [opened[0]], opened);
    expect(inter.group, inter.failure).toBeTruthy();
    expect(Math.abs(bodyStats(inter.group!).volume - bodyStats(opened[0]).volume) / bodyStats(opened[0]).volume).toBeLessThan(1e-6);
  });
  it("zero constituents: removed; a loft with one sketch: refused", async () => {
    const G = await pair();
    expect((await singleConstituent(G, [], openParts(G))).removed).toBe(true);
    const L = { ...G, groupOperation: "loft" } as WorkplaneShape;
    expect((await singleConstituent(L, [openParts(L)[0]], openParts(L))).group).toBeNull();
  });
});
