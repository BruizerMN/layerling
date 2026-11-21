import { describe, expect, it } from "vitest";
import { normalizeRibbonIcons, ribbonIconKey } from "./ribbonIcons";

describe("ribbon icon keys", () => {
  it("are the tool id in kebab case, independent of the ribbon", () => {
    expect(ribbonIconKey("copy")).toBe("copy");
    expect(ribbonIconKey("cutOut")).toBe("cut-out");
    expect(ribbonIconKey("loftSketches")).toBe("loft-sketches");
    expect(ribbonIconKey("clearance-check")).toBe("clearance-check");
    expect(ribbonIconKey("holePattern")).toBe("hole-pattern");
    expect(ribbonIconKey("print-check")).toBe("print-check");
  });
  it("accept only the host's own addresses", () => {
    const ok = "layerling://app/__host__/ribbon-icon/copy.svg?v=1";
    expect(normalizeRibbonIcons({ copy: ok })).toEqual({ copy: ok });
    expect(normalizeRibbonIcons({ copy: "https://example.com/x.svg", "Bad Key": ok, "../x": ok, cut: 4 })).toEqual({});
    expect(normalizeRibbonIcons(null)).toEqual({});
    expect(normalizeRibbonIcons("copy")).toEqual({});
  });
});
