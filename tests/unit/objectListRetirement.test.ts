import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UI_COMMANDS } from "@/lib/host/hostProtocol";

// Build 0120: the floating Objects List is retired in the Mac app (a native document) and kept for the browser. These checks read the sources (the editor is too large to mount in a unit test),
// like viewBarSuppression: the suppression is gated on `nativeDocument`, redirects every entry point to the host's Objects tab, and removes nothing.
const editor = readFileSync(path.join(__dirname, "../../apps/web/src/components/LayerlingEditor.tsx"), "utf8");

describe("the floating Objects List in the native app", () => {
  it("is not rendered for a native document, and still rendered for the browser", () => {
    expect(editor).toContain("const objectListRetired = Boolean(nativeDocument);");
    expect(editor).toContain("{outlinerOpen && !objectListRetired ? (");
    expect(editor).toContain("<ObjectListPanel");   // the panel is kept for the browser edition
  });
  it("asks the host for its Objects tab instead of toggling the panel, and the browser still toggles it", () => {
    const toggle = editor.slice(editor.indexOf("const toggleOutliner = useCallback"), editor.indexOf("const toggleShapeLockById"));
    expect(toggle).toContain('requestHostAction("toggleObjectsTab")');
    expect(toggle).toContain("setOutlinerOpen((open) => !open)");
    expect(toggle.indexOf("objectListRetired")).toBeLessThan(toggle.indexOf("setOutlinerOpen"));
  });
  it("the page's own key goes through the same redirect", () => {
    const keyAt = editor.indexOf('if (shortcut && (key === "o" || key === "O") && event.shiftKey) {');
    expect(keyAt).toBeGreaterThan(0);
    expect(editor.slice(keyAt, keyAt + 200)).toContain("toggleOutliner();");
  });
  it("the shared command and its handler remain (the browser and older hosts use them)", () => {
    expect((UI_COMMANDS as readonly string[]).includes("view.objectList")).toBe(true);
    expect(editor).toContain("useRememberedFlag(\"layerling.editor.objectListOpen\")");
  });
});
