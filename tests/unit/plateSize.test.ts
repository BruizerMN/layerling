import { describe, expect, it } from "vitest";
import { formatPlateValue, parsePlateInput, plateRange, plateSizePatch, plateSummary, plateUnitLabel } from "@/lib/plateSize";
import { DEFAULT_WORKPLANE_WORKSPACE, PLATE_SIZE_MAX_MM, PLATE_SIZE_MIN_MM, normalizeWorkspaceSettings } from "@/lib/workplaneSettings";

const metric = normalizeWorkspaceSettings({ units: "Metric (Default)", accuracy: 2 });
const imperial = normalizeWorkspaceSettings({ units: "Imperial", accuracy: 2, inchFormat: "decimal" });

describe("the footer's build plate editor uses the document's units", () => {
  it("shows the plate in mm or inches, whichever the document uses", () => {
    expect(plateUnitLabel(metric)).toBe("mm");
    expect(plateUnitLabel(imperial)).toBe("in");
    expect(plateSummary(200, 250, metric)).toBe("200 × 250 mm");
    expect(plateSummary(254, 304.8, imperial)).toBe("10 × 12 in");
    expect(plateSummary(200, 200, imperial)).toBe("7.87 × 7.87 in");
    expect(formatPlateValue(200, metric)).toBe("200.00");
  });

  it("reads typed values in the document's units and returns millimetres", () => {
    expect(parsePlateInput("250", metric)).toEqual({ ok: true, mm: 250 });
    expect(parsePlateInput("10", imperial)).toMatchObject({ ok: true });
    expect((parsePlateInput("10", imperial) as { mm: number }).mm).toBeCloseTo(254, 6);
    expect(parsePlateInput("100,5", metric)).toEqual({ ok: true, mm: 100.5 });
  });

  it("refuses anything that is not a positive number inside the plate range, and says why", () => {
    for (const bad of ["", "abc", "-5", "0", "  "]) expect(parsePlateInput(bad, metric).ok).toBe(false);
    expect(parsePlateInput("", metric)).toEqual({ ok: false, error: "Enter a number" });
    expect(parsePlateInput("-5", metric)).toEqual({ ok: false, error: "Must be more than zero" });
    const low = parsePlateInput(String(PLATE_SIZE_MIN_MM - 1), metric);
    const high = parsePlateInput(String(PLATE_SIZE_MAX_MM + 1), metric);
    expect(low).toEqual({ ok: false, error: `Use ${plateRange(metric).min}–${plateRange(metric).max} mm` });
    expect(high.ok).toBe(false);
    // the edges themselves are fine (the settings window's own limits)
    expect(parsePlateInput(String(PLATE_SIZE_MIN_MM), metric).ok).toBe(true);
    expect(parsePlateInput(String(PLATE_SIZE_MAX_MM), metric).ok).toBe(true);
    // inches: the same limits, expressed in inches
    expect(parsePlateInput("1", imperial)).toEqual({ ok: false, error: `Use ${plateRange(imperial).min}–${plateRange(imperial).max} in` });
    expect(plateRange(imperial).min).toBe("2.36");
  });

  it("a plate typed by hand is no longer a printer's plate, exactly as in the settings window", () => {
    expect(plateSizePatch(250, 300)).toEqual({ width: 250, depth: 300, sizePreset: "Custom", printer: "" });
    const next = normalizeWorkspaceSettings({ ...DEFAULT_WORKPLANE_WORKSPACE, printer: "some-printer", ...plateSizePatch(250, 300) });
    expect([next.width, next.depth, next.printer, next.sizePreset]).toEqual([250, 300, "", "Custom"]);
  });
});
