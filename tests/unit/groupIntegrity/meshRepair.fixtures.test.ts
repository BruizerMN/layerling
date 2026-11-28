import { beforeAll, describe, expect, it, vi } from "vitest";
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
import * as THREE from "three";
import { exportLylProject, importLylProject } from "@/lib/lylProject";
import { editorHistoryEntry } from "@/lib/editorHistory";
import { restoreGroupedChildren } from "@/lib/editorBooleans";
import { DEFAULT_SNAP_GRID, DEFAULT_WORKPLANE_WORKSPACE } from "@/lib/workplaneSettings";
import { analyzeMesh, applyMeshRepairs, collectLeafMeshes, repairProblems, scanForOpenMeshes } from "@/lib/meshRepair";
import { createKernelMeshCheck } from "@/lib/meshRepairKernel";
import { buildImportedMeshGeometry } from "@/lib/importedMeshDisplay";
import { rebuildGroupFromParts } from "@/lib/groupReconstruction";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, fixturePath, loadFixture, startKernel } from "./support";

/*
 * Build 0124 on the real documents (LAYERLING_INTEGRITY_FIXTURES, not in the repository): the repair is geometry- and appearance-preserving, touches nothing but the repaired
 * leaf meshes, leaves the document scannable as clean, survives save and reopen, and the known SAUD refusal succeeds after it. `saud` is the 285-mesh Round Roof census;
 * `foshay` has 4 meshes whose T-junction vertices are not exactly on the edge: they are left unchanged by the exactness checks and reported.
 */
beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });
const base = (shapes: WorkplaneShape[]) => ({ projectId: "p", projectName: "t", createdAt: 1, modifiedAt: 2, shapes, history: [editorHistoryEntry(shapes, [])], historyIndex: 0, assets: [], workspace: DEFAULT_WORKPLANE_WORKSPACE, snapGrid: DEFAULT_SNAP_GRID, placementElevation: 0 });
/** Structural comparison of two scenes ignoring the leaf mesh arrays: returns the number of differences (no giant strings). */
function sceneDiff(a: WorkplaneShape, b: WorkplaneShape): number {
  let d = 0; const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (k === "groupedShapes") continue;
    if (k === "importedMesh") { const x = (a as never)[k] as Record<string, unknown> | undefined, y = (b as never)[k] as Record<string, unknown> | undefined; if (a.groupedShapes?.length) { if (x !== y) d++; continue; } if (Boolean(x) !== Boolean(y)) { d++; continue; } if (x && y) for (const f of new Set([...Object.keys(x), ...Object.keys(y)])) { if (f === "positions" || f === "normals" || f === "triangleCount") continue; if (JSON.stringify(x[f]) !== JSON.stringify(y[f])) d++; } continue; }
    if (JSON.stringify((a as never)[k]) !== JSON.stringify((b as never)[k])) d++;
  }
  const ca = a.groupedShapes ?? [], cb = b.groupedShapes ?? []; if (ca.length !== cb.length) return d + 1;
  ca.forEach((c, i) => { d += sceneDiff(c, cb[i]); });
  return d;
}
const bodies = (s: WorkplaneShape): unknown[] => [...(s.groupedShapes?.length ? [s.importedMesh] : []), ...(s.groupedShapes ?? []).flatMap(bodies)];
/** Area-weighted histogram of the display normals the renderer would use for a mesh (what the eye sees), quantised. */
function shading(mesh: NonNullable<WorkplaneShape["importedMesh"]>) {
  const g = buildImportedMeshGeometry(mesh as never);
  const pos = g.getAttribute("position") as THREE.BufferAttribute; const nor = g.getAttribute("normal") as THREE.BufferAttribute;
  const hist = new Map<string, number>(); let worst = 0;
  for (let t = 0; t < pos.count / 3; t++) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, t * 3), b = new THREE.Vector3().fromBufferAttribute(pos, t * 3 + 1), c = new THREE.Vector3().fromBufferAttribute(pos, t * 3 + 2);
    const cross = b.clone().sub(a).cross(c.clone().sub(a)); const area = cross.length() / 2; if (area === 0) continue; const geo = cross.normalize();
    const n = new THREE.Vector3().fromBufferAttribute(nor, t * 3);
    worst = Math.max(worst, Math.acos(Math.min(1, Math.abs(n.dot(geo)))));
    const key = `${n.x.toFixed(3)},${n.y.toFixed(3)},${n.z.toFixed(3)}`; hist.set(key, (hist.get(key) ?? 0) + area);
  }
  return { hist, worst };
}
/** The shading normal the pipeline interpolates over a mesh with its own normals, sampled at barycentric points of the ORIGINAL faces, against the repaired mesh at the same surface points. */
function smoothDeviation(m: NonNullable<WorkplaneShape["importedMesh"]>, r: { positions: number[]; normals?: number[] }) {
  const P = (arr: number[], t: number, k: number) => new THREE.Vector3(arr[t * 9 + k * 3], arr[t * 9 + k * 3 + 1], arr[t * 9 + k * 3 + 2]);
  const shadingAt = (pos: number[], nor: number[], point: THREE.Vector3, hint?: number): THREE.Vector3 | null => {
    const count = pos.length / 9;
    for (let t = 0; t < count; t++) {
      const a = P(pos, t, 0), b = P(pos, t, 1), c = P(pos, t, 2); const nrm = b.clone().sub(a).cross(c.clone().sub(a)); const area2 = nrm.length(); if (area2 < 1e-14) continue;
      const toP = point.clone().sub(a); if (Math.abs(toP.dot(nrm.clone().normalize())) > 1e-9) continue;
      const l1 = b.clone().sub(a).cross(toP).dot(nrm) / (area2 * area2) * -1 + 0; // placeholder replaced below
      const wB = toP.clone().cross(c.clone().sub(a)).dot(nrm) / (area2 * area2), wC = b.clone().sub(a).cross(toP).dot(nrm) / (area2 * area2), wA = 1 - wB - wC;
      void l1; if (wA < -1e-9 || wB < -1e-9 || wC < -1e-9) continue;
      const n = (k: number) => new THREE.Vector3(nor[t * 9 + k * 3], nor[t * 9 + k * 3 + 1], nor[t * 9 + k * 3 + 2]);
      return n(0).multiplyScalar(wA).add(n(1).multiplyScalar(wB)).add(n(2).multiplyScalar(wC)).normalize();
    }
    return null;
  };
  let worst = 0; const count = m.positions.length / 9;
  for (let t = 0; t < count; t++) {
    const a = P(m.positions, t, 0), b = P(m.positions, t, 1), c = P(m.positions, t, 2);
    for (let s = 0; s < 200; s++) {
      let u = Math.random(), v = Math.random(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const point = a.clone().multiplyScalar(1 - u - v).add(b.clone().multiplyScalar(u)).add(c.clone().multiplyScalar(v));
      const before = shadingAt(m.positions, m.normals!, point); const after = shadingAt(r.positions, r.normals!, point);
      if (!before || !after) { worst = Math.max(worst, 1); continue; }
      worst = Math.max(worst, Math.acos(Math.min(1, before.dot(after))));
    }
  }
  return worst;
}
const EXPECTED: Record<string, { repairable: number; objects: number; leftUnchanged: number }> = { saud: { repairable: 285, objects: 749, leftUnchanged: 0 }, foshay: { repairable: 57, objects: 57, leftUnchanged: 4 }, depot: { repairable: 1, objects: 1, leftUnchanged: 0 } };
for (const name of ["saud", "foshay", "depot"]) {
  const file = fixturePath(`${name === "depot" ? "dwc" : name}.lyl`);
  it.skipIf(!file)(`0124 verification on ${name}`, async () => {
    const project = await loadFixture(file!);
    const shapes = project.shapes;
    const kernelValid = await createKernelMeshCheck();
    const t0 = performance.now();
    const scan = await scanForOpenMeshes(shapes, { kernelValid });
    const scanMs = performance.now() - t0;
    expect({ repairable: scan.repairs.size, objects: scan.objects, leftUnchanged: scan.notRepairable + scan.failedChecks }).toEqual(EXPECTED[name]);
    console.log(`R24 ${name}: distinct meshes ${scan.meshes}, repairable ${scan.repairs.size} (objects ${scan.objects}), not repairable ${scan.notRepairable}, failed checks ${scan.failedChecks}, scan ${scanMs.toFixed(0)} ms (kernel check included)`);
        const snapshots = new Map<number[], string>(); scan.repairs.forEach((_r, positions) => snapshots.set(positions, JSON.stringify(positions)));
    const applied = applyMeshRepairs(shapes, scan.repairs);
    // 1. identity, hierarchy, transforms, dimensions, appearance fields: everything but the repaired leaf meshes is identical
    expect(shapes.reduce((n, sh, i) => n + sceneDiff(sh, applied.shapes[i]), 0)).toBe(0); expect(applied.shapes.length).toBe(shapes.length);
    // why checks failed, if any
    for (const { mesh } of collectLeafMeshes(shapes)) { const an = analyzeMesh(mesh); if (an.state === "repairable" && !scan.repairs.has(mesh.positions)) { const { repairProblems } = await import("@/lib/meshRepair"); console.log(`R24 ${name}: check failed: problems=${JSON.stringify(repairProblems(mesh, an.repaired!))} kernel=${await kernelValid(an.repaired!.positions)} hasNormals=${Boolean(mesh.normals)} tris=${mesh.triangleCount}`); } }
    // 2. baked group bodies: the very same objects
    expect(applied.shapes.flatMap(bodies).every((b, i) => b === shapes.flatMap(bodies)[i])).toBe(true);
    // 3. healthy meshes untouched: same array object; shared meshes not mutated in place: the old arrays are exactly what they were
    const leavesBefore = collectLeafMeshes(shapes); const leavesAfter = collectLeafMeshes(applied.shapes);
    let healthySame = 0, healthyTotal = 0;
    for (const { mesh } of leavesBefore) if (!scan.repairs.has(mesh.positions)) { healthyTotal++; if (leavesAfter.some((l) => l.mesh.positions === mesh.positions)) healthySame++; }
    expect(healthySame).toBe(healthyTotal);
    snapshots.forEach((json, positions) => expect(JSON.stringify(positions)).toBe(json));
    // 4. every repaired mesh is closed and kernel-valid; a new scan finds nothing left of the repaired kind
    const rescan = await scanForOpenMeshes(applied.shapes, { kernelValid });
    console.log(`R24 ${name}: after repair, repairable ${rescan.repairs.size}, not repairable ${rescan.notRepairable} (was ${scan.notRepairable})`);
    expect(rescan.repairs.size).toBe(0);
    for (const r of scan.repairs.values()) expect(await kernelValid(r.positions)).toBe(true);
    let maxOff = 0; scan.repairs.forEach((r) => { maxOff = Math.max(maxOff, r.maxOffEdge); });
    console.log(`R24 ${name}: largest vertex-to-edge distance used ${maxOff.toExponential(2)}`);
    // 5. appearance: the renderer's own shading of every repaired mesh, area-weighted, before and after
    let worstHist = 0, worstAngle = 0, n = 0, worstSmooth = 0;
    scan.repairs.forEach((r, positions) => {
      const m = leavesBefore.find((l) => l.mesh.positions === positions)!.mesh;
      if (m.normals) { n++; worstSmooth = Math.max(worstSmooth, smoothDeviation(m, r)); return; }
      const a = shading(m); const b = shading({ ...m, positions: r.positions, ...(r.normals ? { normals: r.normals } : {}) });
      const keys = new Set([...a.hist.keys(), ...b.hist.keys()]); let total = 0, diff = 0;
      keys.forEach((k) => { const x = a.hist.get(k) ?? 0, y = b.hist.get(k) ?? 0; total += x; diff += Math.abs(x - y); });
      worstHist = Math.max(worstHist, total ? diff / total : 0); worstAngle = Math.max(worstAngle, b.worst); n++;
    });
    console.log(`R24 ${name}: shading of ${n} repaired meshes: area-weighted normal histogram difference max ${worstHist.toExponential(2)}, largest angle between a display normal and its triangle ${worstAngle.toExponential(2)} rad`);
    console.log(`R24 ${name}: meshes with their own (smooth) normals: largest shading-normal deviation over 200 samples per face ${worstSmooth.toExponential(2)} rad`);
    expect(worstHist).toBeLessThan(1e-6); expect(worstSmooth).toBeLessThan(1e-6);
    // 6. save and reopen keep the repair
    const reopened = await importLylProject(await exportLylProject(base(applied.shapes) as never));
    const rescan2 = await scanForOpenMeshes(reopened.shapes, { kernelValid });
    const closedAfterReopen = collectLeafMeshes(reopened.shapes).filter((l) => analyzeMesh(l.mesh).state === "closed").length;
    console.log(`R24 ${name}: reopened file: repairable ${rescan2.repairs.size}, closed meshes ${closedAfterReopen} of ${collectLeafMeshes(reopened.shapes).length} (before repair: ${leavesBefore.filter((l) => analyzeMesh(l.mesh).state === "closed").length})`);
    expect(rescan2.repairs.size).toBe(0);
  }, 3_600_000);
}
it.skipIf(!fixturePath("saud.lyl"))("0124 SAUD: the known refusal succeeds after repair (mixed Round Roof pair, 43rd top-level, path 0.0.0.0, with an edit)", async () => {
  const project = await loadFixture(fixturePath("saud.lyl")!);
  const kernelValid = await createKernelMeshCheck();
  const scan = await scanForOpenMeshes(project.shapes, { kernelValid });
  const repaired = applyMeshRepairs(project.shapes, scan.repairs).shapes;
  const find = (shapes: WorkplaneShape[]) => { let cur = shapes[42]; for (const i of [0, 0, 0, 0]) cur = cur.groupedShapes![i]; return cur; };
  for (const [label, shapes] of [["before repair", project.shapes], ["after repair", repaired]] as const) {
    const g = find(shapes); const parts = restoreGroupedChildren(g).map((p) => canonicalizeShape({ ...p, locked: false }));
    for (const [edit, idx, f] of [["unchanged", -1, 1], ["solid Round Roof depth x1.2", 0, 1.2]] as const) {
      const edited = parts.map((p, i) => (i === idx ? { ...p, depth: p.depth * f } : p));
      const r = await rebuildGroupFromParts(g, edited, { triangleLimit: 250000, strict: true });
      // Strict reconstruction is unchanged: the same group is refused before the repair and rebuilt by the kernel after it.
      expect(Boolean(r.group), `${label} / ${edit}`).toBe(label === "after repair");
      if (r.group) expect((r as { quality?: { path?: string } }).quality?.path).toBe("kernel-cut");
    }
  }
}, 3_600_000);
