import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { activationChanged, carryProtected, contextChain, contextViolation, editableIds, groupActionAllowed, notesViolation, onlyEditable, prepareContextCommit, sameShapeData, trackContextMembership } from "@/lib/editingContext";
import { buildObjectRows } from "@/lib/objectsSnapshot";
import { trackOpenGroupLevels } from "@/lib/openGroupParts";
import { canonicalizeShape } from "@/lib/workplaneShapes";
import type { WorkplaneNote, WorkplaneShape } from "@/types/layerling";
import { primitive } from "./support";

/*
 * Build 0130 (production verification; Step 1's failing-first tests, now passing). Layers, as in the findings: P = production modules run as they are; S = source-text census of LayerlingEditor.tsx / the viewport (the editor
 * itself cannot be run headlessly); I = interactive acceptance (docs/BUILD-0130.md).
 */
const root = path.resolve(__dirname, "../../../");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const editor = read("apps/web/src/components/LayerlingEditor.tsx");
const viewport = read("apps/web/src/components/WorkplaneViewport.tsx");
const slice = (from: string, to: string) => { const a = editor.indexOf(from); expect(a, from).toBeGreaterThan(-1); return editor.slice(a, editor.indexOf(to, a)); };
const S = (id: string, extra: Partial<WorkplaneShape> = {}) => primitive(id, "box", extra);
const commit = slice("const commitShapes = useCallback(", "// Several build plates side by side");

describe("P: membership (central rule, native) and the browser's unchanged default", () => {
  const levels = [["a", "b", "inner"], ["c", "d"]];
  const prev = [S("o1"), S("a"), S("b"), S("c"), S("o2")];
  it("every ADDITION (new, duplicate, paste, import, any future tool) joins the innermost level", () => {
    expect(trackContextMembership(levels, prev, [...prev, S("new")])).toEqual([["a", "b", "inner"], ["c", "d", "new"]]);
    expect(trackContextMembership(levels, prev, [...prev, S("n1"), S("n2")])[1]).toEqual(["c", "d", "n1", "n2"]);
  });
  it("a step that removes a part keeps today's placement rule; an unrelated additions-free step changes nothing", () => {
    expect(trackContextMembership(levels, prev, [S("o1"), S("a"), S("b"), S("o2"), S("cut1"), S("cut2")])[1]).toEqual(["c", "cut1", "cut2", "d"]);
    expect(trackContextMembership(levels, prev, prev)).toBe(levels);
  });
  it("nested: new objects go to the innermost level only; the outer level is untouched", () => {
    const out = trackContextMembership(levels, prev, [...prev, S("x")]);
    expect(out[0]).toEqual(["a", "b", "inner"]);
  });
  it("no context: nothing is tracked; WITHOUT the option (the browser) a pure addition adds nobody, exactly as before", () => {
    expect(trackContextMembership([], prev, [...prev, S("x")])).toEqual([]);
    expect(trackOpenGroupLevels(levels, prev, [...prev, S("new")])).toBe(levels);
  });
  it("an emptied context (every part deleted) takes new objects: the 0129 limitation ends", () => {
    expect(trackContextMembership([["gone"]], [S("o1")], [S("o1"), S("fresh")])).toEqual([["gone", "fresh"]]);
  });
});

describe("P: editability, selection, group actions", () => {
  const levels = [["a", "b", "inner"], ["c", "d"]];
  const present = new Set(["o1", "a", "b", "c", "d", "inner", "o2"]);
  it("only the innermost level's members are editable: ancestors' other parts are surroundings; visibility never grants it", () => {
    expect([...editableIds(levels, present)!].sort()).toEqual(["c", "d"]);
    expect(editableIds([], present)).toBeNull();
    expect([...editableIds([["x", "gone"]], new Set(["x"]))!]).toEqual(["x"]);
  });
  it("selection holds only members (Select All, Invert, marquee, Sidebar, Visual Groups and MCP share the rule)", () => {
    const members = editableIds(levels, present);
    expect(onlyEditable(members, ["o1", "c", "a", "d"])).toEqual(["c", "d"]);
    expect(onlyEditable(null, ["o1", "a"])).toEqual(["o1", "a"]);
  });
  it("a group-level action is all or nothing", () => {
    const members = editableIds(levels, present);
    expect(groupActionAllowed(members, ["c", "d"])).toBe(true);
    expect(groupActionAllowed(members, ["c", "o1"])).toBe(false);
    expect(groupActionAllowed(null, ["o1"])).toBe(true);
  });
});

describe("P: the commit guard and the pipeline (surroundings unchanged after the ENTIRE pipeline)", () => {
  const A = S("a"), B = S("b"), O1 = S("o1"), O2 = S("o2");
  const members = new Set(["a", "b"]);
  const base = [O1, A, B, O2];
  it("allows what a context may do: change or remove members, add objects, reorder members", () => {
    expect(contextViolation(members, base, [O1, { ...A, x: 5 }, B, O2])).toBeNull();
    expect(contextViolation(members, base, [O1, O2])).toBeNull();
    expect(contextViolation(members, base, [O1, A, B, O2, S("new")])).toBeNull();
    expect(contextViolation(members, base, [O1, B, A, O2])).toBeNull();
  });
  it("refuses a changed, removed or reordered surrounding (rename, hide, lock, delete, bulk commands, reorder); no context: no restriction", () => {
    expect(contextViolation(members, base, [{ ...O1, hidden: true }, A, B, O2])).toEqual({ kind: "changed", id: "o1" });
    expect(contextViolation(members, base, [{ ...O1, name: "x" }, A, B, O2])).toEqual({ kind: "changed", id: "o1" });
    expect(contextViolation(members, base, [O1, A, B])).toEqual({ kind: "removed", id: "o2" });
    expect(contextViolation(members, base, [O2, A, B, O1])).toMatchObject({ kind: "reordered" });
    expect(contextViolation(null, base, [])).toBeNull();
  });
  it("a recreated-but-equal surrounding (a tool's spread copy) is not a violation; a recreated-and-different one is", () => {
    expect(contextViolation(members, base, [{ ...O1 }, A, B, { ...O2 }])).toBeNull();
    expect(sameShapeData(O1, { ...O1, x: 1 })).toBe(false);
  });
  it("PRODUCTION PIPELINE: protected, NON-CANONICAL surroundings are carried forward by their existing reference; canonicalization never recreates or alters them", () => {
    const odd = S("odd", { rotation: 0.004, width: 10.00004 });
    expect(canonicalizeShape(odd)).not.toEqual(odd);                                  // canonicalization WOULD change it (non-canonical stored data)
    const prev = [odd, A, B];
    const edited = prev.map((shape) => (shape.id === "a" ? { ...shape, x: 3.333333 } : shape));
    const out = prepareContextCommit(members, prev, edited, canonicalizeShape);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.shapes[0]).toBe(odd);                                                   // the same reference: untouched by the whole pipeline
    expect(out.shapes[1]).toEqual(canonicalizeShape(edited[1]));                       // members are canonicalized as always
    expect(prepareContextCommit(null, prev, edited, canonicalizeShape)).toMatchObject({ ok: true });   // no context: today's behaviour
    expect((prepareContextCommit(null, prev, edited, canonicalizeShape) as { shapes: WorkplaneShape[] }).shapes[0]).not.toBe(odd);
  });
  it("a refused step reports why and carries nothing forward", () => {
    expect(prepareContextCommit(members, base, [{ ...O1, locked: true }, A, B, O2], canonicalizeShape)).toEqual({ ok: false, violation: { kind: "changed", id: "o1" } });
  });
  it("carryProtected keeps new objects canonicalized", () => {
    const fresh = S("fresh", { rotation: 0.004 });
    const out = carryProtected(members, base, [...base, fresh], canonicalizeShape);
    expect(out[4]).toEqual(canonicalizeShape(fresh));
  });
});

describe("P: the activation of an editing context (N2) and associated state (N3)", () => {
  it("the activation changes on EVERY transition of the chain, including returning to a previously active context", () => {
    const L = (...ids: string[]) => ids.map((id) => ({ original: { id } }));
    let generation = 0; let chain = contextChain(L());
    const step = (levels: ReturnType<typeof L>) => { const next = contextChain(levels); if (next !== chain) generation += 1; chain = next; };
    step(L("A")); const started = generation;                                         // enter A, start an import
    step(L("A", "B")); step(L("A"));                                                   // enter B, finish B: back in A
    expect(contextChain(L("A"))).toBe("A");                                           // same session, same group id ...
    expect(activationChanged(started, generation)).toBe(true);                         // ... a different activation
    expect(activationChanged(generation, generation)).toBe(false);
    step(L()); expect(activationChanged(started, generation)).toBe(true);              // Cancel/Done: also different
  });
  it("notes attached to surroundings cannot be changed, removed, detached, reassigned or created; members', free and the open group's own can", () => {
    const note = (id: string, shapeId?: string): WorkplaneNote => ({ id, text: id, x: 0, y: 0, z: 0, ...(shapeId ? { anchor: { shapeId, normalized: [0.5, 0.5, 0.5] } } : {}) }) as WorkplaneNote;
    const members = new Set(["m"]); const present = new Set(["m", "o"]);
    const before = [note("n-o", "o"), note("n-m", "m"), note("n-free"), note("n-open", "openGroup")];
    expect(notesViolation(members, present, before, [...before, note("n-new")])).toBeNull();                       // a free note
    expect(notesViolation(members, present, before, before.map((n) => (n.id === "n-m" ? { ...n, text: "edited" } : n)))).toBeNull();   // a member's
    expect(notesViolation(members, present, before, before.map((n) => (n.id === "n-open" ? { ...n, text: "edited" } : n)))).toBeNull(); // the open group's own (absent while open)
    expect(notesViolation(members, present, before, before.map((n) => (n.id === "n-o" ? { ...n, text: "x" } : n)))).toBe("n-o");        // modified
    expect(notesViolation(members, present, before, before.filter((n) => n.id !== "n-o"))).toBe("n-o");                                // removed
    expect(notesViolation(members, present, before, before.map((n) => (n.id === "n-o" ? { id: n.id, text: n.text, x: 0, y: 0, z: 0 } as WorkplaneNote : n)))).toBe("n-o"); // detached
    expect(notesViolation(members, present, before, before.map((n) => (n.id === "n-free" ? { ...n, anchor: { shapeId: "o", normalized: [0, 0, 0] } } as WorkplaneNote : n)))).toBe("n-free");   // attached to a surrounding
    expect(notesViolation(null, present, before, [])).toBeNull();
  });
  it("the Objects Sidebar rows carry `outside` for every live object that is not a member of the innermost context", () => {
    const g = S("g"), o = S("o"), a = S("a"), b = S("b"), other = S("c");
    const rows = buildObjectRows([o, a, b, other], (s) => s.id, [{ original: g, childIds: ["a", "b"] }])!;
    const flat: Record<string, boolean | undefined> = {};
    const walk = (list: typeof rows) => list.forEach((r) => { flat[r.id] = r.outside; if (r.items) walk(r.items); });
    walk(rows);
    expect(flat).toMatchObject({ o: true, c: true });
    expect(flat.a).toBeUndefined(); expect(flat.b).toBeUndefined();
    expect(buildObjectRows([o, a], (s) => s.id, [])!.every((r) => r.outside === undefined)).toBe(true);   // nothing open: no flag
  });
});

describe("S: the editor's wiring (source census; native-only; one refusal mechanism)", () => {
  it("N1: commitShapes returns a boolean; every refusal marks the commit as refused and returns false; the context guard runs BEFORE canonicalization and surroundings are carried by reference", () => {
    expect(commit).toContain("): boolean => {");
    const returnsFalse = (commit.match(/return false;/g) ?? []).length;
    const marks = (commit.match(/markCommit\(false\);/g) ?? []).length;
    expect(returnsFalse).toBe(3);                                         // history view, context protection, shape lock: the one mechanism
    expect(marks).toBe(3);                                                // each of them drops the queued associated state
    expect(commit.indexOf("prepareContextCommit(")).toBeGreaterThan(-1);
    expect(commit.indexOf("prepareContextCommit(")).toBeLessThan(commit.indexOf("shapeLockBroken("));   // the lock rule stays independent, applied to what will be stored
    expect(commit).toContain("for (const apply of markCommit(true)) apply();");
  });
  it("N1: associated state that accompanies a commit is queued and applied only on success (every Visual Groups placement helper)", () => {
    for (const name of ["placeMergeResult", "placeDerived", "placeReplacement", "placeCopies"]) {
      const at = editor.indexOf(`const ${name} = useCallback(`);
      expect(at, name).toBeGreaterThan(-1);
      expect(editor.slice(at, at + 520), name).toContain("afterCommit(");
    }
    // no raw Visual Groups write sits directly beside a commit any more: the three helpers are the only writers next to commits
    expect(editor).not.toMatch(/placeDerived\(\[\[group\.id[^\n]*\n[^\n]*updateVisualGroups\(/);
  });
  it("N1: the Visual Groups containers cannot be changed while a group is being edited (not part of the session's Undo/Cancel), and group-level actions are all or nothing", () => {
    const ops = slice("const visualGroupOps = useMemo(", "const visualGroupOpsRef = useRef(visualGroupOps)");
    for (const op of ["create:", "rename:", "delete:", "moveGroup:", "moveObjects:", "removeObjects:", "moveItems:"]) expect(ops.slice(ops.indexOf(op), ops.indexOf(op) + 260), op).toContain("refuseWholeDesign()");
    for (const fn of ["toggleVisualGroupVisibility", "lockVisualGroup"]) expect(slice(`const ${fn} = useCallback(`, "}, [commitShapes"), fn).toContain("refuseNonMembers(");
    expect(slice("const toggleVisualObjectLock = useCallback(", "}, [commitShapes")).toContain("refuseNonMembers([id])");
  });
  it("selection: ONE gated setter; the direct ref writes are gated; entry selects nothing (native)", () => {
    expect(editor).toContain("const [selectedIds, setSelectedIdsState] = useState<string[]>([]);");
    expect(slice("const setSelectedIds = useCallback(", "/** A command that changes")).toContain("gateSelectionIds(wanted)");
    expect((editor.match(/selectedIdsRef\.current = gateSelectionIds\(validIds\);/g) ?? []).length).toBe(4);
    const open = slice("const openGroupForEditing = useCallback", "// A click on a part in the object list opens its group");
    expect(open).toContain("nativeDocument ? [] : selectPart !== undefined");
  });
  it("document-wide commands are unavailable during Group Editing in the engine (before anything is read or written)", () => {
    for (const [name, start] of [["showHidden", "const showHidden = useCallback("], ["hideOthers", "const hideOthers = useCallback("], ["showOnlyVisualGroupObjects", "const showOnlyVisualGroupObjects = useCallback("], ["focusVisualGroup", "const focusVisualGroup = useCallback("]] as const) {
      const at = editor.indexOf(start); expect(at, name).toBeGreaterThan(-1);
      expect(editor.slice(at, at + 330), name).toContain("refuseWholeDesign()");
    }
    const plates = read("apps/web/src/components/workplane/useBuildPlates.ts");
    for (const fn of ["const add = useCallback", "const rename = useCallback", "const move = useCallback", "const remove = useCallback", "const arrange = useCallback"]) expect(plates.slice(plates.indexOf(fn), plates.indexOf(fn) + 260), fn).toContain("refuseWholeDesign?.()");
    expect(slice("const updateProjectWorkspaceSettings = useCallback(", "const workspaceBefore")).toContain("platePitch(workspaceSettingsRef.current) !== platePitch(nextWorkspace) && refuseWholeDesign()");
  });
  it("N6: a transition of the chain (and only that) ends the modeling tools and the interrupted drag; every tool state is covered (permanent census)", () => {
    const setter = slice("const setOpenGroupLevels = useCallback(", "/** The activation an asynchronous operation starts in");
    expect(setter).toContain("contextChain(openGroupsRef.current) !== contextChain(levels)");
    expect(setter).toContain("endModelingToolsRef.current();");
    expect(setter).toContain("changed && nativeDocument");
    const end = slice("const endModelingTools = useCallback(", "endModelingToolsRef.current = endModelingTools;");
    expect(end).toContain("interactionStartShapesRef.current = null;");        // cancelInteraction can no longer restore a snapshot of the previous context
    // every `[xTool, setXTool]`-like state of the editor is reset there (allow-list: view modes and sketch state that are not modeling tools)
    const states = [...editor.matchAll(/const \[\w+, (set\w*(?:Tool|Preview|Session|Pick|Draw|Region|Mode|ToolId)\w*)\] = useState/g)].map((m) => m[1]);
    const exempt = new Set(["setNoteMode", "setWorkplaneMode", "setToolbarMode", "setPresentationMode", "setStandbyMode", "setSketchTool", "setSketchRevolvePreview", "setSketchStrokePreview", "setMultiSelect", "setSplitSession", "setSplitConnectorPreview", "setPivotPickMode", "setLayFlatPickMode", "setAlignMode", "setMirrorMode", "setPrintCheckTool", "setDrawingExporting"]);
    const missing = states.filter((name) => !exempt.has(name) && !end.includes(`${name}(`));
    expect(missing).toEqual([]);
    for (const name of ["setSplitConnectorPreview", "setPivotPickMode", "setLayFlatPickMode", "setAlignMode", "setMirrorMode", "setPrintCheckTool"]) expect(end, name).toContain(`${name}(`);
    expect(end).toContain("closeSplit();");
  });
  it("N2 and N5: asynchronous completion obeys the activation (permanent invariant; fingerprint guards also carry it; rebuilds obey it)", () => {
    expect(asyncGaps()).toEqual([]);
    const unguardedFingerprint = editor.split("\n").filter((line) => /!== sourceFingerprint/.test(line) && !/contextChanged\(startedContext\)/.test(line) && !/session\.sourceFingerprint/.test(line));
    expect(unguardedFingerprint).toEqual([]);
    const rebuild = slice("const replaceRebuiltShape = useCallback(", "const current = shapesRef.current;");
    expect(rebuild).toContain("startedContext: number");
    expect(rebuild).toContain("contextChanged(startedContext)");
    expect(rebuild).toContain("!editableNow(staleId)");           // in ADDITION to (never instead of) the target identity and fingerprint checks below
    expect(editor).toContain("const startedContext = contextActivation();\n      sketchRebuildBusyRef.current = true;");
    expect(editor).toContain("const stale = shapes.find((shape) => !shape.locked && editableNow(shape.id) && shellNeedingRebuild(shape)");
  });
  it("notes: the notes store refuses changes to notes attached to surroundings (and reports it)", () => {
    const notesCommit = slice("const commitNotes = useCallback(", "const { addNote,");
    expect(notesCommit).toContain("notesViolation(");
    expect(notesCommit).toContain("return false;");
  });
  it("N8: nested-focus Inspector controls and Sidebar rows are unavailable for surroundings; the engine refuses regardless", () => {
    expect(editor).toContain("onRename: inContext ? undefined : renameNestedFocus, onEditGroup: inContext ? undefined : editNestedFocusGroup");
    expect(slice("const updateNestedShape = useCallback(", "const target = resolveNestedFocus")).toContain("if (contextMembers())");
  });
  it("viewport: clicks, the click stack, marquee and note attachment pass through surroundings; they stay drawn and usable as references", () => {
    expect(viewport).toContain("pickShapeAt(state, pickableShapes(),");
    expect(viewport).toContain("shapesUnderPointer(state, pickableShapes(),");
    expect(viewport).toContain(".filter((shape) => !allowed || allowed.has(shape.id))");
    expect(viewport).toContain("if (selectableIdsRef.current && !selectableIdsRef.current.has(shapeId)) return false;");
    expect(viewport).toContain("selectableIds = null,");                        // the default (browser, no context): everything
  });
  it("browser preserved: every new behaviour is gated on the native document or on an open context", () => {
    expect(commit).toContain("Boolean(nativeDocument) && levels.length > 0");
    expect(commit).toContain("{ addToInnermost: Boolean(nativeDocument) }");
    expect(slice("const contextMembers = useCallback(", "/** The modeling selection")).toContain("nativeDocument && openGroupsRef.current.length");
    expect(slice("const setOpenGroupLevels = useCallback(", "/** The activation an asynchronous")).toContain("nativeDocument");
    expect(slice("const contextChanged = useCallback(", "\n")).toContain("Boolean(nativeDocument)");
  });
});

/** The async census: every `async` editor callback that commits and awaits BEFORE its first commit carries a fingerprint or a context guard. */
function asyncGaps(): string[] {
  const lines = editor.split("\n");
  const starts = lines.flatMap((line, i) => (/^  const \w+ = (useCallback\()?async/.test(line) ? [i] : []));
  const heads = lines.flatMap((line, i) => (/^  (const \w+ = |\w+Ref\.current = )/.test(line) ? [i] : []));
  const gaps: string[] = [];
  for (const s of starts) {
    const e = heads.find((h) => h > s) ?? s + 200;
    const body = lines.slice(s, e).join("\n");
    const first = body.search(/commitShapes\(|setShapes\(|commitOpenGroupTransition\(/);
    if (first < 0) continue;
    if (/contextChanged\((?:session\.)?startedContext\)|stillWanted|sceneUnchanged/.test(body)) continue;
    if (body.slice(0, first).includes("await ")) gaps.push(lines[s].trim().split(" ")[1]);
  }
  return gaps;
}
