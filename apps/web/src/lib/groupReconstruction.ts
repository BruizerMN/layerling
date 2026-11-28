import { buildGroupedShapeOffThread } from "@/lib/geometryWorker";
import { buildHullShapeFromSelection, buildIntersectionShapeFromSelection, disposeManifold, groupedShape, manifoldFromMeshData, type GroupBuildQuality } from "@/lib/editorBooleans";
import { getManifoldRuntime, meshForShape } from "@/lib/editorMeshCore";
import { buildSketchLoftFromSelection } from "@/lib/sketchLoft";
import { analyzeMesh } from "@/lib/meshRepair";
import { planPoseRebuild, poseBuiltGroup } from "@/lib/groupPose";
import { carryShapePivot } from "@/lib/rotationPivot";
import { groupMarksOf } from "@/lib/groupMarks";
import { groupFinishProblemMessage } from "@/lib/groupFinishProblems";
import { rebasePaintStrokes } from "@/lib/paintMesh";
import { canPaintShape } from "@/lib/paint";
import { displayShapeName } from "@/lib/shapeCatalog";
import { canonicalizeShape, withHoleMode } from "@/lib/workplaneShapes";
import { t } from "@/lib/i18n";
import type { WorkplaneShape } from "@/types/layerling";

/**
 * A group built again from these parts: the single production reconstruction used by Done on an opened group, by adding to or taking
 * from a group in the object list, by hull and keep-holes changes and by stretched-group splits.
 *
 * Extracted unchanged from LayerlingEditor.tsx in Build 0121 so the model-integrity tests call the real function (tests/unit/groupIntegrity).
 * The rebuilt group is the same group, not a new one: its id stays, with its name, see-through, hidden, solid or hole, its own colour and its
 * pivot (#807); it also keeps what it does with its parts when it is resized (Discussion #526).
 *
 * Build 0122: `strict` (native Done) refuses a result that is not the intended reconstruction instead of accepting it, counts holes that touch no solid as a
 * success, and names the object that is the problem. Without `strict` the behaviour is exactly that of Build 0121.
 */
export type GroupReconstructionContext = {
  /** The boolean triangle limit in force (workspace setting). */
  triangleLimit: number;
  /** Stops the work when the scene changes under it (page only). */
  signal?: AbortSignal;
  strict?: boolean;
  /** Build 0127 (native Done): the session's parts as they were when it began (the world parts `restoreGroupedChildren` made), so that parts not touched keep their original form and a group's pose is kept. */
  opened?: readonly WorkplaneShape[];
};

export type GroupReconstruction =
  | { group: WorkplaneShape; mergeWarning: string; quality?: GroupBuildQuality }
  | { group: null; failure: string };

/** The parts whose mesh the kernel cannot take as a closed solid (an operand of a boolean that is not one). A part that is itself a group without a body is drawn from its own parts and is not checked here. */
export async function partsThatAreNotClosedSolids(parts: readonly WorkplaneShape[]): Promise<string[]> {
  return (await openMeshParts(parts)).names;
}

/** Build 0126: the same, and whether any of them is a T-junction defect that Model > Repair Open Meshes can close (the only case in which that command is recommended). */
export async function openMeshParts(parts: readonly WorkplaneShape[]): Promise<{ names: string[]; repairable: boolean }> {
  let runtime;
  try {
    runtime = await getManifoldRuntime();
  } catch {
    return { names: [], repairable: false };
  }
  const names: string[] = [];
  let repairable = false;
  const noteOpen = (part: WorkplaneShape) => {
    names.push(displayShapeName(part));
    if (part.importedMesh && !part.groupedShapes?.length && analyzeMesh(part.importedMesh).state === "repairable") repairable = true;
  };
  for (const part of parts) {
    if (part.groupedShapes?.length && !part.importedMesh) continue;
    let solid;
    try {
      solid = manifoldFromMeshData(runtime, meshForShape(part));
      if (solid.status() !== "NoError" || solid.numTri() < 1) noteOpen(part);
    } catch {
      noteOpen(part);
    } finally {
      if (solid) disposeManifold(solid);
    }
  }
  return { names: [...new Set(names)], repairable };
}

export async function rebuildGroupFromParts(original: WorkplaneShape, parts: WorkplaneShape[], context: GroupReconstructionContext): Promise<GroupReconstruction> {
  // Build 0127: a group that carries a pose (rotation, mirror, resize) keeps it, or Done is refused; a group without one takes the unchanged path below (Build 0126). Native strict only.
  const plan = context.strict ? planPoseRebuild(original, parts, context.opened) : null;
  if (plan?.kind === "refuse") return { group: null, failure: plan.message };
  if (plan?.kind === "restore") return { group: original, mergeWarning: "" };
  const preserve = plan?.kind === "preserve" ? plan : null;
  const buildFrom = preserve ? preserve.local : parts;
  const operation = original.groupOperation === "intersection" || original.groupOperation === "hull" || original.groupOperation === "bundle" || original.groupOperation === "loft" ? original.groupOperation : "group";
  const result = operation === "intersection"
    ? await buildIntersectionShapeFromSelection(buildFrom, context.triangleLimit)
    : operation === "hull"
      ? await buildHullShapeFromSelection(buildFrom, context.triangleLimit, { keepHoles: Boolean(original.hullKeepHoles) })
      : operation === "loft"
      ? await buildSketchLoftFromSelection(buildFrom)
      : operation === "bundle"
      ? { group: groupedShape(buildFrom) }
      : await buildGroupedShapeOffThread(buildFrom, context.triangleLimit, context.signal, { clearHoles: Boolean(context.strict), unionHoles: Boolean(context.strict) });
  const quality: GroupBuildQuality | undefined = "quality" in result ? (result.quality as GroupBuildQuality | undefined) : undefined;
  const name = displayShapeName(original);
  if (!result.group) {
    const base = "failureNotice" in result && result.failureNotice ? result.failureNotice : t("status.groupChanged");
    if (!context.strict) return { group: null, failure: base };
    const { names: objects, repairable } = await openMeshParts(parts);
    // Build 0126: a group of holes only that could not be unioned says so (never the cut of a solid, and never the meshes laid together instead).
    const built = result as { hasSolid?: boolean; hasHole?: boolean; hasImportedMesh?: boolean };
    const holeOnly = Boolean(built.hasHole && !built.hasSolid && built.hasImportedMesh);
    return { group: null, failure: objects.length ? groupFinishProblemMessage({ kind: "openMesh", group: name, objects, repairable }) : groupFinishProblemMessage({ kind: holeOnly ? "unionFailed" : "cutFailed", group: name }) };
  }
  if (context.strict && quality?.degraded) {
    const { names: objects, repairable } = await openMeshParts(parts);
    return { group: null, failure: objects.length ? groupFinishProblemMessage({ kind: "openMesh", group: name, objects, repairable }) : groupFinishProblemMessage({ kind: "degraded", group: name, reason: quality.degraded }) };
  }
  // Its colour stays if it had been given one apart from its first part.
  const firstSolid = original.groupedShapes?.find((child) => !child.hole) ?? original.groupedShapes?.[0];
  const ownColour = Boolean(firstSolid && firstSolid.color !== original.color);
  const rebuilt = canonicalizeShape(preserve ? poseBuiltGroup(original, { ...result.group, groupOperation: operation } as WorkplaneShape, preserve) : { ...result.group, groupOperation: operation });
  // Build 0126 (native Done): a group of holes only keeps the colour it was given (its parts' colours say nothing: holes are drawn hole grey), and a shape lock is data that must survive.
  const holesOnly = Boolean(context.strict) && parts.length > 0 && parts.every((part) => part.hole);
  const group = canonicalizeShape(carryShapePivot(original, withHoleMode({
    ...rebuilt,
    id: original.id,
    name: original.name,
    color: ownColour || holesOnly ? original.color : rebuilt.color,
    transparent: original.transparent,
    hidden: original.hidden,
    ...(context.strict && original.shapeLocked ? { shapeLocked: true } : {}),
    groupResize: original.groupResize,
    // Multicolor switched on or off stays so after Done; a group cut into one body lost it and turned one colour (#1323).
    ...(typeof original.multicolor === "boolean" ? { multicolor: original.multicolor } : {}),
    // A name tag, icon tag, QR code or SBC board stays one, with its card (Discussion #1692).
    ...groupMarksOf(original),
  }, Boolean(original.hole))));
  // The group's own paint (paint.ts) goes over to the group built again, where it lay in the world.
  if (original.paint?.length && canPaintShape(group)) group.paint = rebasePaintStrokes(original.paint, original, group);
  const mergeWarning = "mergeWarning" in result && typeof result.mergeWarning === "string" ? result.mergeWarning : "";
  return { group, mergeWarning, ...(quality ? { quality } : {}) };
}
