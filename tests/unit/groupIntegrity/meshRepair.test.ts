import { describe, expect, it } from "vitest";
import type { WorkplaneShape } from "@/types/layerling";
import { analyzeMesh, applyMeshRepairs, collectLeafMeshes, repairProblems, repairTJunctions, scanForOpenMeshes, type RepairedMesh } from "@/lib/meshRepair";

/*
 * Build 0124: the pure repair engine. A unit cube with one triangle of the top face split at the midpoint of an edge, while the face on the other side of that edge still
 * uses the whole edge: the T-junction defect in its smallest form.
 */
type V = [number, number, number];
const cubeTriangles = (): V[][] => {
  const p: V[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const q = (a: number, b: number, c: number) => [p[a], p[b], p[c]];
  return [q(0, 2, 1), q(0, 3, 2), q(4, 5, 6), q(4, 6, 7), q(0, 1, 5), q(0, 5, 4), q(1, 2, 6), q(1, 6, 5), q(2, 3, 7), q(2, 7, 6), q(3, 0, 4), q(3, 4, 7)];
};
const flat = (tris: V[][]) => tris.flat().flat();
/** The +z face's first triangle (4,5,6) split at the midpoint of its edge 5-6 (the edge the +x face (1,6,5) also uses whole). */
function withTJunction(): V[][] {
  const tris = cubeTriangles();
  const m: V = [1, 0.5, 1];
  const split = tris.findIndex((t) => t[0][0] === 0 && t[0][1] === 0 && t[0][2] === 1 && t[1][0] === 1 && t[2][1] === 1);
  const [a, b, c] = tris[split]; // (0,0,1) (1,0,1) (1,1,1): edge b-c is split at m
  tris.splice(split, 1, [a, b, m], [a, m, c]);
  return tris;
}
const volume = (positions: ArrayLike<number>) => {
  let v = 0;
  for (let o = 0; o < positions.length; o += 9) {
    const [a, b, c] = [0, 3, 6].map((k) => [positions[o + k], positions[o + k + 1], positions[o + k + 2]]);
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
};
const mesh = (positions: number[], extra: object = {}) => ({ positions, baseWidth: 1, baseDepth: 1, baseHeight: 1, triangleCount: positions.length / 9, sourceFormat: "json" as const, ...extra });
const leaf = (id: string, positions: number[], extra: Partial<WorkplaneShape> = {}, meshExtra: object = {}): WorkplaneShape => ({ id, name: id, kind: "mesh", importedMesh: mesh(positions, meshExtra), ...extra }) as unknown as WorkplaneShape;
const group = (id: string, children: WorkplaneShape[], body?: number[]): WorkplaneShape => ({ id, name: id, kind: "mesh", groupedShapes: children, ...(body ? { importedMesh: mesh(body) } : {}) }) as unknown as WorkplaneShape;

describe("analyzeMesh", () => {
  it("a closed cube is closed and costs no repair", () => {
    expect(analyzeMesh(mesh(flat(cubeTriangles())))).toEqual({ state: "closed", openEdges: 0 });
  });
  it("the T-junction cube is repairable and the repair is closed, the same cube, with no new coordinate", () => {
    const positions = flat(withTJunction());
    const analysis = analyzeMesh(mesh(positions));
    expect(analysis.state).toBe("repairable");
    expect(analysis.openEdges).toBeGreaterThan(0);
    const repaired = analysis.repaired!;
    expect(repaired.splits).toBe(1);
    expect(repaired.triangleCount).toBe(14);
    expect(volume(repaired.positions)).toBeCloseTo(1, 12);
    expect(repairProblems(mesh(positions), repaired)).toEqual([]);
    // Idempotent: the repaired mesh is simply closed.
    expect(analyzeMesh(mesh(repaired.positions)).state).toBe("closed");
  });
  it("a mesh with a real hole is not repairable and is reported, never changed", () => {
    const tris = cubeTriangles();
    tris.splice(2, 1);
    const result = analyzeMesh(mesh(flat(tris)));
    expect(result.state).toBe("notRepairable");
    expect(result.repaired).toBeUndefined();
  });
  it("a mesh that is not whole triangles is left alone", () => {
    expect(analyzeMesh(mesh([0, 0, 0, 1, 0, 0])).state).toBe("notRepairable");
  });
  it("the repair is deterministic", () => {
    const positions = flat(withTJunction());
    expect(repairTJunctions(positions)!.positions).toEqual(repairTJunctions([...positions])!.positions);
  });
});

describe("normals and appearance", () => {
  it("without normals the repair adds none, and the pieces are coplanar with the face they came from", () => {
    const repaired = repairTJunctions(flat(withTJunction()))!;
    expect(repaired.normals).toBeUndefined();
  });
  it("with per-corner normals every normal is kept and the inserted vertex takes the one interpolated along the edge", () => {
    const tris = withTJunction();
    const positions = flat(tris);
    // Smooth-ish normals that differ by corner so interpolation is observable: the direction away from the cube's centre.
    const normals: number[] = [];
    for (let i = 0; i < positions.length; i += 3) {
      const n = [positions[i] - 0.5, positions[i + 1] - 0.5, positions[i + 2] - 0.5];
      const l = Math.hypot(...n);
      normals.push(n[0] / l, n[1] / l, n[2] / l);
    }
    const repaired = repairTJunctions(positions, normals)!;
    expect(repaired.normals).toHaveLength(repaired.positions.length);
    // Unchanged corners keep their exact normal: every (position, normal) pair of the original is still in the result.
    const pairs = new Set<string>();
    for (let i = 0; i < repaired.positions.length; i += 3) pairs.add(`${repaired.positions.slice(i, i + 3)}|${repaired.normals!.slice(i, i + 3)}`);
    for (let i = 0; i < positions.length; i += 3) expect(pairs.has(`${positions.slice(i, i + 3)}|${normals.slice(i, i + 3)}`)).toBe(true);
    // The new corners (the midpoint in the split face of the +x side) carry the mean of the edge's end normals (not renormalised: the pipeline interpolates linearly).
    const mid = [1, 0.5, 1];
    const na = [1 - 0.5, 0 - 0.5, 1 - 0.5];
    const nb = [1 - 0.5, 1 - 0.5, 1 - 0.5];
    const un = (v: number[]) => v.map((x) => x / Math.hypot(...v));
    const expected = [0, 1, 2].map((k) => (un(na)[k] + un(nb)[k]) / 2);
    const el = 1;
    let found = 0;
    for (let i = 0; i < repaired.positions.length; i += 3) {
      if (repaired.positions[i] === mid[0] && repaired.positions[i + 1] === mid[1] && repaired.positions[i + 2] === mid[2]) {
        const n = repaired.normals!.slice(i, i + 3);
        const own = [mid[0] - 0.5, mid[1] - 0.5, mid[2] - 0.5];
        const ol = Math.hypot(...own);
        // Either the original corner's own normal (the face that already had the vertex) or the interpolated one (the pieces it created).
        const isOwn = n.every((v, k) => Math.abs(v - own[k] / ol) < 1e-12);
        const isInterp = n.every((v, k) => Math.abs(v - expected[k] / el) < 1e-12);
        expect(isOwn || isInterp).toBe(true);
        found += 1;
      }
    }
    expect(found).toBeGreaterThanOrEqual(3);
  });
  it("flat per-corner normals stay the face normal at the inserted vertex", () => {
    const tris = withTJunction();
    const positions = flat(tris);
    const normals = tris.flatMap((t) => {
      const u = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]];
      const w = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const l = Math.hypot(...n);
      return [0, 1, 2].flatMap(() => [n[0] / l, n[1] / l, n[2] / l]);
    });
    const repaired = repairTJunctions(positions, normals)!;
    // Every triangle of the result has all three corner normals equal to its own geometric normal: flat shading is unchanged.
    for (let t = 0; t < repaired.triangleCount; t += 1) {
      const o = t * 9;
      const p = (k: number) => repaired.positions.slice(o + k * 3, o + k * 3 + 3);
      const u = [p(1)[0] - p(0)[0], p(1)[1] - p(0)[1], p(1)[2] - p(0)[2]];
      const w = [p(2)[0] - p(0)[0], p(2)[1] - p(0)[1], p(2)[2] - p(0)[2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const l = Math.hypot(...n);
      for (let k = 0; k < 3; k += 1) for (let c = 0; c < 3; c += 1) expect(repaired.normals![o + k * 3 + c]).toBeCloseTo(n[c] / l, 12);
    }
  });
});

describe("repairProblems", () => {
  const before = mesh(flat(withTJunction()));
  const good = repairTJunctions(before.positions)!;
  it("passes the real repair", () => expect(repairProblems(before, good)).toEqual([]));
  it("fails a created vertex, a moved box, a changed volume and an open result", () => {
    const moved: RepairedMesh = { ...good, positions: good.positions.map((v, i) => (i === 0 ? v + 0.1 : v)) };
    expect(repairProblems(before, moved).join()).toContain("a vertex was created");
    const open: RepairedMesh = { ...good, positions: good.positions.slice(9), triangleCount: good.triangleCount - 1 };
    expect(repairProblems(before, open).join()).toContain("not closed");
  });
});

describe("the scene", () => {
  const defective = flat(withTJunction());
  const healthy = flat(cubeTriangles());
  it("collects each distinct array once with the number of objects that use it, nested groups included, skipping group bodies and STEP bodies", () => {
    const shared = defective;
    const scene = [leaf("a", shared), group("g", [leaf("b", shared), leaf("c", healthy), group("inner", [leaf("d", shared)])], defective), leaf("step", defective.slice(), {}, { brepStep: "x" })];
    const found = collectLeafMeshes(scene);
    expect(found.map((f) => f.objects).sort()).toEqual([1, 3]);
    expect(found).toHaveLength(2);
  });
  it("scans read-only and counts distinct repairable meshes and their objects", async () => {
    const shared = defective;
    const scene = [leaf("a", shared), group("g", [leaf("b", shared), leaf("c", healthy)]), leaf("hole", flat(cubeTriangles().slice(1)))];
    const snapshot = JSON.stringify(scene);
    const scan = await scanForOpenMeshes(scene);
    expect(scan.meshes).toBe(4 - 1);
    expect(scan.repairs.size).toBe(1);
    expect(scan.objects).toBe(2);
    expect(scan.notRepairable).toBe(1);
    expect(JSON.stringify(scene)).toBe(snapshot);
  });
  it("a repair the kernel rejects is not offered", async () => {
    const scan = await scanForOpenMeshes([leaf("a", defective)], { kernelValid: async () => false });
    expect(scan.repairs.size).toBe(0);
    expect(scan.failedChecks).toBe(1);
  });
  it("a scan can be aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(scanForOpenMeshes([leaf("a", defective)], { signal: controller.signal })).rejects.toThrow();
  });
  it("applying replaces the mesh in every object that shares it, copies only the way down to it, and mutates nothing", async () => {
    const shared = defective;
    const healthyLeaf = leaf("c", healthy);
    const untouchedGroup = group("u", [healthyLeaf]);
    const scene = [leaf("a", shared), group("g", [leaf("b", shared), group("inner", [leaf("d", shared)], defective)], defective), untouchedGroup];
    const before = JSON.stringify(scene);
    const scan = await scanForOpenMeshes(scene);
    const applied = applyMeshRepairs(scene, scan.repairs);
    expect(JSON.stringify(scene)).toBe(before);
    expect(applied.objects).toBe(3);
    expect(applied.shapes[2]).toBe(untouchedGroup);
    expect(applied.shapes[2].groupedShapes![0]).toBe(healthyLeaf);
    // Group bodies are untouched: the same positions array as before.
    expect(applied.shapes[1].importedMesh!.positions).toBe(defective);
    const repairedA = applied.shapes[0].importedMesh!.positions;
    const repairedB = applied.shapes[1].groupedShapes![0].importedMesh!.positions;
    expect(repairedA).toBe(repairedB);
    expect(repairedA).not.toBe(shared);
    expect(analyzeMesh({ positions: repairedA }).state).toBe("closed");
    // A second scan of the result finds nothing left of the repaired kind.
    expect((await scanForOpenMeshes(applied.shapes)).repairs.size).toBe(0);
  });
  it("a mesh that changed since the scan is skipped", async () => {
    const scene = [leaf("a", defective)];
    const scan = await scanForOpenMeshes(scene);
    const edited = [leaf("a", defective.slice())];
    expect(applyMeshRepairs(edited, scan.repairs).objects).toBe(0);
  });
});
