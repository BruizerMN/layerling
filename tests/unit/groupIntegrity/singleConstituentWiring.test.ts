import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* Build 0129: source-text checks that the new behaviour is native-only and wired where the browser keeps its old one. */
const root = path.resolve(__dirname, "../../../");
const editor = readFileSync(path.join(root, "apps/web/src/components/LayerlingEditor.tsx"), "utf8");
const reconstruction = readFileSync(path.join(root, "apps/web/src/lib/groupReconstruction.ts"), "utf8");
const booleans = readFileSync(path.join(root, "apps/web/src/lib/editorBooleans.ts"), "utf8");
const slice = (from: string, to: string) => { const a = editor.indexOf(from); return editor.slice(a, editor.indexOf(to, a)); };
const finish = slice("const finishOpenGroup = useCallback", "/** Why a part cannot go into or out of a group from the object list");

describe("finishOpenGroup (Build 0129)", () => {
  it("native: an emptied group is removed (no message), through the session's one history step; the browser keeps its dissolve for fewer than two", () => {
    expect(finish).toContain("if (nativeDocument && parts.length === 0)");
    expect(finish).toContain("if (parts.length < 2 && !nativeDocument)");
    const removal = finish.slice(finish.indexOf("if (nativeDocument && parts.length === 0)"), finish.indexOf("if (parts.length < 2 && !nativeDocument)"));
    expect(removal).toContain("endOpenGroupLevelsWithoutStep(outer)");           // outermost: endGroupSession("done") = one document step
    expect(removal).toContain("childIds.filter((id) => id !== original.id)");     // a removed inner group leaves its parent's list (the parent may now be empty and stays open)
    expect(removal).not.toContain("setNotice");
  });
  it("one constituent goes through the strict reconstruction like any group", () => {
    expect(finish).toContain("rebuildGroupFromParts(original, parts, Boolean(nativeDocument), session.openedParts)");
  });
});

describe("the emptied-context rule is native-only", () => {
  it("the level effect passes keepEmpty only for the native document", () => {
    expect(editor).toContain("{ keepEmpty: Boolean(nativeDocument) },");
  });
});

describe("the general builders still need two (the Group command is unchanged)", () => {
  it("groupedShape refuses fewer than two; the one-part group is a separate export used only by the strict reconstruction", () => {
    expect(booleans).toMatch(/export function groupedShape\(selection[^]*?groupable\.length < 2/);
    expect(reconstruction).toContain("const single = Boolean(context.strict) && parts.length === 1;");
    expect(reconstruction).toContain("if (context.strict && parts.length === 0) return { group: null, failure: \"\", removed: true };");
    expect(editor).not.toContain("groupedShapeOfOne");
    expect(booleans).toContain("allowSingle");
  });
});
