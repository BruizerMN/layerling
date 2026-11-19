import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The native app's document window already shows the name (Save As renames), so the toolbar's project-name editor is hidden
// there. The browser edition keeps it. The empty wrapper stays: it is the flexible spacer that keeps the toolbar actions right.
describe("project-name editor in the native app", () => {
  const toolbar = readFileSync("apps/web/src/components/workplane/SecondaryToolbar.tsx", "utf8");
  const editor = readFileSync("apps/web/src/components/LayerlingEditor.tsx", "utf8");

  it("is hidden exactly when a native document is open", () => {
    expect(editor).toContain("hideProjectName={Boolean(nativeDocument)}");
  });

  it("defaults to shown, so the browser edition is unchanged", () => {
    expect(toolbar).toContain("hideProjectName = false,");
  });

  it("hides the field in the title row and the focus-mode bar", () => {
    expect(toolbar).toContain("{hideProjectName ? null : <ProjectNameField projectName={projectName} onProjectNameChange={onProjectNameChange} />}");
    expect(toolbar).toContain("nameField={hideProjectName ? undefined : <ProjectNameField");
  });

  it("keeps the flexible wrapper so the toolbar actions do not shift left", () => {
    expect(toolbar).toMatch(/<div className="toolbar-project-name">\s*\{hideProjectName/);
  });
});
