import * as THREE from "three";
import { groupPartAxes, quaternionForShape, rotationFromQuaternion } from "@/lib/editorBooleans";
import { localGroupBounds } from "@/lib/editorMeshCore";
import { groupedContentScale, groupedPartSizeScale } from "@/lib/groupScale";
import { displayShapeName } from "@/lib/shapeCatalog";
import { shapeHasAlongDeform } from "@/lib/slopeAlong";
import { canonicalizeShape, mirrorSign, shapeDepth, shapeHasExtrudeDeform, shapeHasTaper, shapeTaperDimensions, shapeWidth } from "@/lib/workplaneShapes";
import { groupFinishProblemMessage, type GroupFinishProblem } from "@/lib/groupFinishProblems";
import type { WorkplaneShape } from "@/types/layerling";

/**
 * Build 0127: transformation-preserving reconstruction (native Done, strict). A group keeps its own rotation, mirror and stretch (its POSE) when an edited session is finished:
 * the changed parts are un-posed into the group's own frame, the group is built there, and the original pose is applied again. Parts that were not touched are taken verbatim from
 * the original group, with their original ids. This module is pure: it decides (`planPoseRebuild`), un-poses (`unposePart`) and re-poses (`poseBuiltGroup`); `groupReconstruction.ts` builds.
 *
 * Everything unsafe or unverified is REFUSED with a message a modeler can act on (`groupFinishProblems.ts`); there is no fallback to baking the pose into the parts. Evidence and the supported
 * set: docs/BUILD-0127-VERIFICATION.md and docs/BUILD-0127-SUPPORTED-SET-AND-MESSAGES.md. A group without a pose is not handled here at all (the Build 0126 path).
 */

/**
 * TWO INDEPENDENT SAFEGUARDS for a changed part (Bill, 2026-11-27); neither substitutes for or overrides the other:
 *  1. GEOMETRIC REPRESENTABILITY (shear): the stretched axes of the part must stay perpendicular, |cos| <= POSE_SHEAR_COSINE. A part that fails it is a parallelepiped, which the engine's part
 *     (a rotation and three sizes) cannot express: refused, however small its displacement looks.
 *  2. ROTATION STORAGE PRECISION: storing the part's rotation (0.01 degrees per Euler angle, small components snapped) may move it by at most POSE_DISPLACEMENT_TOLERANCE of its reach in the WORLD.
 */
export const POSE_SHEAR_COSINE = 1e-6;
/** Largest allowed displacement of a changed part from storing its rotation, in the world, as a share of its reach (half its stretched box diagonal): three 0.005 degree rounding errors compose to at most 2.6e-4 rad. */
export const POSE_DISPLACEMENT_TOLERANCE = 3e-4;
const EPSILON = 1e-6;

export type Frame = { S: [number, number, number]; Rg: THREE.Quaternion; m: [number, number, number]; C0: THREE.Vector3 };
export function frameOf(group: WorkplaneShape): Frame {
  const S = groupedContentScale(group, localGroupBounds(group.groupedShapes ?? []));
  return { S, Rg: quaternionForShape(group), m: [mirrorSign(group.mirrorX), mirrorSign(group.mirrorY), mirrorSign(group.mirrorZ)], C0: new THREE.Vector3(group.x, (group.elevation ?? 0) + group.height / 2, group.z) };
}

/** Whether the group carries a pose: any rotation, any mirror, or a size that is not the size it was grouped at. A group without one is reconstructed by the Build 0126 path. */
export function groupHasPose(group: WorkplaneShape): boolean {
  const turned = [group.rotation, group.rotationX, group.rotationZ].some((v) => Math.abs(v ?? 0) > 1e-9);
  const mirrored = Boolean(group.mirrorX || group.mirrorY || group.mirrorZ);
  const [sx, sy, sz] = frameOf(group).S;
  return turned || mirrored || [sx, sy, sz].some((s) => Math.abs(s - 1) > EPSILON);
}
const resizedAtAll = (S: readonly number[]) => S.some((s) => Math.abs(s - 1) > EPSILON);
const resizedUnevenly = (S: readonly number[]) => Math.max(...S) - Math.min(...S) > EPSILON * Math.max(...S);

export type Unposed = { part: WorkplaneShape; displacementMm: number; displacementShare: number; shearCos: number };

/**
 * The inverse of `restoreGroupedChildren` for one part: a world part (as the editor shows it while the group is open) back to the part in the group's own content frame, together with
 * what storing it costs in the WORLD (the group's stretch amplifies a local displacement, so the check is made after stretching):
 *  - `displacement*`: the engine stores rotations as three Euler angles rounded to 0.01 degrees, each set to 0 within about 0.505 degrees of a multiple of 360; how far that moves the part;
 *  - `shearCos`: the largest |cos| between two of the part's axes after the group's stretch (0 when they stay perpendicular). A part turned at an angle inside an unevenly stretched group becomes a
 *    parallelepiped; this is the analytic measure of that, independent of the displacement.
 */
export function unposePart(group: WorkplaneShape, world: WorkplaneShape): Unposed {
  const { S, Rg, m: [mx, my, mz], C0 } = frameOf(group);
  const [sx, sy, sz] = S;
  const Mref = new THREE.Matrix4().makeScale(mx, my, mz);
  const centre = new THREE.Vector3(world.x, (world.elevation ?? 0) + world.height / 2, world.z);
  const u = centre.sub(C0).applyQuaternion(Rg.clone().invert());
  const lx = u.x * mx, ly = u.y * my + group.height / 2, lz = u.z * mz;
  // Rw = Rg * Mref * Rc * Mref  =>  Rc = Mref * Rg^-1 * Rw * Mref
  const Rw = new THREE.Matrix4().makeRotationFromQuaternion(quaternionForShape(world));
  const RcM = new THREE.Matrix4().copy(Mref).multiply(new THREE.Matrix4().makeRotationFromQuaternion(Rg.clone().invert())).multiply(Rw).multiply(Mref);
  const exact = new THREE.Quaternion().setFromRotationMatrix(RcM);
  const rc = rotationFromQuaternion(exact);
  const probe = { ...world, rotation: rc.rotation, rotationX: rc.rotationX, rotationZ: rc.rotationZ } as WorkplaneShape;
  const ps = groupedPartSizeScale(groupPartAxes(probe), [sx, sy, sz]);
  const width = shapeWidth(world) / ps.width, depth = shapeDepth(world) / ps.depth, height = world.height / ps.height;
  const flag = (w: boolean | undefined, g: boolean | undefined) => (Boolean(w) !== Boolean(g) ? true : undefined);
  // restoreGroupedChildren multiplies a part's taper and lean by the part's own stretch (taperedPartPatch); the inverse divides by the same factors.
  const features: Partial<WorkplaneShape> = {};
  if (shapeHasTaper(world)) {
    const taper = shapeTaperDimensions(world);
    features.taperTopWidth = taper.topWidth / ps.width; features.taperBottomWidth = taper.bottomWidth / ps.width;
    features.taperTopDepth = taper.topDepth / ps.depth; features.taperBottomDepth = taper.bottomDepth / ps.depth;
  }
  // a cone gets explicit radii multiplied by the part's width stretch (coneRadiiForWidth); the inverse divides by the same factor
  if (world.kind === "cone") {
    features.baseRadius = (world.baseRadius ?? shapeWidth(world) / 2) / ps.width;
    if (world.topRadius !== undefined) features.topRadius = world.topRadius / ps.width;
  }
  if (world.extrudeTopOffsetX) features.extrudeTopOffsetX = world.extrudeTopOffsetX / ps.width;
  if (world.extrudeTopOffsetZ) features.extrudeTopOffsetZ = world.extrudeTopOffsetZ / ps.depth;
  const part = canonicalizeShape({
    ...world, ...features, x: lx / sx, z: lz / sz, elevation: ly / sy - height / 2, width, depth, height, size: Math.max(width, depth),
    rotation: rc.rotation, rotationX: rc.rotationX, rotationZ: rc.rotationZ,
    mirrorX: flag(world.mirrorX, group.mirrorX), mirrorY: flag(world.mirrorY, group.mirrorY), mirrorZ: flag(world.mirrorZ, group.mirrorZ),
  });
  // Spatial checks in the WORLD, on the corners of the part's box in the group's content frame, after the group's stretch.
  const stored = quaternionForShape(part);
  const half = [shapeWidth(part) / 2, part.height / 2, shapeDepth(part) / 2];
  const stretch = (v: THREE.Vector3) => v.set(v.x * sx, v.y * sy, v.z * sz);
  let displacement = 0, reach = 0;
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) {
    const corner = new THREE.Vector3(a * half[0], b * half[1], c * half[2]);
    const truth = stretch(corner.clone().applyQuaternion(exact));
    displacement = Math.max(displacement, truth.distanceTo(stretch(corner.clone().applyQuaternion(stored))));
    reach = Math.max(reach, truth.length());
  }
  const share = (d: number) => (reach > 0 ? d / reach : 0);
  // the shear of the part AS STORED (what the rebuilt body will contain): the stretched axes of its own turn
  const stretched = groupPartAxes(part).map(([x, y, z]) => new THREE.Vector3(x * sx, y * sy, z * sz).normalize());
  const shearCos = Math.max(Math.abs(stretched[0].dot(stretched[1])), Math.abs(stretched[0].dot(stretched[2])), Math.abs(stretched[1].dot(stretched[2])));
  return { part, displacementMm: displacement, displacementShare: share(displacement), shearCos };
}

/** What the group builders have been verified to carry through an un-posed rebuild (docs/BUILD-0127-SUPPORTED-SET-AND-MESSAGES.md section 6). */
const SUPPORTED_OPERATIONS = new Set<string | undefined>([undefined, "group", "bundle", "hull", "intersection"]);
const SUPPORTED_KINDS = new Set(["box", "cylinder", "ellipse", "sphere", "cone", "mesh"]);
const KIND_LABELS: Record<string, string> = { roundedBox: "rounded box", halfSphere: "half sphere", roundRoof: "round roof", curvedCone: "curved cone", bentTube: "bent tube", screwBoss: "screw boss", snapFit: "snap fit", doubleCountersink: "double countersink", finishingWasher: "finishing washer" };
const kindLabel = (kind: string) => KIND_LABELS[kind] ?? kind.replace(/([A-Z])/g, " $1").toLowerCase();

/** The reason a GROUP (or a nested group changed in the session) cannot be kept exact while posed, or null. Group-level paint, multicolor information and marks are included. */
export function unsupportedGroupFeature(group: WorkplaneShape): string | null {
  if (!SUPPORTED_OPERATIONS.has(group.groupOperation)) return group.groupOperation === "loft" ? "loft" : `${group.groupOperation} group`;
  if (group.edgeTreatments?.length) return "group with edge treatments";
  if (group.surfaceTexture) return "group with a surface texture";
  if (group.cylinderWrap) return "group with a cylinder wrap";
  if (group.kind === "vase") return "vase";
  if (group.cadBrep) return "group with an exact (STEP) body";
  if (group.paint?.length) return "painted group";
  if (group.multicolor === true) return "multicolor group";
  if (group.layeredText) return "name tag";
  if (group.layeredIcon) return "icon tag";
  if (group.qrCode) return "QR code";
  if (group.sbcBoard) return "circuit board mount";
  return null;
}

/** What a changed or new PART uses that has not been verified, or null. */
function unsupportedPartFeature(part: WorkplaneShape): string | null {
  if (part.groupedShapes?.length) return unsupportedGroupFeature(part) ? `a ${unsupportedGroupFeature(part)}` : null;
  if (part.edgeTreatments?.length) return "edge treatments";
  if (part.cadBrep) return "an exact (STEP) body";
  if (part.surfaceTexture) return "a surface texture";
  if (part.cylinderWrap) return "a cylinder wrap";
  if (part.paint?.length) return "painted surfaces";
  if (shapeHasAlongDeform(part)) return "a bend";
  return null;
}

export type PosePlan =
  | { kind: "unposed" }
  | { kind: "restore" }
  | { kind: "refuse"; message: string }
  | { kind: "preserve"; local: WorkplaneShape[]; verbatim: boolean[] };

const same = (a: WorkplaneShape, b: WorkplaneShape) => JSON.stringify(canonicalizeShape({ ...a, locked: false })) === JSON.stringify(canonicalizeShape({ ...b, locked: false }));
const refuse = (problem: GroupFinishProblem): PosePlan => ({ kind: "refuse", message: groupFinishProblemMessage(problem) });

/**
 * Decides how a finished session of `original` is rebuilt. `parts` are the session's world parts now, `opened` the world parts as the session began (same order as the original's parts).
 * Order of checks: no pose (Build 0126 path); nothing changed (the original comes back); the group's own operation and features; then every changed or new part, in order: kind and
 * features, skew under an uneven stretch, twist or lean under an uneven stretch, and the cost of storing its rotation.
 */
export function planPoseRebuild(original: WorkplaneShape, parts: readonly WorkplaneShape[], opened: readonly WorkplaneShape[] | undefined): PosePlan {
  if (!groupHasPose(original)) return { kind: "unposed" };
  const group = displayShapeName(original);
  const originals = original.groupedShapes ?? [];
  const usable = Boolean(opened) && opened!.length === originals.length;
  const byId = new Map((usable ? opened! : []).map((part, index) => [part.id, index]));
  const verbatim = parts.map((part) => { const i = byId.get(part.id); return i !== undefined && same(opened![i], part); });
  if (usable && parts.length === opened!.length && verbatim.every(Boolean)) return { kind: "restore" };
  const type = unsupportedGroupFeature(original);
  if (type) return refuse({ kind: "unsupportedGroup", group, type });
  const { S } = frameOf(original);
  const uneven = resizedUnevenly(S), resized = resizedAtAll(S);
  const local: WorkplaneShape[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const world = parts[index];
    if (verbatim[index]) { local.push(originals[byId.get(world.id)!]); continue; }
    const name = displayShapeName(world);
    const feature = unsupportedPartFeature(world);
    if (feature) return refuse({ kind: "unsupportedFeature", group, part: name, feature });
    if (!SUPPORTED_KINDS.has(world.kind) && !world.groupedShapes?.length) {
      const supportedStar = world.kind === "star" && !resized;
      if (!supportedStar) return resized ? refuse({ kind: "unsupportedKind", group, part: name, kindName: kindLabel(world.kind) }) : refuse({ kind: "unsupportedFeature", group, part: name, feature: `a ${kindLabel(world.kind)}` });
    }
    const unposed = unposePart(original, world);
    // safeguard 1 (representability): the analytic shear threshold; evaluated for every changed part, whatever the stretch, and never relaxed by the displacement tolerance
    if (unposed.shearCos > POSE_SHEAR_COSINE) return refuse({ kind: "skewed", group, part: name });
    if (uneven && shapeHasExtrudeDeform(world)) {
      const twisted = Math.abs(world.extrudeTwist ?? 0) > EPSILON, leaning = Math.abs(world.extrudeTopOffsetX ?? 0) > EPSILON || Math.abs(world.extrudeTopOffsetZ ?? 0) > EPSILON;
      return refuse({ kind: "twistLean", group, part: name, what: twisted && leaning ? "twisted and leaning" : twisted ? "twisted" : "leaning" });
    }
    // safeguard 2 (rotation storage precision): independent of the shear check
    if (unposed.displacementShare > POSE_DISPLACEMENT_TOLERANCE) return refuse({ kind: "rotationStorage", group, part: name, mm: unposed.displacementMm });
    local.push(unposed.part);
  }
  return { kind: "preserve", local, verbatim };
}

/**
 * The group built in its own frame (`built`, from the local parts) with the original pose applied again: its rotation, mirror and stretch exactly as they were, its centre and size from the new
 * body. Children that are the original, untouched parts keep their original ids.
 */
export function poseBuiltGroup(original: WorkplaneShape, built: WorkplaneShape, plan: Extract<PosePlan, { kind: "preserve" }>): WorkplaneShape {
  const { S: [sx, sy, sz], Rg, m: [mx, my, mz], C0 } = frameOf(original);
  const baseHeight = original.height / sy;
  const centre = new THREE.Vector3(built.x, (built.elevation ?? 0) + built.height / 2 - baseHeight / 2, built.z);
  const world = C0.clone().add(new THREE.Vector3(mx * sx * centre.x, my * sy * centre.y, mz * sz * centre.z).applyQuaternion(Rg));
  const width = built.width * sx, depth = built.depth * sz, height = built.height * sy;
  // the builders keep the order of the parts they are given; an untouched part gets its original id back (the builder derives a new one each time)
  const children = built.groupedShapes && built.groupedShapes.length === plan.local.length
    ? built.groupedShapes.map((child, i) => (plan.verbatim[i] ? { ...child, id: plan.local[i].id } : child))
    : built.groupedShapes;
  return { ...built, ...(children ? { groupedShapes: children } : {}), x: world.x, z: world.z, width, depth, height, size: Math.max(width, depth), elevation: world.y - height / 2, rotation: original.rotation, rotationX: original.rotationX, rotationZ: original.rotationZ, mirrorX: original.mirrorX, mirrorY: original.mirrorY, mirrorZ: original.mirrorZ };
}
