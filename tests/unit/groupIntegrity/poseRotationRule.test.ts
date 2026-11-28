import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { quaternionForShape } from "@/lib/editorBooleans";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/layerling";
import { primitive } from "./support";

/*
 * NOTE (measured): the engine stores a rotation as three Euler angles in degrees, EACH rounded to 0.01 degrees and EACH set to 0 when it lies within 0.5 degrees of a multiple of 360 (`cleanRotationDegrees` via
 * `canonicalizeShape`). A rotation with a large total angle but one small Euler component is therefore distorted too; the displacement check below measures the real effect whatever its cause.
 *
 * Build 0127: the rule that decides whether a changed part's un-posed rotation may be stored (decision Q-A/Q-B, Bill 2026-11-27). The engine stores rotations in degrees rounded to 0.01 degrees and treats angles
 * below 0.5 degrees as 0 (`cleanRotationDegrees`, applied by `canonicalizeShape`). Two different things are measured and kept apart:
 *   - ANGULAR QUANTIZATION: the angle between the exact rotation and the rotation the engine would store;
 *   - GEOMETRIC DISPLACEMENT: how far that moves the part, i.e. the largest distance any corner of the part's box travels, relative to the part's reach (half its diagonal) and in millimetres.
 * The rule (the check a reconstruction applies to every changed or new part): REFUSE when the displacement exceeds ROTATION_STORAGE_TOLERANCE of the part's reach; otherwise store the rotation the engine stores.
 * Floating-point residue (a relative angle of 1e-9 degrees that should be 0) displaces nothing and is never refused.
 */
export const ROTATION_STORAGE_TOLERANCE = 3e-4;   // of the part's reach: three rounding errors of at most 0.005 degrees (one per Euler component) compose to at most 0.015 degrees = 2.62e-4 rad

export function rotationStorageCheck(exact: THREE.Quaternion, size: readonly [number, number, number]) {
  const euler = new THREE.Euler().setFromQuaternion(exact, "XYZ");
  const deg = (r: number) => THREE.MathUtils.radToDeg(r);
  const stored = canonicalizeShape({ ...primitive("p", "box"), rotationX: deg(euler.x), rotation: deg(euler.y), rotationZ: deg(euler.z) } as WorkplaneShape);
  const storedQ = quaternionForShape(stored);
  const angularQuantizationDeg = THREE.MathUtils.radToDeg(exact.angleTo(storedQ));
  const half = [size[0] / 2, size[1] / 2, size[2] / 2];
  let displacement = 0;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const corner = new THREE.Vector3(sx * half[0], sy * half[1], sz * half[2]);
    displacement = Math.max(displacement, corner.clone().applyQuaternion(exact).distanceTo(corner.clone().applyQuaternion(storedQ)));
  }
  const reach = Math.hypot(...half);
  return { angularQuantizationDeg, displacementMm: displacement, reachMm: reach, ratio: displacement / reach, refuse: displacement / reach > ROTATION_STORAGE_TOLERANCE };
}

describe("rotation storage rule (angular quantization versus geometric displacement)", () => {
  let seed = 20261127;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  const randomRotation = (angleDeg: number) => { const axis = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(); return new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(angleDeg)); };
  const size = () => [1 + rnd() * 499, 1 + rnd() * 499, 1 + rnd() * 499] as const;

  it("the stored rotation reproduces the exact one when nothing is rounded (the check measures the right thing)", () => {
    const q = randomRotation(33.3);
    const euler = new THREE.Euler().setFromQuaternion(q, "XYZ");
    const raw = { ...primitive("p", "box"), rotationX: THREE.MathUtils.radToDeg(euler.x), rotation: THREE.MathUtils.radToDeg(euler.y), rotationZ: THREE.MathUtils.radToDeg(euler.z) } as WorkplaneShape;
    expect(quaternionForShape(raw).angleTo(q)).toBeLessThan(1e-12);
  });
  it("20,000 random rotations and sizes: pure rounding never exceeds the tolerance; a snapped Euler component (a small one beside large ones too) does; residue never does", () => {
    const comps = (q: THREE.Quaternion) => { const e = new THREE.Euler().setFromQuaternion(q, "XYZ"); return [e.x, e.y, e.z].map((r) => { const d = ((THREE.MathUtils.radToDeg(r) % 360) + 360) % 360; return Math.min(d, 360 - d); }); };
    let pureWorst = 0, pureQuantWorst = 0, residueWorst = 0, snapRefused = 0, snapPassed = 0, smallestRefusedComp = Infinity, largestPassedComp = 0, largestMm = 0, largeAngleSnapped = 0, n = 0, pure = 0;
    for (let i = 0; i < 20_000; i += 1) {
      const q = randomRotation(Math.pow(10, -9 + rnd() * (Math.log10(180) + 9)));          // log-uniform total angle 1e-9 .. 180 degrees
      const r = rotationStorageCheck(q, size());
      const c = comps(q);
      const smallest = Math.min(...c.filter((x) => x > 1e-6), Infinity);                   // the smallest component that is not residue
      n += 1;
      // a component of -0.503 degrees is 359.497, which toFixed(2) turns into 359.50 and the engine then snaps: the snap zone reaches about 0.505 degrees, hence the 0.51 class boundary
      if (c.every((x) => x <= 1e-6)) residueWorst = Math.max(residueWorst, r.ratio);
      else if (smallest >= 0.51) { pure += 1; pureWorst = Math.max(pureWorst, r.ratio); pureQuantWorst = Math.max(pureQuantWorst, r.angularQuantizationDeg); }
      else if (r.refuse) { snapRefused += 1; smallestRefusedComp = Math.min(smallestRefusedComp, smallest); largestMm = Math.max(largestMm, r.displacementMm); if (Math.max(...c) >= 0.5) largeAngleSnapped += 1; }
      else { snapPassed += 1; largestPassedComp = Math.max(largestPassedComp, smallest); }
    }
    console.info(`[rotation rule] ${n} samples. PURE ROUNDING (every non-residue Euler component >= 0.51 deg): ${pure} samples, worst angular quantization ${pureQuantWorst.toFixed(5)} deg, worst displacement ${pureWorst.toExponential(2)} of reach (tolerance ${ROTATION_STORAGE_TOLERANCE}). RESIDUE (all components <= 1e-6 deg): worst ${residueWorst.toExponential(2)}. SNAPPED (a component between 1e-6 and 0.51 deg): ${snapRefused} refused (${largeAngleSnapped} of them have a total angle of 0.5 deg or more, i.e. a large rotation with one small Euler component; largest displacement ${largestMm.toFixed(1)} mm), ${snapPassed} passed (largest component passed ${largestPassedComp.toFixed(4)} deg)`);
    expect(pureWorst).toBeLessThanOrEqual(ROTATION_STORAGE_TOLERANCE);
    expect(residueWorst).toBeLessThan(1e-6);
    expect(snapRefused).toBeGreaterThan(0);
    expect(largeAngleSnapped).toBeGreaterThan(0);                                          // snapping is not limited to small total angles
    expect(largestPassedComp).toBeLessThan(0.51);                                          // passes happen when the other components compensate or the part is tiny; the displacement, not the component, decides
  });
  it("the measured cases of the verification report: 0.2 and 0.4 degrees on a 50 mm part are refused, 0.6 degrees and quarter turns are not", () => {
    const part = [50, 10, 12] as const;
    const at = (deg: number) => rotationStorageCheck(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deg)), part);
    expect(at(0.2).refuse).toBe(true);
    expect(at(0.4).refuse).toBe(true);
    expect(at(0.6).refuse).toBe(false);
    expect(at(90).refuse).toBe(false);
    expect(at(0).refuse).toBe(false);
    expect(at(0.2).displacementMm).toBeGreaterThan(0.05);
    console.info(`[rotation rule] 50 x 10 x 12 mm part: 0.2 deg -> quantization ${at(0.2).angularQuantizationDeg.toFixed(3)} deg, displacement ${at(0.2).displacementMm.toFixed(3)} mm (refuse); 0.4 deg -> ${at(0.4).displacementMm.toFixed(3)} mm (refuse); 0.6 deg -> ${at(0.6).displacementMm.toExponential(1)} mm; 12.345678 deg -> quantization ${at(12.345678).angularQuantizationDeg.toFixed(4)} deg, displacement ${at(12.345678).displacementMm.toFixed(4)} mm (accepted)`);
  });
});
