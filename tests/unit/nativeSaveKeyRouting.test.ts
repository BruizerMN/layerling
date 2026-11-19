import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Structural guard: in the native app, Cmd/Ctrl+S must reach the host's File menu. If the page
// handles the key (and calls preventDefault) the menu never fires, and the editor shows the
// Step 4B "cannot be saved" notice instead of saving.
describe("native Save key routing", () => {
  const source = readFileSync("apps/web/src/components/LayerlingEditor.tsx", "utf8");

  it("returns before the editor's own save handler when a native document is open", () => {
    const passthrough = source.indexOf('if (nativeDocument && shortcut && key === "s") return;');
    const browserSave = source.indexOf('if (shortcut && key === "s" && !event.shiftKey && !event.altKey) {');
    expect(passthrough).toBeGreaterThan(0);
    expect(browserSave).toBeGreaterThan(passthrough);
  });

  it("does not call preventDefault between the passthrough and the browser save handler", () => {
    const start = source.indexOf('if (nativeDocument && shortcut && key === "s") return;');
    const end = source.indexOf('if (shortcut && key === "s" && !event.shiftKey && !event.altKey) {');
    expect(source.slice(start, end)).not.toContain("preventDefault");
  });

  it("keeps the browser save handler for the browser build", () => {
    expect(source).toContain("saveDesignRef.current()");
  });
});
