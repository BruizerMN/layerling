import { describe, expect, it } from "vitest";
import { RIBBON_ICON_ALIASES, RIBBON_ICON_KEYS } from "./ribbonIconCatalog";
import { normalizeRibbonIcons, ribbonIconKey } from "./ribbonIcons";

describe("ribbon icon catalog", () => {
  it("has the 63 canonical keys, once each", () => {
    expect(RIBBON_ICON_KEYS.length).toBe(63);
    expect(new Set(RIBBON_ICON_KEYS).size).toBe(63);
    for (const key of RIBBON_ICON_KEYS) expect(key).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
  it("keeps the Build 0024 sketch clipboard names as aliases of the canonical artwork", () => {
    expect(RIBBON_ICON_ALIASES).toEqual({ "sketch-copy": "copy", "sketch-paste": "paste", "sketch-duplicate": "duplicate", "sketch-delete": "delete", "sketch-undo": "undo", "sketch-redo": "redo" });
    for (const target of Object.values(RIBBON_ICON_ALIASES)) expect(RIBBON_ICON_KEYS).toContain(target);
    for (const alias of Object.keys(RIBBON_ICON_ALIASES)) expect(RIBBON_ICON_KEYS).not.toContain(alias);
  });
});

describe("ribbon icon keys", () => {
  it("are the tool id in kebab case, independent of the ribbon", () => {
    expect(ribbonIconKey("copy")).toBe("copy");
    expect(ribbonIconKey("cutOut")).toBe("cut-out");
    expect(ribbonIconKey("loftSketches")).toBe("loft-sketches");
    expect(ribbonIconKey("clearance-check")).toBe("clearance-check");
    expect(ribbonIconKey("holePattern")).toBe("hole-pattern");
    expect(ribbonIconKey("print-check")).toBe("print-check");
    expect(ribbonIconKey("add-shape")).toBe("add-shape");
  });
  it("map a legacy tool id to its canonical key, so one file serves both ribbons", () => {
    expect(ribbonIconKey("sketch-copy")).toBe("copy");
    expect(ribbonIconKey("sketch-delete")).toBe("delete");
    expect(ribbonIconKey("chamfer")).toBe("chamfer");   // Chamfer is one icon in the modelling and the sketch ribbon
  });
  it("accept only canonical keys and the host's own addresses", () => {
    const ok = "layerling://app/__host__/ribbon-icon/copy.svg?v=1";
    expect(normalizeRibbonIcons({ copy: ok })).toEqual({ copy: ok });
    expect(normalizeRibbonIcons({ "sketch-copy": ok, "not-an-icon": ok })).toEqual({});
    expect(normalizeRibbonIcons({ copy: "https://example.com/x.svg", "Bad Key": ok, "../x": ok, cut: 4 })).toEqual({});
    expect(normalizeRibbonIcons(null)).toEqual({});
    expect(normalizeRibbonIcons("copy")).toEqual({});
  });
});
