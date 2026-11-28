import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* Build 0126: source-text checks that the engine-level protection and the native-only changes are wired where they must be. */
const root = path.resolve(__dirname, "../../../");
const editor = readFileSync(path.join(root, "apps/web/src/components/LayerlingEditor.tsx"), "utf8");
const reconstruction = readFileSync(path.join(root, "apps/web/src/lib/groupReconstruction.ts"), "utf8");
const slice = (from: string, to: string) => { const a = editor.indexOf(from); return editor.slice(a, editor.indexOf(to, a)); };

describe("Group Editing refuses shape-locked groups at the engine, at every entry point (Build 0126)", () => {
  const open = slice("const openGroupForEditing = useCallback", "// A click on a part in the object list opens its group");
  it("every way into Group Editing goes through openGroupForEditing, which checks the lock before it opens anything", () => {
    const callers = (editor.match(/openGroupForEditing\(/g) ?? []).length;
    // exactly the four known entry points (part click, selected group, MCP open_group, the Objects Sidebar path walker): a fifth must be reviewed against the lock rule
    expect(callers).toBe(4);
    expect(open.indexOf("groupHeld(group)")).toBeGreaterThan(-1);
    expect(open.indexOf("groupHeld(group)")).toBeLessThan(open.indexOf("beginGroupSession()"));
    expect(open.indexOf("groupHeld(group)")).toBeLessThan(open.indexOf("commitOpenGroupTransition("));
    expect(open).toContain('t("status.groupShapeLocked"');
    expect(open).toContain('t("status.objectLocked")');   // a padlocked group keeps its own message; the browser keeps its message too (native-gated wording)
  });
  it("a nested path is checked before ANY group on it opens", () => {
    const along = slice("const openGroupAlongPath = useCallback", "// Property edits on an object inside a CLOSED group");
    expect(along).toContain("firstHeldGroupOnPath(shapesRef.current, rootId, indices, openTarget)");
    expect(along.indexOf("firstHeldGroupOnPath")).toBeLessThan(along.indexOf("openGroupForEditing(groupId"));
  });
  it("the message exists in every catalogue", () => {
    const dir = path.join(root, "apps/web/src/lib");
    const catalogues = readdirSync(dir).filter((name) => /^messages\.[a-z-]+\.ts$/.test(name));
    expect(catalogues.length).toBeGreaterThanOrEqual(20);
    for (const name of catalogues) expect(readFileSync(path.join(dir, name), "utf8"), name).toContain('"status.groupShapeLocked"');
  });
});

describe("visibility flags and exact restoration (Build 0126)", () => {
  const open = slice("const openGroupForEditing = useCallback", "// A click on a part in the object list opens its group");
  it("the open step keeps each part's own hidden flag in the native app only", () => {
    expect(open).toContain("restoreGroupedChildren(group, undefined, nativeDocument ? { keepPartVisibility: true } : undefined)");
  });
  it("an unchanged session is still restored exactly, before any reconstruction", () => {
    const finish = slice("const finishOpenGroup = useCallback", "const groupPartsStepRefused");
    expect(finish.indexOf("openSessionUnchanged(session)")).toBeGreaterThan(-1);
    expect(finish.indexOf("restoreOriginalSession(")).toBeLessThan(finish.indexOf("rebuildGroupFromParts(original, parts"));
    expect(finish).toContain("if (nativeDocument && openSessionUnchanged(session))");
  });
  it("only native Done is strict: hole union, colour and shape-lock carry-through all depend on it", () => {
    expect(editor).toContain("rebuildGroupFromParts(original, parts, Boolean(nativeDocument))");
    expect(reconstruction).toContain("unionHoles: Boolean(context.strict)");
    expect(reconstruction).toContain("Boolean(context.strict) && parts.length > 0 && parts.every((part) => part.hole)");
    expect(reconstruction).toContain("context.strict && original.shapeLocked");
  });
  it("a failed hole union never falls back: the build has no group, and Done refuses", () => {
    const booleans = readFileSync(path.join(root, "apps/web/src/lib/editorBooleans.ts"), "utf8");
    expect(booleans).toContain("const built = holeOnlyUnion\n    ? holeUnionGroup");
    expect(reconstruction).toContain('kind: holeOnly ? "unionFailed" : "cutFailed"');
  });
});
