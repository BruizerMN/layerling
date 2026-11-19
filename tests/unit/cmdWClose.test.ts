import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Cmd+W is the window's Close (the native app's File menu, or the browser tab). The viewport's bare "w" shortcut
// (toggle workplane) used to match it too and call preventDefault, so the native Close never ran.
describe("Cmd+W is left to the window", () => {
  const source = readFileSync("apps/web/src/components/WorkplaneViewport.tsx", "utf8");

  it("only takes the plain W shortcut when Cmd is not held", () => {
    expect(source).toContain('} else if (key === "w" && !event.metaKey) {');
    expect(source).not.toContain('} else if (key === "w") {');
  });
});
