import { beforeAll, describe, expect, it, vi } from "vitest";
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
import * as THREE from "three";
import { buildGroupedShapeFromSelection } from "@/lib/editorBooleans";
import { groupedPartSizeScale } from "@/lib/groupScale";
import { planPoseRebuild, POSE_DISPLACEMENT_TOLERANCE, POSE_SHEAR_COSINE, unposePart } from "@/lib/groupPose";
import type { WorkplaneShape } from "@/types/layerling";
import { quaternionForShape } from "@/lib/editorBooleans";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import { assertKernelLive, primitive, startKernel, TRIANGLE_LIMIT } from "./support";
import { openParts, posedFrom } from "./poseLab";

beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });

/*
 * Build 0127 (revision 2): TWO INDEPENDENT SAFEGUARDS (Bill, 2026-11-27).
 *   1. GEOMETRIC REPRESENTABILITY: the approved analytic shear threshold, |cos| <= 1e-6 between the part's stretched axes.
 *   2. ROTATION STORAGE PRECISION: the approved relative world-space displacement threshold, 3e-4 of the part's reach.
 * The displacement tolerance must not substitute for, or override, the shear check. In revision 1 it did: the first delivered build measured skew as a corner displacement against the 3e-4 tolerance and so
 * passed genuinely sheared parts (largest 19.4 degrees in a 400,000-case sample, gated test poseSkewBound). These tests show that what the looser rule admitted is now refused, in the extreme-stretch
 * regime it lived in, and that representable geometry and ordinary rotation quantization are still accepted.
 */
const AX = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
/** What revision 1's skew rule measured, kept here ONLY to document what it admitted: corner displacement between the exactly stretched part and the engine's box, as a share of the stretched reach. */
function looseRuleShare(S: [number, number, number], q: THREE.Quaternion, dims: [number, number, number]) {
  const axes = AX.map((a) => a.clone().applyQuaternion(q).toArray() as [number, number, number]) as [[number, number, number], [number, number, number], [number, number, number]];
  const ps = groupedPartSizeScale(axes, S);
  const half = dims.map((d) => d / 2);
  let dist = 0, reach = 0;
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) {
    const corner = new THREE.Vector3(a * half[0], b * half[1], c * half[2]);
    const truth = corner.clone().applyQuaternion(q).multiply(new THREE.Vector3(...S));
    dist = Math.max(dist, truth.distanceTo(corner.clone().multiply(new THREE.Vector3(ps.width, ps.height, ps.depth)).applyQuaternion(q))); reach = Math.max(reach, truth.length());
  }
  return dist / reach;
}
/** The rotation as the engine STORES it: three Euler angles, each rounded to 0.01 degrees and snapped to 0 when within about 0.505 degrees of a multiple of 360. The rebuilt body contains THIS rotation. */
const storedQuat = (q: THREE.Quaternion) => { const e = new THREE.Euler().setFromQuaternion(q, "XYZ"); const d = THREE.MathUtils.radToDeg; return quaternionForShape(canonicalizeShape({ ...primitive("p", "box"), rotationX: d(e.x), rotation: d(e.y), rotationZ: d(e.z) } as WorkplaneShape)); };
const shearCosOf = (S: [number, number, number], q: THREE.Quaternion) => { const v = AX.map((a) => { const r = a.clone().applyQuaternion(q); return new THREE.Vector3(r.x * S[0], r.y * S[1], r.z * S[2]).normalize(); }); return Math.max(Math.abs(v[0].dot(v[1])), Math.abs(v[0].dot(v[2])), Math.abs(v[1].dot(v[2]))); };

describe("the analytic shear threshold is back, independent of the displacement tolerance", () => {
  let base: WorkplaneShape;
  const dims: [number, number, number] = [4, 6, 24];
  beforeAll(async () => {
    const built = await buildGroupedShapeFromSelection([primitive("A", "box", { x: 0, width: 20, depth: 10, height: 30 }), primitive("B", "box", { x: 30, width: dims[0], depth: dims[2], height: dims[1] })], TRIANGLE_LIMIT);
    base = built.group!;
  });
  const group = (S: [number, number, number]) => posedFrom(base, { stretch: S });
  const turnB = (G: WorkplaneShape, rx: number, ry: number, rz: number) => { const opened = openParts(G); return { opened, parts: opened.map((p) => (p.name === "B" || p.id === opened[1].id ? { ...p, x: p.x + 1, rotationX: rx, rotation: ry, rotationZ: rz } : p)) }; };
  const quat = (rx: number, ry: number, rz: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(rx), THREE.MathUtils.degToRad(ry), THREE.MathUtils.degToRad(rz), "XYZ"));
  const plan = (G: WorkplaneShape, rx: number, ry: number, rz: number) => { const { opened, parts } = turnB(G, rx, ry, rz); return planPoseRebuild(G, parts, opened); };

  it("EXTREME REGIME: parts within about 0.01 degrees of a quarter turn in groups stretched by hundreds-to-one ratios, which the looser rule ADMITTED, are refused as skewed", () => {
    let seed = 20261127;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
    const logUniform = (lo: number, hi: number) => Math.exp(Math.log(lo) + rnd() * (Math.log(hi) - Math.log(lo)));
    let admittedByLooseRule = 0, largestShearDeg = 0;
    for (let i = 0; i < 20000 && admittedByLooseRule < 40; i += 1) {
      const S: [number, number, number] = [logUniform(0.05, 40), logUniform(0.05, 40), logUniform(0.05, 40)];
      // the offset must sit on a component at 90, 180 or 270: the engine's storage snaps a component near 0 to exactly 0 (the stored part is then aligned, which the displacement check covers)
      const q4 = [1 + Math.floor(rnd() * 3), 1 + Math.floor(rnd() * 3), 1 + Math.floor(rnd() * 3)].map((k) => k * 90);
      const k = 1 + Math.floor(rnd() * 2);                                                   // 0.01 or 0.02 degrees: the size of the engine's own angle storage, and exactly representable at that precision
      const offset = (rnd() < 0.5 ? 1 : -1) * k * 0.01;
      const which = Math.floor(rnd() * 3);
      const e = q4.map((v, j) => (j === which ? v + offset : v)) as [number, number, number];
      const q = quat(...e);
      const share = looseRuleShare(S, q, dims), cos = shearCosOf(S, storedQuat(q));   // the shear of the part AS STORED
      if (!(share <= POSE_DISPLACEMENT_TOLERANCE && cos > POSE_SHEAR_COSINE)) continue;   // only cases the looser rule passed although the geometry shears
      admittedByLooseRule += 1;
      const G = group(S);
      const result = plan(G, ...e);
      expect(result.kind, `S ${S.map((v) => v.toFixed(2))} turn ${e.map((v) => v.toFixed(2))}: loose share ${share.toExponential(1)}, cos ${cos.toExponential(1)}`).toBe("refuse");
      expect(result.kind === "refuse" && result.message).toContain("turned at an angle inside a group that has been resized unevenly");
      largestShearDeg = Math.max(largestShearDeg, THREE.MathUtils.radToDeg(Math.asin(Math.min(1, cos))));
    }
    expect(admittedByLooseRule, "the regime must actually occur in the search (the test is not vacuous)").toBeGreaterThanOrEqual(10);
    console.info(`[shear rule] ${admittedByLooseRule} cases the looser rule admitted are now refused; the largest shear among them ${largestShearDeg.toFixed(2)} deg`);
  });
  it("REPRESENTABLE geometry is accepted under the same extreme stretches: exact quarter turns about any axis, and any turn about a stretched axis alone", () => {
    for (const S of [[38.88, 0.54, 0.1], [39.7, 1, 1], [0.05, 40, 7]] as [number, number, number][]) {
      const G = group(S);
      for (const turn of [[0, 0, 0], [90, 0, 0], [0, 90, 0], [0, 0, 90], [180, 0, 0], [0, 180, 180], [270, 90, 0], [90, 90, 90]] as [number, number, number][]) {
        expect(shearCosOf(S, quat(...turn)), `S ${S} turn ${turn}`).toBeLessThanOrEqual(POSE_SHEAR_COSINE);
        const result = plan(G, ...turn);
        expect(result.kind, `S ${S} turn ${turn}: ${result.kind === "refuse" ? result.message : ""}`).toBe("preserve");
      }
    }
    // a turn about the stretched axis only keeps the stretched axes perpendicular (cos 0): accepted when its storage is accurate
    const G = group([39.7, 1, 1]);
    expect(plan(G, 30, 0, 0).kind).toBe("preserve");
    expect(plan(G, 12.35, 0, 0).kind).toBe("preserve");
  });
  it("ORDINARY ROTATION QUANTIZATION is accepted: arbitrary turns in a uniformly resized group, stored at the engine's 0.01 degree precision", () => {
    for (const S of [[1.5, 1.5, 1.5], [2, 2, 2]] as [number, number, number][]) {
      const G = group(S);
      for (const turn of [[12.345678, 0, 0], [0, 33.3333, 0], [20.1234, 35.5678, 50.9876]] as [number, number, number][]) {
        const result = plan(G, ...turn);
        expect(result.kind, `S ${S} turn ${turn}: ${result.kind === "refuse" ? result.message : ""}`).toBe("preserve");
      }
    }
    const { opened, parts } = turnB(group([1.5, 1.5, 1.5]), 0, 12.345678, 0);
    const un = unposePart(group([1.5, 1.5, 1.5]), parts[1]);
    expect(un.shearCos).toBeLessThanOrEqual(POSE_SHEAR_COSINE);
    expect(un.displacementShare).toBeLessThanOrEqual(POSE_DISPLACEMENT_TOLERANCE);
    expect(un.part.rotation).toBeCloseTo(12.35, 2);     // stored at 0.01 degrees
    void opened;
  });
  it("the two safeguards are INDEPENDENT: each refuses what the other would pass, with its own message", () => {
    // displacement refuses, shear passes: a small turn in a ROTATED group that is not resized (no stretch, so no shear at all)
    const rotated = posedFrom(base, { rotation: 33 });
    const opened = openParts(rotated);
    const small = planPoseRebuild(rotated, opened.map((p, i) => (i === 1 ? { ...p, x: p.x + 1, rotation: (p.rotation ?? 0) + 0.2 } : p)), opened);   // 0.2 degrees relative: snapped to 0 by the engine's storage
    expect(small.kind).toBe("refuse");
    expect(small.kind === "refuse" && small.message).toContain("cannot be preserved accurately");
    expect(small.kind === "refuse" && small.message).not.toContain("turned at an angle");
    // shear refuses, displacement alone would pass (the extreme regime above, and here a plain 3 degree turn in a group resized unevenly)
    const uneven = plan(group([2, 1, 1]), 0, 3, 0);
    expect(uneven.kind === "refuse" && uneven.message).toContain("turned at an angle inside a group that has been resized unevenly");
    // a part that fails BOTH reports the shear: representability is decided first and is never relaxed by the displacement test
    const both = plan(group([2, 1, 1]), 0.3, 3, 0);          // 3 degrees shears; the 0.3 degree component would be snapped to 0 as well
    expect(both.kind === "refuse" && both.message).toContain("turned at an angle inside a group that has been resized unevenly");
    expect(both.kind === "refuse" && both.message).not.toContain("cannot be preserved accurately");
  });
  it("a stored rotation that the engine snaps to exactly aligned has no shear in the rebuilt group: the displacement check alone decides (a 0.01 degree offset on a component near 0)", () => {
    const G = group([38.88, 0.54, 0.1]);
    const result = plan(G, 0.01, 0, 0);                        // snapped to 0 on storage: aligned; displacement 1.7e-4 of reach, within the storage tolerance
    expect(result.kind).toBe("preserve");
  });
});
