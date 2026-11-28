import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { trackOpenGroupLevels } from "@/lib/openGroupParts";
import { createVisualGroup, EMPTY_VISUAL_GROUPS, liveObjectIds, membershipMap, moveObjectsToGroup, removeObjectsFromGroups } from "@/lib/visualGroups";
import { notesAfterShapeChange } from "@/lib/noteAnchoring";
import type { WorkplaneNote, WorkplaneShape } from "@/types/layerling";
import { primitive } from "./support";
import { contextToken, contextViolation, editableIds, groupActionAllowed, selectableOnly, trackMembership } from "./editingContextProto";

/*
 * Build 0130, STEP 1 (investigation and failing-first; no production change). Layers: (1) FAILING FIRST against production (`it.fails`): the behaviour the build must add; they flip to plain tests with the
 * implementation. (2) PROTOTYPE tests (plain): the central rule's predicates behave as designed (editingContextProto.ts, test tree only). (3) CENSUS tests of production source (what exists today).
 */
const root = path.resolve(__dirname, "../../../");
const editor = readFileSync(path.join(root, "apps/web/src/components/LayerlingEditor.tsx"), "utf8");
const S = (id: string, extra: Partial<WorkplaneShape> = {}) => primitive(id, "box", extra);
const ids = (xs: readonly WorkplaneShape[]) => xs.map((s) => s.id);

describe("FAILING FIRST: production behaviour 0130 must add", () => {
  it.fails("production trackOpenGroupLevels joins a PURE addition (new, duplicate, paste, import) to the innermost level in native", () => {
    const levels = [["a", "b"]];
    const prev = [S("a"), S("b"), S("out")], next = [...prev, S("new")];
    const native = trackOpenGroupLevels as unknown as (l: ContextLevelsT, p: unknown, n: unknown, o?: { addToInnermost: boolean }) => ContextLevelsT;
    expect(native(levels, prev, next, { addToInnermost: true })[0]).toContain("new");
  });
  it.fails("a production module lib/editingContext exists with editableIds and contextViolation (the central rule)", async () => {
    const mod = await import("@/lib/editingContext" as string);
    expect(typeof mod.editableIds).toBe("function"); expect(typeof mod.contextViolation).toBe("function");
  });
  it.fails("commitShapes refuses a step that changes or removes an object outside the context (source wiring)", () => {
    const commit = editor.slice(editor.indexOf("const commitShapes = useCallback("), editor.indexOf("// Several build plates side by side"));
    expect(commit).toContain("contextViolation(");
  });
  it.fails("selectedIds can hold only editable objects: one choke point (source wiring)", () => {
    expect(editor).toMatch(/selectableOnly\(|editableSelection\(/);
  });
  it.fails("entering Group Editing selects nothing: openGroupForEditing no longer passes the parts as the selection (native)", () => {
    const open = editor.slice(editor.indexOf("const openGroupForEditing = useCallback"), editor.indexOf("// A click on a part in the object list opens its group"));
    expect(open).not.toContain("selectPart !== undefined && childIds[selectPart] ? [childIds[selectPart]] : childIds");
  });
  for (const [name, start] of [["Unhide All (showHidden)", "const showHidden = useCallback("], ["Hide Others (hideOthers)", "const hideOthers = useCallback("], ["Visual Groups Only", "const showOnlyVisualGroupObjects = useCallback("], ["Visual Group lock", "const lockVisualGroup = useCallback("]] as const) {
    it.fails(`${name} is unavailable during Group Editing in the engine (document-wide command)`, () => {
      const at = editor.indexOf(start); const body = editor.slice(at, at + 900);
      expect(body).toMatch(/documentWideBlocked\(|openGroupsRef\.current\.length/);
    });
  }
  it.fails("every asynchronous creator that awaits before it commits carries a fingerprint or a context-token guard (census below lists the gaps)", () => {
    expect(asyncGaps()).toEqual([]);
  });
});

type ContextLevelsT = string[][];

describe("PROTOTYPE: membership, editability, the guard, selection, group actions, the async token", () => {
  const A = S("a"), B = S("b"), C = S("c"), OUT1 = S("o1"), OUT2 = S("o2");
  it("every addition joins the INNERMOST level; a replacing step keeps today's placement; ids stay on the list across Undo", () => {
    const levels = [["a", "b", "inner"], ["c", "d"]];
    const prev = [OUT1, A, B, C, OUT2];
    expect(trackMembership(levels, prev, [...prev, S("new")])).toEqual([["a", "b", "inner"], ["c", "d", "new"]]);        // new/paste/import/duplicate
    expect(trackMembership(levels, prev, [OUT1, A, B, OUT2, S("cut1"), S("cut2")])[1]).toEqual(["c", "cut1", "cut2", "d"]); // c replaced (today's rule)
    expect(trackMembership([], prev, [...prev, S("new")])).toEqual([]);                                                    // no context: nothing
  });
  it("EDITABILITY is membership of the innermost context only, whether the object is visible or not (surroundings and ancestors' other parts are not editable)", () => {
    const levels = [["a", "b", "inner"], ["c", "d"]];
    const present = new Set(["o1", "a", "b", "c", "d", "inner", "o2"]);
    expect([...editableIds(levels, present)!].sort()).toEqual(["c", "d"]);
    expect(editableIds([], present)).toBeNull();
    expect([...editableIds([["x", "gone"]], new Set(["x"]))!]).toEqual(["x"]);     // an id on the list that is absent is nothing
  });
  const members = new Set(["a", "b"]);
  const base = [OUT1, A, B, OUT2];
  it("the guard allows what a context may do: change or remove members, add objects, move members within the list", () => {
    expect(contextViolation(members, base, [OUT1, { ...A, x: 5 }, B, OUT2])).toBeNull();
    expect(contextViolation(members, base, [OUT1, OUT2])).toBeNull();
    expect(contextViolation(members, base, [OUT1, A, B, OUT2, S("new")])).toBeNull();
    expect(contextViolation(members, base, [OUT1, B, A, OUT2])).toBeNull();
  });
  it("the guard refuses a changed, removed or reordered surrounding, with no inference: exemptions are passed explicitly; no context = no restriction", () => {
    expect(contextViolation(members, base, [{ ...OUT1, hidden: true }, A, B, OUT2])).toEqual({ kind: "changed", id: "o1" });   // Unhide All / Hide Others style
    expect(contextViolation(members, base, [{ ...OUT1, name: "x" }, A, B, OUT2])).toEqual({ kind: "changed", id: "o1" });       // rename
    expect(contextViolation(members, base, [OUT1, A, B])).toEqual({ kind: "removed", id: "o2" });
    expect(contextViolation(members, base, [OUT2, A, B, OUT1])).toMatchObject({ kind: "reordered" });
    expect(contextViolation(members, base, [{ ...OUT1, hidden: true }, A, B, OUT2], true)).toBeNull();                          // transition/history: caller-declared
    expect(contextViolation(null, base, [])).toBeNull();
  });
  it("a locked or shape-locked MEMBER is still refused by the existing lock rules (the guard decides nothing about members)", () => {
    expect(contextViolation(members, [{ ...A, locked: true }, OUT1], [{ ...A, locked: true, x: 9 }, OUT1])).toBeNull();
  });
  it("selection can only hold editable objects, Select All and Invert included (they inherit the filter)", () => {
    expect(selectableOnly(members, ["o1", "a", "b", "o2"])).toEqual(["a", "b"]);
    expect(selectableOnly(null, ["o1", "a"])).toEqual(["o1", "a"]);
  });
  it("Q9: a group-level action is all or nothing", () => {
    expect(groupActionAllowed(members, ["a", "b"])).toBe(true);
    expect(groupActionAllowed(members, ["a", "o1"])).toBe(false);
    expect(groupActionAllowed(null, ["o1"])).toBe(true);
  });
  it("the async token differs across a session end, a new session and a nested open (so an operation started elsewhere is refused)", () => {
    expect(contextToken("s1", "g")).toBe(contextToken("s1", "g"));
    expect(new Set([contextToken(null, null), contextToken("s1", "g"), contextToken("s1", "g2"), contextToken("s2", "g")]).size).toBe(4);
  });
});

describe("CENSUS (production source today)", () => {
  it("the direct `setShapes(` writers are exactly the ten classified in docs/BUILD-0130-STEP1-FINDINGS.md (a new one must be classified first)", () => {
    const sites = [...editor.matchAll(/\bsetShapes\(/g)].length;
    expect(sites).toBe(10);
  });
  it("Visual Groups operations are context-blind today: any object id can be assigned or removed (characterization)", () => {
    const { registry, id } = createVisualGroup(EMPTY_VISUAL_GROUPS, { name: "V" });
    const withOutside = moveObjectsToGroup(registry, ["outside"], id);
    expect(membershipMap(withOutside, liveObjectIds([S("outside")])).get("outside")).toBe(id);
    expect(membershipMap(removeObjectsFromGroups(withOutside, ["outside"]), liveObjectIds([S("outside")])).has("outside")).toBe(false);
  });
  it("a note pinned to an object outside the context is not touched by a step that only changes members; a note on a removed member is freed where it stood", () => {
    const outside = S("o1", { x: 40 }), member = S("m1");
    const pinned = (shapeId: string): WorkplaneNote => ({ id: `n-${shapeId}`, text: "t", x: 1, y: 1, z: 1, anchor: { shapeId, normalized: [0.5, 0.5, 0.5] } } as WorkplaneNote);
    const notes = [pinned("o1"), pinned("m1")];
    const after = notesAfterShapeChange(notes, [outside, member], [outside]);
    expect(after.find((n) => n.id === "n-o1")).toBe(notes[0]);
    expect(after.find((n) => n.id === "n-m1")!.anchor).toBeUndefined();
  });
});

/** The async census: every `async` editor callback that commits and awaits BEFORE its first commit, with no fingerprint/context guard (the script of the findings). */
function asyncGaps(): string[] {
  const lines = editor.split("\n");
  const starts = lines.flatMap((l, i) => (/^  const \w+ = (useCallback\()?async/.test(l) ? [i] : []));
  const heads = lines.flatMap((l, i) => (/^  (const \w+ = |\w+Ref\.current = )/.test(l) ? [i] : []));
  const gaps: string[] = [];
  for (const s of starts) {
    const e = heads.find((h) => h > s) ?? s + 200;
    const body = lines.slice(s, e).join("\n");
    const commit = body.search(/commitShapes\(|setShapes\(|commitOpenGroupTransition\(/);
    if (commit < 0) continue;
    if (/ourceFingerprint|changed\(\)|stillWanted|sceneUnchanged|contextToken|sameEditingContext/.test(body)) continue;
    if (body.slice(0, commit).includes("await ")) gaps.push(lines[s].trim().split(" ")[1]);
  }
  return gaps;
}
describe("CENSUS: asynchronous creators that can complete in another context", () => {
  it("lists the unguarded ones (information; the failing-first test above demands none)", () => {
    const gaps = asyncGaps();
    console.info(`[0130 async census] ${gaps.length} unguarded: ${gaps.join(", ")}`);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps).toContain("importFiles"); expect(gaps).toContain("pasteShape");
  });
  it("the geometry tools are already protected: they capture projectShapesFingerprint(shapesRef.current) and refuse when it changed, and opening or closing a context always changes it (the group is flattened)", () => {
    expect(editor).toContain("const sourceFingerprint = projectShapesFingerprint(shapesRef.current);");
    expect(editor).toContain("projectShapesFingerprint(shapesRef.current) !== sourceFingerprint");
    expect(editor).toContain("openGroupsRef.current.at(-1) !== session");
  });
  it("entry into an unrelated context is already refused in the engine (navigation cannot open an unrelated group)", () => {
    const open = editor.slice(editor.indexOf("const openGroupForEditing = useCallback"), editor.indexOf("// A click on a part in the object list opens its group"));
    expect(open).toContain("innermost && !innermost.childIds.includes(id)");
  });
  void ids;
});
