import { buildGroupedShapeFromSelection, restoreGroupedChildren } from "@/lib/editorBooleans";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/layerling";
import { flatLeaves, makeGroup, maxVertexDeviation, primitive, reconstructStrict, symmetricDifferenceVolume, bodyStats, TRIANGLE_LIMIT } from "./support";
import { frameOf, rebuildPreserving } from "./poseProto";

/** Shared lab for the Build 0127 verification (tests only). */
export type Pose = { rotation?: number; rotationX?: number; rotationZ?: number; mirrorX?: boolean; mirrorY?: boolean; mirrorZ?: boolean; stretch?: [number, number, number]; x?: number; z?: number; elevation?: number };

/** An own-frame group built with the production builder, then given a pose the way a person transforms a group (rotate, mirror, resize, move). */
export async function posedGroup(local: WorkplaneShape[], pose: Pose, patch: Partial<WorkplaneShape> = {}): Promise<WorkplaneShape> {
  const built = await buildGroupedShapeFromSelection(local, TRIANGLE_LIMIT, { clearHoles: true, unionHoles: true });
  if (!built.group) throw new Error(`cannot group: ${built.failureNotice}`);
  return posedFrom(built.group, pose, patch);
}
export function posedFrom(U: WorkplaneShape, pose: Pose, patch: Partial<WorkplaneShape> = {}): WorkplaneShape {
  const [sx, sy, sz] = pose.stretch ?? [1, 1, 1];
  const width = U.width * sx, height = U.height * sy, depth = U.depth * sz;
  return canonicalizeShape({
    ...U, id: "G", name: "Posed", width, height, depth, size: Math.max(width, depth),
    x: (pose.x ?? 0) + U.x, z: (pose.z ?? 0) + U.z, elevation: (pose.elevation ?? 0) + (U.elevation ?? 0),
    rotation: pose.rotation ?? 0, rotationX: pose.rotationX, rotationZ: pose.rotationZ,
    mirrorX: pose.mirrorX || undefined, mirrorY: pose.mirrorY || undefined, mirrorZ: pose.mirrorZ || undefined, ...patch,
  } as WorkplaneShape);
}

export const openParts = (G: WorkplaneShape) => restoreGroupedChildren(G).map((p) => ({ ...p, locked: false }));

export const relSym = (a: WorkplaneShape, b: WorkplaneShape) => {
  const d = symmetricDifferenceVolume(a, b);
  const v = Math.max(1e-9, bodyStats(a).volume);
  return d === null ? Number.NaN : d / v;
};
export const bboxDev = (a: WorkplaneShape, b: WorkplaneShape) => { const x = bodyStats(a).bbox, y = bodyStats(b).bbox; return Math.max(...x.map((v, i) => Math.abs(v - y[i]))); };

/** Largest world-vertex deviation between two groups' leaves, matched by index (Infinity when the leaf counts differ). */
export const leafDev = (a: WorkplaneShape, b: WorkplaneShape) => {
  const la = flatLeaves(a), lb = flatLeaves(b);
  if (la.length !== lb.length) return Number.POSITIVE_INFINITY;
  return Math.max(0, ...la.map((leaf, i) => maxVertexDeviation(leaf.verts, lb[i].verts)));
};
export const poseFieldsDiff = (a: WorkplaneShape, b: WorkplaneShape) => {
  const keys = ["rotation", "rotationX", "rotationZ"] as const;
  let d = Math.max(...keys.map((k) => Math.abs(((a as never)[k] as number ?? 0) - ((b as never)[k] as number ?? 0))));
  for (const k of ["mirrorX", "mirrorY", "mirrorZ"] as const) if (Boolean(a[k]) !== Boolean(b[k])) d = Math.max(d, 1);
  const fa = frameOf(a).S, fb = frameOf(b).S;
  return Math.max(d, ...fa.map((s, i) => Math.abs(s - fb[i])));
};
export { makeGroup, primitive, reconstructStrict, rebuildPreserving, flatLeaves, bodyStats, TRIANGLE_LIMIT };
