import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { POSE_DISPLACEMENT_TOLERANCE, POSE_SHEAR_COSINE } from "@/lib/groupPose";
import { groupedPartSizeScale } from "@/lib/groupScale";

/*
 * RETAINED AS PERMANENT COVERAGE (Bill, 2026-11-27). This measures the LOOSER skew rule of Build 0127 revision 1 (corner displacement against the 3e-4 tolerance), which has been REPLACED in revision 2 by the
 * approved analytic threshold (|cos| <= 1e-6) as an independent safeguard; see poseShearRule.test.ts for the production regression tests. It documents why the displacement tolerance must not substitute for the shear check.
 *
 * Build 0127: WHAT THE REVISION-1 SKEW CHECK PERMITTED, measured against the analytic condition approved in the verification phase (the stretched axes of the part stay perpendicular: |cos| <= 1e-6).
 * Pure geometry, no kernel: for a group stretched by S and a part turned by Rc inside it (local box w x h x d),
 *   truth = S Rc c'                    the corner of the exactly stretched part (a parallelepiped when the part shears)
 *   representation = Rc (ps o c')      the corner of the engine's box: the same turn, sizes stretched along the part's own axes (groupedPartSizeScale)
 *   skew share = max corner distance / reach      (what production compares with POSE_DISPLACEMENT_TOLERANCE = 3e-4)
 *   shear angle = asin of the largest |cos| between two stretched part axes (0 = the stretched axes are perpendicular, no shear)
 * Gated: LAYERLING_POSE_INVESTIGATION=1.
 */
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
function measure(S: [number, number, number], q: THREE.Quaternion, dims: [number, number, number]) {
  const axes = AXES.map((a) => a.clone().applyQuaternion(q).toArray() as [number, number, number]) as [[number, number, number], [number, number, number], [number, number, number]];
  const ps = groupedPartSizeScale(axes, S);
  const half = [dims[0] / 2, dims[1] / 2, dims[2] / 2];
  let dist = 0, reach = 0;
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) {
    const corner = new THREE.Vector3(a * half[0], b * half[1], c * half[2]);
    const truth = corner.clone().applyQuaternion(q).multiply(new THREE.Vector3(...S));
    const repr = corner.clone().multiply(new THREE.Vector3(ps.width, ps.height, ps.depth)).applyQuaternion(q);
    dist = Math.max(dist, truth.distanceTo(repr)); reach = Math.max(reach, truth.length());
  }
  const v = axes.map(([x, y, z]) => new THREE.Vector3(x * S[0], y * S[1], z * S[2]).normalize());
  const cos = Math.max(Math.abs(v[0].dot(v[1])), Math.abs(v[0].dot(v[2])), Math.abs(v[1].dot(v[2])));
  return { share: reach > 0 ? dist / reach : 0, cos, shearDeg: THREE.MathUtils.radToDeg(Math.asin(Math.min(1, cos))), distMm: dist, reachMm: reach };
}

describe.skipIf(!process.env.LAYERLING_POSE_INVESTIGATION)("skew check: what it permits versus the approved analytic threshold", () => {
  let seed = 20261127;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  const logUniform = (lo: number, hi: number) => Math.exp(Math.log(lo) + rnd() * (Math.log(hi) - Math.log(lo)));
  it("quantifies the largest shear the 3e-4 check lets through, by part proportions", () => {
    const classes: Record<string, { n: number; passed: number; maxShearPassed: number; minShearRefused: number; maxMmPassed: number }> = {};
    let cosOnlyMaxShare = 0, cosOnlyMaxMm = 0, cosOnlyN = 0, ratioMin = Infinity, ratioMax = 0, passedAboveNoise = 0, passedTotal = 0;
    for (let i = 0; i < 400_000; i += 1) {
      // an uneven stretch (one axis strongly stretched, as in SAUD, or all three different); a part turned near a quarter turn or arbitrarily; any proportions down to a thin slab
      const S: [number, number, number] = rnd() < 0.5 ? [logUniform(1.5, 40), 1, 1] : [logUniform(0.05, 40), logUniform(0.05, 40), logUniform(0.05, 40)];
      const quarter = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.round(rnd() * 4) * Math.PI / 2, Math.round(rnd() * 4) * Math.PI / 2, Math.round(rnd() * 4) * Math.PI / 2, "XYZ"));
      const q = rnd() < 0.7 ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), THREE.MathUtils.degToRad(Math.pow(10, -6 + rnd() * 7.5))).multiply(quarter) : new THREE.Quaternion().random();
      const dims: [number, number, number] = [logUniform(0.05, 500), logUniform(0.05, 500), logUniform(0.05, 500)];
      const m = measure(S, q, dims);
      const thin = Math.min(...dims) / Math.max(...dims);
      const cls = thin < 0.01 ? "thin slab (smallest / largest dimension < 0.01)" : thin < 0.1 ? "flat (0.01 to 0.1)" : "compact (> 0.1)";
      const c = (classes[cls] ??= { n: 0, passed: 0, maxShearPassed: 0, minShearRefused: Infinity, maxMmPassed: 0 });
      c.n += 1;
      if (m.share <= POSE_DISPLACEMENT_TOLERANCE) { c.passed += 1; c.maxShearPassed = Math.max(c.maxShearPassed, m.shearDeg); c.maxMmPassed = Math.max(c.maxMmPassed, m.distMm); }
      else c.minShearRefused = Math.min(c.minShearRefused, m.shearDeg);
      if (m.cos <= POSE_SHEAR_COSINE) { cosOnlyN += 1; cosOnlyMaxShare = Math.max(cosOnlyMaxShare, m.share); cosOnlyMaxMm = Math.max(cosOnlyMaxMm, m.distMm); }
      if (m.share <= POSE_DISPLACEMENT_TOLERANCE) { passedTotal += 1; if (m.cos > POSE_SHEAR_COSINE) passedAboveNoise += 1; }
      if (m.cos > 1e-9) { ratioMin = Math.min(ratioMin, m.share / m.cos); ratioMax = Math.max(ratioMax, m.share / m.cos); }
    }
    const lines = Object.entries(classes).map(([k, c]) => `${k}: ${c.n} samples, ${c.passed} pass the 3e-4 check; LARGEST SHEAR ANGLE PASSED ${c.maxShearPassed.toFixed(4)} deg (largest corner displacement passed ${c.maxMmPassed.toFixed(4)} mm); smallest shear angle refused ${Number.isFinite(c.minShearRefused) ? c.minShearRefused.toFixed(6) : "n/a"} deg`);
    console.info(`[skew bound]\n${lines.join("\n")}\nSamples with the approved analytic threshold met (|cos| <= ${POSE_SHEAR_COSINE}, shear <= ${(THREE.MathUtils.radToDeg(Math.asin(POSE_SHEAR_COSINE))).toExponential(2)} deg): ${cosOnlyN}; their largest skew share ${cosOnlyMaxShare.toExponential(2)} and largest corner displacement ${cosOnlyMaxMm.toExponential(2)} mm (the implemented check's tolerance is ${POSE_DISPLACEMENT_TOLERANCE}). Of the ${passedTotal} samples the implemented check passes, ${passedAboveNoise} have a shear above the analytic threshold (${((100 * passedAboveNoise) / Math.max(1, passedTotal)).toFixed(1)}%): genuinely sheared geometry. share / |cos| over all samples: min ${ratioMin.toExponential(2)}, max ${ratioMax.toExponential(2)}.`);
    expect(cosOnlyMaxShare).toBeLessThan(POSE_DISPLACEMENT_TOLERANCE);   // whatever the analytic threshold passes, the implemented check passes too
  });
});
