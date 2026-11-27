import { buildGroupedShapeOffThread } from "@/lib/geometryWorker";
import { buildHullShapeFromSelection, buildIntersectionShapeFromSelection, groupedShape } from "@/lib/editorBooleans";
import { buildSketchLoftFromSelection } from "@/lib/sketchLoft";
import { carryShapePivot } from "@/lib/rotationPivot";
import { groupMarksOf } from "@/lib/groupMarks";
import { rebasePaintStrokes } from "@/lib/paintMesh";
import { canPaintShape } from "@/lib/paint";
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
 */
export type GroupReconstructionContext = {
  /** The boolean triangle limit in force (workspace setting). */
  triangleLimit: number;
  /** Stops the work when the scene changes under it (page only). */
  signal?: AbortSignal;
};

export type GroupReconstruction = { group: WorkplaneShape; mergeWarning: string } | { group: null; failure: string };

export async function rebuildGroupFromParts(original: WorkplaneShape, parts: WorkplaneShape[], context: GroupReconstructionContext): Promise<GroupReconstruction> {
  const operation = original.groupOperation === "intersection" || original.groupOperation === "hull" || original.groupOperation === "bundle" || original.groupOperation === "loft" ? original.groupOperation : "group";
  const result = operation === "intersection"
    ? await buildIntersectionShapeFromSelection(parts, context.triangleLimit)
    : operation === "hull"
      ? await buildHullShapeFromSelection(parts, context.triangleLimit, { keepHoles: Boolean(original.hullKeepHoles) })
      : operation === "loft"
      ? await buildSketchLoftFromSelection(parts)
      : operation === "bundle"
      ? { group: groupedShape(parts) }
      : await buildGroupedShapeOffThread(parts, context.triangleLimit, context.signal);
  if (!result.group) {
    return { group: null, failure: "failureNotice" in result && result.failureNotice ? result.failureNotice : t("status.groupChanged") };
  }
  // Its colour stays if it had been given one apart from its first part.
  const firstSolid = original.groupedShapes?.find((child) => !child.hole) ?? original.groupedShapes?.[0];
  const ownColour = Boolean(firstSolid && firstSolid.color !== original.color);
  const rebuilt = canonicalizeShape({ ...result.group, groupOperation: operation });
  const group = canonicalizeShape(carryShapePivot(original, withHoleMode({
    ...rebuilt,
    id: original.id,
    name: original.name,
    color: ownColour ? original.color : rebuilt.color,
    transparent: original.transparent,
    hidden: original.hidden,
    groupResize: original.groupResize,
    // Multicolor switched on or off stays so after Done; a group cut into one body lost it and turned one colour (#1323).
    ...(typeof original.multicolor === "boolean" ? { multicolor: original.multicolor } : {}),
    // A name tag, icon tag, QR code or SBC board stays one, with its card (Discussion #1692).
    ...groupMarksOf(original),
  }, Boolean(original.hole))));
  // The group's own paint (paint.ts) goes over to the group built again, where it lay in the world.
  if (original.paint?.length && canPaintShape(group)) group.paint = rebasePaintStrokes(original.paint, original, group);
  const mergeWarning = "mergeWarning" in result && typeof result.mergeWarning === "string" ? result.mergeWarning : "";
  return { group, mergeWarning };
}
