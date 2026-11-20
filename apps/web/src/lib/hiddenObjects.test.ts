import { describe, expect, it } from "vitest";
import { countHiddenObjects, hiddenObjectsLabel } from "./hiddenObjects";

describe("hidden objects", () => {
  it("counts root objects with their own hidden flag; a hidden group counts once", () => {
    const shapes = [
      { id: "a", hidden: true },
      { id: "g", hidden: true, children: [{ id: "g1", hidden: true }, { id: "g2" }] },
      { id: "b" },
    ] as never[];
    expect(countHiddenObjects(shapes)).toBe(2);
    expect(countHiddenObjects([])).toBe(0);
  });
  it("labels singular and plural", () => {
    expect(hiddenObjectsLabel(1)).toBe("1 hidden object");
    expect(hiddenObjectsLabel(3)).toBe("3 hidden objects");
  });
});
