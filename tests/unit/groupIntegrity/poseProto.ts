import * as THREE from "three";
import { buildGroupedShapeFromSelection, buildHullShapeFromSelection, buildIntersectionShapeFromSelection, groupedShape, groupPartAxes, quaternionForShape, restoreGroupedChildren, rotationFromQuaternion } from "@/lib/editorBooleans";
import { localGroupBounds } from "@/lib/editorMeshCore";
import { groupedContentScale, groupedPartSizeScale } from "@/lib/groupScale";
import { groupMarksOf } from "@/lib/groupMarks";
import { carryShapePivot } from "@/lib/rotationPivot";
import { buildSketchLoftFromSelection } from "@/lib/sketchLoft";
import { canonicalizeShape, mirrorSign, shapeDepth, shapeHasTaper, shapeTaperDimensions, shapeWidth, withHoleMode } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/layerling";
import { TRIANGLE_LIMIT } from "./support";

/*
 * Build 0127 verification PROTOTYPE (tests only; nothing in src uses it). "Un-pose, rebuild in the group's own frame, re-pose", ported from the Build 0121 investigation harness (frame.ts)
 * and extended: every group operation, original ids restored for unchanged parts, and explicit reporting hooks. The inverse is derived from restoreGroupedChildren (editorBooleans.ts).
 */

export type Frame = { S: [number, number, number]; Rg: THREE.Quaternion; m: [number, number, number]; C0: THREE.Vector3 };
export function frameOf(G: WorkplaneShape): Frame {
  const S = groupedContentScale(G, localGroupBounds(G.groupedShapes ?? []));
  return { S, Rg: quaternionForShape(G), m: [mirrorSign(G.mirrorX), mirrorSign(G.mirrorY), mirrorSign(G.mirrorZ)], C0: new THREE.Vector3(G.x, (G.elevation ?? 0) + G.height / 2, G.z) };
}

/** Inverse of restoreGroupedChildren for ONE part: a world part to the part in the group's own (content) frame. */
export function unposePart(G: WorkplaneShape, P: WorkplaneShape): WorkplaneShape {
  const { S: [sx, sy, sz], Rg, m: [mx, my, mz], C0 } = frameOf(G);
  const Mref = new THREE.Matrix4().makeScale(mx, my, mz);
  const wc = new THREE.Vector3(P.x, (P.elevation ?? 0) + P.height / 2, P.z);
  const u = wc.sub(C0).applyQuaternion(Rg.clone().invert());
  const lx = u.x * mx, ly = u.y * my + G.height / 2, lz = u.z * mz;
  // Rw = Rg * Mref * Rc * Mref  =>  Rc = Mref * Rg^-1 * Rw * Mref
  const Rw = new THREE.Matrix4().makeRotationFromQuaternion(quaternionForShape(P));
  const RcM = new THREE.Matrix4().copy(Mref).multiply(new THREE.Matrix4().makeRotationFromQuaternion(Rg.clone().invert())).multiply(Rw).multiply(Mref);
  const rc = rotationFromQuaternion(new THREE.Quaternion().setFromRotationMatrix(RcM));
  const probe = { ...P, rotation: rc.rotation, rotationX: rc.rotationX, rotationZ: rc.rotationZ } as WorkplaneShape;
  const ps = groupedPartSizeScale(groupPartAxes(probe), [sx, sy, sz]);
  const width = shapeWidth(P) / ps.width, depth = shapeDepth(P) / ps.depth, height = P.height / ps.height;
  const flag = (w: boolean | undefined, g: boolean | undefined) => (Boolean(w) !== Boolean(g) ? true : undefined);
  // restoreGroupedChildren multiplies a part's taper (absolute widths and depths) and lean by the part's own stretch (taperedPartPatch); the inverse divides by the same factors.
  const features: Partial<WorkplaneShape> = {};
  if (shapeHasTaper(P)) {
    const taper = shapeTaperDimensions(P);
    features.taperTopWidth = taper.topWidth / ps.width; features.taperBottomWidth = taper.bottomWidth / ps.width;
    features.taperTopDepth = taper.topDepth / ps.depth; features.taperBottomDepth = taper.bottomDepth / ps.depth;
  }
  if (P.extrudeTopOffsetX) features.extrudeTopOffsetX = P.extrudeTopOffsetX / ps.width;
  if (P.extrudeTopOffsetZ) features.extrudeTopOffsetZ = P.extrudeTopOffsetZ / ps.depth;
  return canonicalizeShape({
    ...P, ...features, x: lx / sx, z: lz / sz, elevation: ly / sy - height / 2, width, depth, height, size: Math.max(width, depth),
    rotation: rc.rotation, rotationX: rc.rotationX, rotationZ: rc.rotationZ,
    mirrorX: flag(P.mirrorX, G.mirrorX), mirrorY: flag(P.mirrorY, G.mirrorY), mirrorZ: flag(P.mirrorZ, G.mirrorZ),
  });
}

/** The group's own-frame build for its operation (what rebuildGroupFromParts does, without the pose). */
async function buildOwnFrame(G: WorkplaneShape, local: WorkplaneShape[]) {
  const op = G.groupOperation === "intersection" || G.groupOperation === "hull" || G.groupOperation === "bundle" || G.groupOperation === "loft" ? G.groupOperation : "group";
  const r = op === "intersection" ? await buildIntersectionShapeFromSelection(local, TRIANGLE_LIMIT)
    : op === "hull" ? await buildHullShapeFromSelection(local, TRIANGLE_LIMIT, { keepHoles: Boolean(G.hullKeepHoles) })
      : op === "loft" ? await buildSketchLoftFromSelection(local)
        : op === "bundle" ? { group: groupedShape(local) }
          : await buildGroupedShapeFromSelection(local, TRIANGLE_LIMIT, { clearHoles: true, unionHoles: true });
  return { op, group: (r.group ?? null) as WorkplaneShape | null, failure: ("failureNotice" in r && r.failureNotice ? r.failureNotice : "build failed") as string };
}

export type PreserveResult = { group: WorkplaneShape | null; failure: string; unposedParts: number; verbatimParts: number };
/**
 * Done that keeps the group's own pose. `opened` = the world parts as they were when the session began (same order as G.groupedShapes); a part that is still identical to its opened
 * self is taken verbatim from the original group and keeps its original id; the rest are un-posed.
 */
export async function rebuildPreserving(G: WorkplaneShape, parts: WorkplaneShape[], opened: WorkplaneShape[], options: { forceUnpose?: boolean } = {}): Promise<PreserveResult> {
  const byId = new Map(opened.map((o, i) => [o.id, i]));
  let verbatim = 0;
  const local = parts.map((p) => {
    const i = byId.get(p.id);
    if (!options.forceUnpose && i !== undefined && JSON.stringify(opened[i]) === JSON.stringify(p)) { verbatim += 1; return G.groupedShapes![i]; }
    return unposePart(G, p);
  });
  const built = await buildOwnFrame(G, local);
  if (!built.group) return { group: null, failure: built.failure, unposedParts: parts.length - verbatim, verbatimParts: verbatim };
  const U = built.group;
  const { S: [sx, sy, sz], Rg, m: [mx, my, mz], C0 } = frameOf(G);
  const baseHOld = G.height / sy;
  const cNew = new THREE.Vector3(U.x, (U.elevation ?? 0) + U.height / 2 - baseHOld / 2, U.z);
  const Cw = C0.clone().add(new THREE.Vector3(mx * sx * cNew.x, my * sy * cNew.y, mz * sz * cNew.z).applyQuaternion(Rg));
  const width = U.width * sx, depth = U.depth * sz, height = U.height * sy;
  // the group's own children keep the ids they had when they are the original, untouched parts (the builder derives new ones)
  const children = U.groupedShapes?.map((child, i) => (parts[i] && local[i] === G.groupedShapes?.[byId.get(parts[i].id) ?? -1] ? { ...child, id: local[i].id } : child));
  const firstSolid = G.groupedShapes?.find((c) => !c.hole) ?? G.groupedShapes?.[0];
  const ownColour = Boolean(firstSolid && firstSolid.color !== G.color);
  const posed = canonicalizeShape(carryShapePivot(G, withHoleMode({
    ...U, ...(children ? { groupedShapes: children } : {}), id: G.id, name: G.name, color: ownColour || (G.hole && parts.every((p) => p.hole)) ? G.color : U.color, transparent: G.transparent, hidden: G.hidden,
    groupResize: G.groupResize, ...(G.shapeLocked ? { shapeLocked: true } : {}), ...(typeof G.multicolor === "boolean" ? { multicolor: G.multicolor } : {}), ...groupMarksOf(G),
    groupOperation: built.op, x: Cw.x, z: Cw.z, width, depth, height, size: Math.max(width, depth), elevation: Cw.y - height / 2,
    rotation: G.rotation, rotationX: G.rotationX, rotationZ: G.rotationZ, mirrorX: G.mirrorX, mirrorY: G.mirrorY, mirrorZ: G.mirrorZ,
  }, Boolean(G.hole))));
  return { group: posed, failure: "", unposedParts: parts.length - verbatim, verbatimParts: verbatim };
}

/** Open the ancestor chain along `route`, let `mutate` change the deepest level's world parts, finish each level back out, DEEPEST FIRST (the order the editor finishes nested sessions). */
export async function nestedPreserving(top: WorkplaneShape, route: number[], mutate: (parts: WorkplaneShape[]) => WorkplaneShape[]) {
  const groups: WorkplaneShape[] = [top];
  const opened: WorkplaneShape[][] = [];
  const parts: WorkplaneShape[][] = [];
  for (let level = 0; level <= route.length; level += 1) {
    const p = restoreGroupedChildren(groups[level]).map((x) => ({ ...x, locked: false }));
    opened.push(p); parts.push(p.map((x) => x));
    if (level < route.length) groups.push(p[route[level]]);
  }
  parts[route.length] = mutate(parts[route.length]);
  for (let level = route.length; level >= 0; level -= 1) {
    const r = await rebuildPreserving(groups[level], parts[level], opened[level]);
    if (!r.group) return { ok: false as const, level, failure: r.failure };
    if (level === 0) return { ok: true as const, result: r.group };
    parts[level - 1][route[level - 1]] = r.group;
  }
  throw new Error("unreachable");
}
