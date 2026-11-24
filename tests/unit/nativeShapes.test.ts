import { describe, expect, it } from "vitest";
import { libraryShapeAssets, shapeAssetColor, shapeAssetMenuLabel } from "@/lib/shapeCatalog";
import { buildNativeShapesCatalog, nativeShapeIdFromTool, nativeShapeTool } from "@/lib/host/nativeShapes";

describe("native Shapes catalogue (Build 0061)", () => {
  const build = (extra: Partial<Parameters<typeof buildNativeShapesCatalog>[0]> = {}) =>
    buildNativeShapesCatalog({
      shapes: libraryShapeAssets,
      label: (shape) => shapeAssetMenuLabel(shape).replace(/\s+/g, " "),
      color: (shape) => shapeAssetColor(shape),
      colors: true,
      recent: [],
      ...extra,
    });

  it("lists every library shape once, with name, relative picture and start colour", () => {
    const catalog = build();
    expect(catalog.shapes.map((shape) => shape.id)).toEqual(libraryShapeAssets.map((shape) => shape.id));
    const box = catalog.shapes.find((shape) => shape.id === "box");
    expect(box).toMatchObject({ icon: "assets/editor/shape-icons-gray/box.png", color: "#d41721" });
    expect(box?.name.length).toBeGreaterThan(0);
    expect(catalog.shapes.every((shape) => !shape.icon.startsWith("/"))).toBe(true);
  });

  it("puts every shape in exactly one section, in the library's order", () => {
    const catalog = build();
    const ids = catalog.sections.flatMap((section) => section.shapeIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(libraryShapeAssets.map((shape) => shape.id).sort());
    expect(catalog.sections[0]?.id).toBe("basic");
    expect(catalog.sections.every((section) => section.label.length > 0)).toBe(true);
  });

  it("sends no colour while Shapes in colour is off", () => {
    expect(build({ colors: false }).shapes.every((shape) => shape.color === null)).toBe(true);
  });

  it("keeps only recently used ids the library still offers", () => {
    const catalog = build({ recent: ["box", "nope", "torus"] });
    expect(catalog.recent).toEqual(["box", "torus"]);
    expect(catalog.recentLabel.length).toBeGreaterThan(0);
  });

  it("round-trips the tool id the host sends back", () => {
    expect(nativeShapeIdFromTool(nativeShapeTool("round-roof"))).toBe("round-roof");
    expect(nativeShapeIdFromTool("add-shape")).toBeNull();
    expect(nativeShapeIdFromTool("shape:")).toBeNull();
  });
});
