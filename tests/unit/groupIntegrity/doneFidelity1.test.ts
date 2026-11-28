import { beforeAll, describe, expect, it, vi } from "vitest";
import { disposeManifold, manifoldFromMeshData, restoreGroupedChildren } from "@/lib/editorBooleans";
import { meshForShape } from "@/lib/editorMeshCore";
import { loadedManifoldRuntime } from "@/lib/manifoldHandle";
import { groupFinishProblemMessage } from "@/lib/groupFinishProblems";
import { rebuildGroupFromParts } from "@/lib/groupReconstruction";
import { applyMeshRepairs, scanForOpenMeshes } from "@/lib/meshRepair";
import { createKernelMeshCheck } from "@/lib/meshRepairKernel";
import { firstHeldGroupOnPath } from "@/lib/shapeLock";
import { importedShapeFromStl } from "@/lib/stlImport";
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, bodyStats, makeGroup, primitive, startKernel, TRIANGLE_LIMIT } from "./support";

const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
beforeAll(async () => {
  kernel.runtime = Promise.resolve(await startKernel());
  await assertKernelLive();
});

/** A closed box whose bottom face is split at the middle of one edge while the wall above keeps the whole edge: the T-junction defect of Tinkercad Round Roof (copied from groupFinish.test.ts). */
function tJunctionBox(name: string, size: number): WorkplaneShape {
  const W = size, H = size / 2, D = size;
  const A = [0, 0, 0], B = [W, 0, 0], C = [W, 0, D], E = [0, 0, D], M = [W / 2, 0, 0];
  const A2 = [0, H, 0], B2 = [W, H, 0], C2 = [W, H, D], E2 = [0, H, D];
  const tris = [
    [A, M, E], [M, B, E], [B, C, E],            // bottom: split at M
    [A, A2, B2], [A, B2, B],                    // front wall keeps the whole edge A-B
    [E, E2, A2].reverse(), [E, A2, A].reverse(),
    [B, B2, C2], [B, C2, C],                    // right
    [E, C, C2], [E, C2, E2],                    // back
    [A2, E2, C2], [A2, C2, B2],                 // top
  ] as number[][][];
  // orientation is fixed below by flipping any triangle whose normal points inward
  const centre = [W / 2, H / 2, D / 2];
  const oriented = tris.map(([p, q, r]) => {
    const n = [(q[1] - p[1]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[1] - p[1]), (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]), (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])];
    const out = [(p[0] + q[0] + r[0]) / 3 - centre[0], (p[1] + q[1] + r[1]) / 3 - centre[1], (p[2] + q[2] + r[2]) / 3 - centre[2]];
    return n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0 ? [p, r, q] : [p, q, r];
  });
  const buffer = new ArrayBuffer(84 + 50 * oriented.length);
  const view = new DataView(buffer);
  view.setUint32(80, oriented.length, true);
  oriented.forEach((t, i) => {
    let o = 84 + 50 * i + 12;
    t.forEach((v) => v.forEach((c) => { view.setFloat32(o, c, true); o += 4; }));
  });
  return { ...importedShapeFromStl(`${name}.stl`, buffer), name } as WorkplaneShape;
}

/** A hole that is a block with a bore (a mesh body, as the real documents hold), turned into a cutter. */
async function cutter(id: string, x: number, width = 40, color?: string): Promise<WorkplaneShape> {
  const group = await makeGroup([primitive(`${id}-block`, "box", { x, width, depth: 30, height: 30 }), primitive(`${id}-bore`, "cylinder", { x, hole: true, sides: 32, width: 8, depth: 8, height: 40, elevation: -5 })]);
  return { ...group, id, name: `Cutter ${id}`, hole: true, ...(color ? { color } : {}) } as WorkplaneShape;
}
const orig = (parts: WorkplaneShape[], extra: Partial<WorkplaneShape> = {}) => ({ id: "g", name: "Opening", groupedShapes: parts, groupOperation: "group", ...extra }) as unknown as WorkplaneShape;
const strictRebuild = (parts: WorkplaneShape[], original = orig(parts)) => rebuildGroupFromParts(original, parts, { triangleLimit: TRIANGLE_LIMIT, strict: true });
const plainRebuild = (parts: WorkplaneShape[], original = orig(parts)) => rebuildGroupFromParts(original, parts, { triangleLimit: TRIANGLE_LIMIT });

/** The kernel's own volume of the union of these parts' meshes (the truth the rebuilt body is compared with). */
function unionVolume(parts: WorkplaneShape[]): number {
  const runtime = loadedManifoldRuntime()!;
  const solids = parts.map((part) => manifoldFromMeshData(runtime, meshForShape(part)));
  try {
    const union = runtime.Manifold.union(solids);
    try { return union.volume(); } finally { disposeManifold(union); }
  } finally { solids.forEach(disposeManifold); }
}
function solidStatus(shape: WorkplaneShape): string {
  const solid = manifoldFromMeshData(loadedManifoldRuntime()!, meshForShape(shape));
  try { return solid.status(); } finally { disposeManifold(solid); }
}

/*
 * Build 0126, Done fidelity I: tests written FIRST (they failed before the change). Native Done is `strict`; the non-strict path (the browser) must stay exactly as it was.
 */
describe("hole-only groups are UNIONED by strict Done (Build 0126)", () => {
  it("overlapping holes: the rebuilt body is the true union, not the meshes laid together", async () => {
    const parts = [await cutter("c1", 0), await cutter("c2", 20)];
    const result = await strictRebuild(parts, orig(parts, { hole: true }));
    expect(result.group).toBeTruthy();
    if (!result.group) return;
    const truth = unionVolume(parts);
    expect(Math.abs(bodyStats(result.group).volume - truth) / truth).toBeLessThan(1e-6);
    expect("quality" in result && result.quality?.path).toBe("hole-union");
    expect(solidStatus(result.group)).toBe("NoError");
    expect(result.group.hole).toBe(true);
  });
  it("disjoint holes: a union of disconnected volumes is valid", async () => {
    const parts = [await cutter("c1", 0), await cutter("c2", 200)];
    const result = await strictRebuild(parts);
    expect(result.group).toBeTruthy();
    if (!result.group) return;
    expect(Math.abs(bodyStats(result.group).volume - unionVolume(parts)) / unionVolume(parts)).toBeLessThan(1e-9);
    expect(solidStatus(result.group)).toBe("NoError");
  });
  it("a hole-only group nested in a hole-only group is unioned too", async () => {
    const inner = { ...orig([await cutter("i1", 0), await cutter("i2", 20)], { id: "inner", name: "Inner", hole: true }) } as WorkplaneShape;
    const innerBuilt = await strictRebuild([await cutter("i1", 0), await cutter("i2", 20)], inner);
    const parts = [{ ...innerBuilt.group!, id: "inner", hole: true } as WorkplaneShape, await cutter("c3", 35)];
    const result = await strictRebuild(parts);
    expect(result.group).toBeTruthy();
    if (!result.group) return;
    expect(Math.abs(bodyStats(result.group).volume - unionVolume(parts)) / unionVolume(parts)).toBeLessThan(1e-6);
  });
  it("the non-strict path is unchanged: the meshes are still laid together (the browser)", async () => {
    const parts = [await cutter("c1", 0), await cutter("c2", 20)];
    const result = await plainRebuild(parts);
    expect(result.group).toBeTruthy();
    if (!result.group) return;
    const sum = parts.reduce((acc, part) => acc + bodyStats(part).volume, 0);
    expect(Math.abs(bodyStats(result.group).volume - sum) / sum).toBeLessThan(1e-9);
    expect("quality" in result && result.quality?.path).not.toBe("hole-union");
  });
  it("a hole-only group of primitives only (no mesh body) is unchanged", async () => {
    const parts = [primitive("h1", "box", { hole: true }), primitive("h2", "box", { hole: true, x: 30 })];
    const result = await strictRebuild(parts);
    expect(result.group).toBeTruthy();
    expect("quality" in result && result.quality?.path).toBe("plain");
  });
});

describe("a hole-only union that cannot be made REFUSES Done (Build 0126, Q4)", () => {
  it("an open-mesh hole refuses, names the object, recommends Repair Open Meshes (a T-junction defect), and never falls back to concatenation", async () => {
    const broken = { ...tJunctionBox("Round Roof", 150), id: "rr", hole: true } as WorkplaneShape;
    const parts = [await cutter("c1", 0), broken];
    const result = await strictRebuild(parts);
    expect(result.group).toBeNull();
    const failure = "failure" in result ? result.failure : "";
    expect(failure).toContain("“Round Roof” is not a closed solid");
    expect(failure).toContain("Repair Open Meshes");
    expect(failure).toContain("Cancel");
  });
  it("after the repair the same group unions", async () => {
    const broken = { ...tJunctionBox("Round Roof", 150), id: "rr", hole: true } as WorkplaneShape;
    const repairs = await scanForOpenMeshes([broken], { kernelValid: await createKernelMeshCheck() });
    expect(repairs.repairs.size).toBe(1);
    const fixed = applyMeshRepairs([broken], repairs.repairs).shapes[0];
    const parts = [await cutter("c1", 0), fixed];
    const result = await strictRebuild(parts);
    expect(result.group).toBeTruthy();
    if (!result.group) return;
    expect(Math.abs(bodyStats(result.group).volume - unionVolume(parts)) / unionVolume(parts)).toBeLessThan(1e-6);
  });
  it("an open mesh that is NOT a repairable T-junction defect does not get the repair recommendation (it is not a universal remedy)", async () => {
    const holeInside = { ...tJunctionBox("Torn", 100), id: "torn", hole: true } as WorkplaneShape;
    // remove one triangle: a real hole in the surface, which no T-junction repair can close
    const mesh = holeInside.importedMesh!;
    const torn = { ...holeInside, importedMesh: { ...mesh, positions: mesh.positions.slice(0, mesh.positions.length - 9), triangleCount: mesh.triangleCount - 1 } } as WorkplaneShape;
    const result = await strictRebuild([await cutter("c1", 0), torn]);
    expect(result.group).toBeNull();
    const failure = "failure" in result ? result.failure : "";
    expect(failure).toContain("“Torn”");
    expect(failure).not.toContain("Repair Open Meshes");
  });
  it("the refusal is the same message family as a mixed group's (names the object, Cancel available)", async () => {
    expect(groupFinishProblemMessage({ kind: "openMesh", group: "G", objects: ["A"], repairable: true })).toContain("Model > Repair Open Meshes");
    expect(groupFinishProblemMessage({ kind: "openMesh", group: "G", objects: ["A"] })).not.toContain("Repair Open Meshes");
    expect(groupFinishProblemMessage({ kind: "unionFailed", group: "G" })).toContain("Cancel");
  });
});

describe("properties that must come through a strict Done (Build 0126)", () => {
  it("a hole-only group keeps its own colour", async () => {
    const parts = [await cutter("c1", 0, 40, "#f5831f"), await cutter("c2", 200, 40, "#f5831f")];
    const group = orig(parts, { hole: true, color: "#f5831f" });
    const result = await strictRebuild(parts, group);
    expect(result.group!.color).toBe("#f5831f");
  });
  it("a group's own shape lock survives (data integrity)", async () => {
    const group = { ...(await makeGroup([primitive("a", "box", { x: -20, width: 20 }), primitive("b", "box", { x: 8, width: 12 })])), shapeLocked: true } as WorkplaneShape;
    const parts = restoreGroupedChildren(group).map((part) => ({ ...part, locked: false }));
    const result = await strictRebuild(parts, group);
    expect(Boolean(result.group!.shapeLocked)).toBe(true);
  });
  it("a hidden group opened natively keeps its parts' own flags; Done brings back the same group, still hidden, body intact", async () => {
    const group = { ...(await makeGroup([primitive("a", "box", { x: -20, width: 20 }), primitive("b", "box", { x: 8, width: 12, hidden: true })])), hidden: true } as WorkplaneShape;
    const parts = restoreGroupedChildren(group, undefined, { keepPartVisibility: true }).map((part) => ({ ...part, locked: false }));
    expect(parts.map((part) => Boolean(part.hidden))).toEqual([false, true]);   // each part exactly as stored
    const result = await strictRebuild(parts, group);
    expect(result.group).toBeTruthy();
    expect(result.group!.hidden).toBe(true);
    expect(result.group!.groupedShapes!.map((part) => Boolean(part.hidden))).toEqual([false, true]);
  });
  it("the browser's open step is unchanged: a hidden group's parts are hidden", async () => {
    const group = { ...(await makeGroup([primitive("a", "box", { x: -20, width: 20 }), primitive("b", "box", { x: 8, width: 12 })])), hidden: true } as WorkplaneShape;
    expect(restoreGroupedChildren(group).every((part) => part.hidden)).toBe(true);
  });
});

describe("shape-locked groups are not eligible for Group Editing (Build 0126, Q2)", () => {
  const shapes = (): WorkplaneShape[] => {
    const inner = { ...primitive("inner", "box", {}), groupedShapes: [primitive("i1", "box", {}), primitive("i2", "box", { x: 20 })], shapeLocked: true } as WorkplaneShape;
    const middle = { ...primitive("middle", "box", {}), groupedShapes: [inner, primitive("m2", "box", { x: 40 })] } as WorkplaneShape;
    const root = { ...primitive("root", "box", {}), groupedShapes: [middle, primitive("r2", "box", { x: 60 })] } as WorkplaneShape;
    const lockedRoot = { ...primitive("lroot", "box", {}), groupedShapes: [primitive("l1", "box", {}), primitive("l2", "box", { x: 20 })], shapeLocked: true } as WorkplaneShape;
    return [root, lockedRoot];
  };
  it("the path check finds the first group that may not be opened, before anything opens", () => {
    const s = shapes();
    expect(firstHeldGroupOnPath(s, "lroot", [], true)?.id).toBe("lroot");
    expect(firstHeldGroupOnPath(s, "root", [], true)).toBeNull();
    expect(firstHeldGroupOnPath(s, "root", [0], true)).toBeNull();            // root -> middle: fine
    expect(firstHeldGroupOnPath(s, "root", [0, 0], true)?.id).toBe("inner");  // root -> middle -> inner (shape-locked target)
    expect(firstHeldGroupOnPath(s, "root", [0, 0], false)).toBeNull();        // only selecting the locked group itself, not opening it
  });
  it("a locked (padlocked) group on the path is found too", () => {
    const s = shapes();
    const locked = s.map((shape) => (shape.id === "root" ? { ...shape, groupedShapes: [{ ...shape.groupedShapes![0], locked: true }, shape.groupedShapes![1]] } : shape)) as WorkplaneShape[];
    expect(firstHeldGroupOnPath(locked, "root", [0], true)?.id).toBe("middle");
  });
});
