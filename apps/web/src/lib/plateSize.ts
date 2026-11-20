import { displayToMillimeters, formatMeasurementNumber, lengthDisplayUnit, millimetersToDisplay, parseMeasurementInput } from "@/lib/measurementUnits";
import { PLATE_SIZE_MAX_MM, PLATE_SIZE_MIN_MM } from "@/lib/workplaneSettings";
import type { WorkplaneWorkspaceSettings } from "@/types/layerling";

/**
 * The build plate's size as the status bar edits it. The plate IS the workspace's `width` and `depth` (in millimetres, whatever the units shown), and a
 * size typed by hand is no longer a printer's plate: exactly the settings window's semantics (WorkspaceSettingsModal.setDimension). The footer shows and
 * edits it in the document's units; there is no second source of truth, and the change goes through the editor's one workspace update.
 */
type UnitsContext = Pick<WorkplaneWorkspaceSettings, "units" | "scale" | "accuracy">;

export function plateUnitLabel(workspace: UnitsContext): string {
  return lengthDisplayUnit(workspace).label;
}

/** A plate dimension as the document's units show it ("200.00", "7.87"). */
export function formatPlateValue(mm: number, workspace: UnitsContext): string {
  return formatMeasurementNumber(millimetersToDisplay(mm, workspace), workspace.accuracy);
}

/** The compact label of the footer: "200 × 200 mm", "7.87 × 7.87 in" (trailing zeros dropped). */
export function plateSummary(widthMm: number, depthMm: number, workspace: UnitsContext): string {
  const trim = (mm: number) => String(Number(millimetersToDisplay(mm, workspace).toFixed(workspace.accuracy)));
  return `${trim(widthMm)} × ${trim(depthMm)} ${plateUnitLabel(workspace)}`;
}

/** The allowed range in the document's units, for the message and the hint. */
export function plateRange(workspace: UnitsContext): { min: string; max: string; unit: string } {
  return { min: formatPlateValue(PLATE_SIZE_MIN_MM, workspace), max: formatPlateValue(PLATE_SIZE_MAX_MM, workspace), unit: plateUnitLabel(workspace) };
}

export type PlateInput = { ok: true; mm: number } | { ok: false; error: string };

/** One field's text -> millimetres, or why not. Typed values are in the document's units (decimals, fractions and simple arithmetic as everywhere). */
export function parsePlateInput(text: string, workspace: UnitsContext): PlateInput {
  const parsed = parseMeasurementInput(text);
  if (!Number.isFinite(parsed)) return { ok: false, error: "Enter a number" };
  if (parsed <= 0) return { ok: false, error: "Must be more than zero" };
  const mm = displayToMillimeters(parsed, workspace);
  if (mm < PLATE_SIZE_MIN_MM - 1e-9 || mm > PLATE_SIZE_MAX_MM + 1e-9) {
    const range = plateRange(workspace);
    return { ok: false, error: `Use ${range.min}–${range.max} ${range.unit}` };
  }
  return { ok: true, mm };
}

/** The workspace patch for a plate typed by hand (as the settings window writes it). */
export function plateSizePatch(widthMm: number, depthMm: number): Pick<WorkplaneWorkspaceSettings, "width" | "depth" | "sizePreset" | "printer"> {
  return { width: widthMm, depth: depthMm, sizePreset: "Custom", printer: "" };
}
