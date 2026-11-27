import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildGroupedShapeFromSelection } from "@/lib/editorBooleans";
import { groupFinishProblemMessage } from "@/lib/groupFinishProblems";
import { partsThatAreNotClosedSolids, rebuildGroupFromParts } from "@/lib/groupReconstruction";
import { importedShapeFromStl } from "@/lib/stlImport";
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, bodyStats, makeGroup, primitive, startKernel, TRIANGLE_LIMIT } from "./support";

const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
beforeAll(async () => {
  kernel.runtime = Promise.resolve(await startKernel());
  await assertKernelLive();
});

/*
 * Build 0122: Done safety. `rebuildGroupFromParts` with `strict` (native Done):
 *  - holes that touch no solid are a SUCCESS (the body is the solids; the holes stay among the parts);
 *  - a cut that fails although the shapes overlap, an operand that is not a closed solid, or a body that could only be made by a degraded fallback is REFUSED,
 *    naming the object where it can be found;
 *  - without `strict` the behaviour is exactly that of Build 0121 (the browser).
 */

/** A closed box whose bottom face is split at the middle of one edge while the wall above keeps the whole edge: the T-junction defect of Tinkercad's Round Roof. */
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

/** A valid solid with a mesh body (a block with a bore), as the real documents hold. */
async function blockBody(id: string, x = 0): Promise<WorkplaneShape> {
  const group = await makeGroup([primitive(`${id}-block`, "box", { x, width: 60, depth: 40, height: 30 }), primitive(`${id}-bore`, "cylinder", { x, hole: true, sides: 32, width: 8, depth: 8, height: 40, elevation: -5 })]);
  return { ...group, id, name: "Block" } as WorkplaneShape;
}
const world = (shape: WorkplaneShape, patch: Partial<WorkplaneShape>) => ({ ...shape, ...patch }) as WorkplaneShape;
const rebuild = (parts: WorkplaneShape[], strict: boolean, original?: WorkplaneShape) => rebuildGroupFromParts(original ?? ({ id: "g", name: "Window", groupedShapes: parts, groupOperation: "group" } as unknown as WorkplaneShape), parts, { triangleLimit: TRIANGLE_LIMIT, strict });

describe("holes that touch no solid", () => {
  it("are a success when strict: the body is the solid alone and the hole stays among the parts", async () => {
    const block = await blockBody("b");
    const farHole = { ...primitive("far", "cylinder", { hole: true, sides: 32, x: 400, width: 10, depth: 10, height: 20 }) } as WorkplaneShape;
    const result = await rebuild([block, farHole], true);
    expect(result.group).toBeTruthy();
    if (!result.group) return;
    expect(result.group.groupedShapes).toHaveLength(2);
    expect(result.group.groupedShapes!.some((part) => part.hole && part.name === "far")).toBe(true);
    expect("quality" in result && result.quality?.path).toBe("clear-hole");
    expect(Math.abs(bodyStats(result.group).volume - bodyStats(block).volume)).toBeLessThan(1e-6);
  });

  it("are not accepted without strict (the browser keeps its behaviour)", async () => {
    const block = await blockBody("b");
    const farHole = primitive("far", "cylinder", { hole: true, sides: 32, x: 400, width: 10, depth: 10, height: 20 });
    const result = await rebuild([block, farHole], false);
    expect("quality" in result ? result.quality?.path : undefined).not.toBe("clear-hole");
  });

  it("a hole that really overlaps a solid is cut, not treated as clear", async () => {
    const block = await blockBody("b");
    const overlapping = primitive("cut", "cylinder", { hole: true, sides: 32, x: 15, width: 10, depth: 10, height: 20, elevation: 5 });
    const result = await rebuild([block, overlapping], true);
    expect(result.group).toBeTruthy();
    if (!result.group) return;
    expect("quality" in result && result.quality?.path).toBe("kernel-cut");
    expect(bodyStats(result.group).volume).toBeLessThan(bodyStats(block).volume - 1);
  });
});

describe("a boolean failure is never accepted as success", () => {
  it("an operand that is not a closed solid is refused and named (strict)", async () => {
    const block = await blockBody("b");
    const broken = world({ ...tJunctionBox("Round Roof", 150), hole: true } as WorkplaneShape, { x: 0, elevation: 5 });
    expect(await partsThatAreNotClosedSolids([block, broken])).toEqual(["Round Roof"]);
    const result = await rebuild([block, broken], true);
    expect(result.group).toBeNull();
    if (result.group) return;
    expect(result.failure).toContain("Cannot finish");
    expect(result.failure).toContain("“Round Roof”");
    expect(result.failure).toContain("Window");
  });

  it("the same refusal when the broken hole touches nothing: an unknown operand is not 'clear'", async () => {
    const block = await blockBody("b");
    const broken = world({ ...tJunctionBox("Round Roof", 150), hole: true } as WorkplaneShape, { x: 600 });
    const result = await rebuild([block, broken], true);
    expect(result.group).toBeNull();
  });
});

describe("hole-only groups are laid together by design and are not refused", () => {
  it("strict reconstruction of a hole-only group succeeds and is not marked degraded", async () => {
    const cutter = async (id: string, x: number) => ({
      ...(await makeGroup([primitive(`${id}b`, "box", { x, color: "#f5831f" }), primitive(`${id}c`, "cylinder", { x, hole: true, sides: 32, width: 4, depth: 4, height: 14, elevation: -2 })])),
      id, hole: true,
    } as WorkplaneShape);
    const parts = [await cutter("c1", 0), await cutter("c2", 20)];
    const result = await rebuild(parts, true);
    expect(result.group).toBeTruthy();
    expect("quality" in result && result.quality?.degraded).toBeUndefined();
  });
});

describe("the quality of a build is reported", () => {
  it("a kernel union and a plain group say so", async () => {
    const a = await blockBody("a");
    const b = await blockBody("b", 30);
    const union = await buildGroupedShapeFromSelection([a, b], TRIANGLE_LIMIT);
    expect(union.quality?.path).toBe("kernel-union");
    const plain = await buildGroupedShapeFromSelection([primitive("p1", "box", {}), primitive("p2", "box", { x: 20 })], TRIANGLE_LIMIT);
    expect(plain.quality?.path).toBe("plain");
  });
});

describe("refusal messages", () => {
  it("name the group and the objects, and say Cancel is available", () => {
    expect(groupFinishProblemMessage({ kind: "openMesh", group: "Window A", objects: ["Round Roof"] })).toContain("“Round Roof” is not a closed solid");
    expect(groupFinishProblemMessage({ kind: "openMesh", group: "Window A", objects: ["A", "B"] })).toContain("are not closed solids");
    expect(groupFinishProblemMessage({ kind: "cutFailed", group: "Wall" })).toContain("Cancel");
    expect(groupFinishProblemMessage({ kind: "degraded", group: "Wall", reason: "the solids are only laid together" })).toContain("only laid together");
  });
});
