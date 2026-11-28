import { buildHullShapeFromSelection, buildIntersectionShapeFromSelection, cloneAsGroupChild } from "@/lib/editorBooleans";
import { cleanModelDimension, MIN_SHAPE_DIMENSION, meshForShape } from "@/lib/editorMeshCore";
import { groupMarksOf } from "@/lib/groupMarks";
import { planPoseRebuild, poseBuiltGroup } from "@/lib/groupPose";
import { createLocalId } from "@/lib/localIds";
import { carryShapePivot } from "@/lib/rotationPivot";
import { canonicalizeShape, withHoleMode } from "@/lib/workplaneShapes";
import type { WorkplaneShape } from "@/types/layerling";
import { TRIANGLE_LIMIT } from "./support";

/*
 * Build 0129 FIRST STEP (tests only; nothing in src uses it): a PROTOTYPE of the single-constituent reconstruction, to find out what the real one must handle. Follows the existing conventions:
 *  - an ordinary group or a bundle of one constituent is a PLAIN group, exactly what `groupedShape` makes for two or more (no baked body: the constituent is drawn as itself; nothing is computed from it);
 *  - hull and intersection use the kernel builders on the constituent (a convex hull of one part is not the part; an intersection of one is the part) and therefore require a closed solid;
 *  - a loft needs two sketches: refused;
 *  - zero constituents: `removed`.
 * The pose (rotation, mirror, resize) goes through the Build 0127 plan and `poseBuiltGroup`, so the 0127 gate applies to a changed constituent and an untouched one is verbatim.
 */
export type SingleResult = { group: WorkplaneShape | null; removed?: boolean; failure: string; refusal?: "expected" };

function plainGroupOfOne(part: WorkplaneShape): WorkplaneShape {
  const mesh = meshForShape(part);
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const v of mesh.vertices) for (let a = 0; a < 3; a += 1) { box[a] = Math.min(box[a], v[a]); box[a + 3] = Math.max(box[a + 3], v[a]); }
  const centerX = (box[0] + box[3]) / 2, centerZ = (box[2] + box[5]) / 2, minY = box[1];
  const width = cleanModelDimension(Math.max(MIN_SHAPE_DIMENSION, box[3] - box[0]));
  const depth = cleanModelDimension(Math.max(MIN_SHAPE_DIMENSION, box[5] - box[2]));
  const height = cleanModelDimension(Math.max(MIN_SHAPE_DIMENSION, box[4] - box[1]));
  return { id: createLocalId("group"), name: "Group", kind: "mesh", color: part.color, hole: Boolean(part.hole), x: centerX, z: centerZ, elevation: minY, size: Math.max(width, depth), width, depth, height, rotation: 0, groupedBaseWidth: width, groupedBaseDepth: depth, groupedBaseHeight: height, groupedShapes: [cloneAsGroupChild(part, centerX, centerZ, minY)], locked: false, hidden: false } as WorkplaneShape;
}

const same = (a: WorkplaneShape, b: WorkplaneShape) => JSON.stringify(canonicalizeShape({ ...a, locked: false })) === JSON.stringify(canonicalizeShape({ ...b, locked: false }));

export async function singleConstituent(original: WorkplaneShape, parts: WorkplaneShape[], opened: readonly WorkplaneShape[]): Promise<SingleResult> {
  if (parts.length === 0) return { group: null, removed: true, failure: "" };
  const plan = planPoseRebuild(original, parts, opened);
  if (plan.kind === "refuse") return { group: null, failure: plan.message, refusal: "expected" };
  const preserve = plan.kind === "preserve" ? plan : null;
  const part = preserve ? preserve.local[0] : parts[0];
  const op = original.groupOperation === "bundle" || original.groupOperation === "hull" || original.groupOperation === "intersection" || original.groupOperation === "loft" ? original.groupOperation : "group";
  let built: WorkplaneShape | null;
  if (op === "loft") return { group: null, failure: "a loft needs two sketches", refusal: "expected" };
  if (op === "hull" || op === "intersection") {
    // the kernel builders need two shapes: the constituent twice (a hull of a part with itself is the hull of the part; an intersection of a part with itself is the part), then ONE child is kept
    const twin = { ...part, id: `${part.id}~twin` };
    const r = op === "hull" ? await buildHullShapeFromSelection([part, twin], TRIANGLE_LIMIT, { keepHoles: Boolean(original.hullKeepHoles) }) : await buildIntersectionShapeFromSelection([part, twin], TRIANGLE_LIMIT);
    built = r.group ? { ...r.group, groupedShapes: r.group.groupedShapes?.slice(0, 1) } : null;
    if (!built) return { group: null, failure: ("failureNotice" in r && r.failureNotice) || "the kernel refused", refusal: "expected" };
  } else built = plainGroupOfOne(part);
  const hole = Boolean(part.hole);
  const rebuilt = canonicalizeShape(preserve ? poseBuiltGroup(original, { ...built, groupOperation: op } as WorkplaneShape, preserve) : { ...built, groupOperation: op });
  // an untouched constituent keeps its ORIGINAL id (the builder derives a new one), pose or not
  const idx = opened.findIndex((o) => o.id === parts[0].id);
  const keepId = idx >= 0 && same(opened[idx], parts[0]) ? original.groupedShapes?.[idx]?.id : undefined;
  const children = rebuilt.groupedShapes?.map((c, i) => (i === 0 && keepId ? { ...c, id: keepId } : c));
  const group = canonicalizeShape(carryShapePivot(original, withHoleMode({
    ...rebuilt, ...(children ? { groupedShapes: children } : {}), id: original.id, name: original.name, color: original.color, transparent: original.transparent, hidden: original.hidden,
    ...(original.shapeLocked ? { shapeLocked: true } : {}), groupResize: original.groupResize, ...(typeof original.multicolor === "boolean" ? { multicolor: original.multicolor } : {}), ...groupMarksOf(original),
  }, hole)));
  return { group, failure: "" };
}
