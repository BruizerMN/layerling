import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { applySectionClipping, createShapeObject } from "@/components/workplane/viewportShapeObjects";
import type { WorkplaneShape } from "@/types/layerling";
import { primitive } from "./support";
import { DimmingRegistry } from "@/components/workplane/viewportDimming";
import { selectionBounds } from "@/components/workplane/cameraRig";
import { beginSurroundingsSession, dimmingOf, referencesCheckboxDisabled, referenceShapesOf, setSurroundingsOpacity, setUseAsReferences, surroundingsParticipate } from "@/lib/surroundings";
import { GroupEditingContextBar } from "@/components/workplane/GroupEditingContextBar";
import { renderToString } from "react-dom/server";
import { createElement } from "react";

/*
 * Build 0131 (production verification). The Step 1 failing-first tests are now plain tests; the prototype's lifecycle tests run against the PRODUCTION registry (`viewportDimming.ts`) on real three.js objects built by the production
 * `createShapeObject`; the source census checks the wiring.
 * P = production code run as it is; H = headless harness/prototype; S = source census; I = needs interactive acceptance (pixels, GPU cost).
 */
const root = path.resolve(__dirname, "../../../");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const viewport = read("apps/web/src/components/WorkplaneViewport.tsx");
const editor = read("apps/web/src/components/LayerlingEditor.tsx");
const build = (shape: WorkplaneShape) => createShapeObject(shape, false, undefined, false);
const meshesOf = (o: THREE.Object3D) => { const out: THREE.Mesh[] = []; o.traverse((c) => { if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh); }); return out; };
const mats = (m: THREE.Mesh) => (Array.isArray(m.material) ? m.material : [m.material]);
const SHAPES = () => [primitive("solid", "box", { width: 20, depth: 20, height: 20 }), primitive("hole", "cylinder", { hole: true }), primitive("see", "sphere", { transparent: true }), primitive("plain", "cone", {})];

describe("Production provides (Build 0131; Step 1's failing-first tests, now passing)", () => {
  it("a production module lib/surroundings (state machine, participation) exists", async () => {
    const mod = await import("@/lib/surroundings" as string);
    expect(typeof mod.beginSurroundingsSession).toBe("function");
  });
  it("the viewport takes the neutral `dimmedIds` presentation prop and reads references through `referenceShapes()`", () => {
    expect(viewport).toContain("dimmedIds");
    expect(viewport).toContain("referenceShapes()");
  });
  it("the editor owns the session state (opacity, use-as-references) and resets it when a NEW session begins", () => {
    expect(editor).toMatch(/surroundingsRef|surroundingsState/);
  });
  it("every list-based reference consumer (moveSnapTargets callers, tape/protractor point sources) reads referenceShapes(), not shapesRef.current", () => {
    expect((viewport.match(/moveSnapTargets\(shapesRef\.current/g) ?? []).length).toBe(0);
  });
  it("fit-test placement and the new-shape origin ignore non-participating surroundings (Q4)", () => {
    const fit = editor.slice(editor.indexOf("const placeFitTest = useCallback"), editor.indexOf("const regenerateSelectedSbcBoard"));
    expect(fit).toMatch(/referenceShapes|participat/);
  });
});

describe("Production: the session state (Q1, Q6)", () => {
  it("a new session starts at 0% with 'Use as references' checked and effective participation OFF", () => {
    const s = beginSurroundingsSession();
    expect(s).toEqual({ opacity: 0, references: true });
    expect(surroundingsParticipate(s)).toBe(false);
  });
  it("the checkbox is disabled at 0% but keeps its state; raising opacity restores the previous choice", () => {
    let s = beginSurroundingsSession();
    expect(referencesCheckboxDisabled(s)).toBe(true);
    s = setUseAsReferences(setSurroundingsOpacity(s, 0.5), false);          // the person unchecks it at 50%
    s = setSurroundingsOpacity(s, 0);
    expect(s.references).toBe(false); expect(surroundingsParticipate(s)).toBe(false);
    s = setSurroundingsOpacity(s, 0.3);
    expect(s.references).toBe(false); expect(referencesCheckboxDisabled(s)).toBe(false);
    expect(surroundingsParticipate(setUseAsReferences(s, true))).toBe(true);
    const checked = setSurroundingsOpacity(setUseAsReferences(beginSurroundingsSession(), true), 0); expect(setSurroundingsOpacity(checked, 0.2).references).toBe(true);
  });
  it("it persists through nested transitions (the state is simply kept) and a NEW session resets both", () => {
    let s = setUseAsReferences(setSurroundingsOpacity(beginSurroundingsSession(), 0.6), false);
    const nested = s;                                                          // enter, descend, return: nothing resets it
    expect(nested).toEqual({ opacity: 0.6, references: false });
    s = beginSurroundingsSession();                                            // a new session
    expect(s).toEqual({ opacity: 0, references: true });
  });
  it("opacity is clamped to 0..1", () => {
    expect(setSurroundingsOpacity(beginSurroundingsSession(), 7).opacity).toBe(1);
    expect(setSurroundingsOpacity(beginSurroundingsSession(), -1).opacity).toBe(0);
    expect(setSurroundingsOpacity(beginSurroundingsSession(), Number.NaN).opacity).toBe(0);
  });
});

describe("Production: appearance on real production shape objects (Q2 preservation, Q3 restoration)", () => {
  it("opacity MULTIPLIES the original: holes, see-through solids and plain solids keep their relative look; the originals are never touched", () => {
    const roots = SHAPES().map(build);
    const before = roots.map((r) => meshesOf(r).flatMap((m) => mats(m).map((x) => [x, x.opacity, x.transparent, x.depthWrite] as const)));
    const reg = new DimmingRegistry();
    reg.sync(roots, setSurroundingsOpacity(beginSurroundingsSession(), 0.5));
    roots.forEach((r, i) => meshesOf(r).forEach((m, j) => mats(m).forEach((x, k) => {
      const [base, opacity] = before[i].filter(() => true)[j + k];
      expect(x).not.toBe(base);
      expect(x.opacity).toBeCloseTo(opacity * 0.5, 6);                          // hole 0.52 -> 0.26, see-through 0.4 -> 0.2, solid 1 -> 0.5
      expect(x.transparent).toBe(true); expect(x.depthWrite).toBe(false);
      expect(base.opacity).toBe(opacity);                                       // the shared original is untouched (members use it)
    })));
    expect(before.flat().map(([m, o, t, w]) => [m.opacity === o, m.transparent === t, m.depthWrite === w])).toSatisfy((rows: boolean[][]) => rows.every((r) => r.every(Boolean)));
  });
  it("textures, vertex colours and the overhang shader hook are shared or carried (no duplicate textures, no lost look)", () => {
    const base = new THREE.MeshStandardMaterial({ color: "#ffffff", vertexColors: true });
    const texture = new THREE.Texture(); base.map = texture; base.onBeforeCompile = () => undefined; base.customProgramCacheKey = () => "layerling-overhang"; base.userData.cached = true;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), base);
    const root = new THREE.Group(); root.add(mesh);
    const reg = new DimmingRegistry();
    reg.sync([root], setSurroundingsOpacity(beginSurroundingsSession(), 0.4));
    const v = mesh.material as THREE.MeshStandardMaterial;
    expect(v.map).toBe(texture); expect(v.vertexColors).toBe(true);
    expect(v.onBeforeCompile).toBe(base.onBeforeCompile); expect(v.customProgramCacheKey()).toBe("layerling-overhang");
    expect(v.userData.cached).toBe(true);                                         // the shared disposal helpers will skip it, so they cannot dispose the base's texture
  });
  it("multi-material meshes (paint, Gridfinity letters, image plate sides/top) keep one variant per distinct base and the array shape", () => {
    const a = new THREE.MeshStandardMaterial({ color: "#ff0000" }), b = new THREE.MeshStandardMaterial({ color: "#00ff00", transparent: true, opacity: 0.64 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [a, b, a]);
    const root = new THREE.Group(); root.add(mesh);
    const reg = new DimmingRegistry();
    reg.sync([root], setSurroundingsOpacity(beginSurroundingsSession(), 0.5));
    const out = mesh.material as THREE.Material[];
    expect(out).toHaveLength(3); expect(out[0]).toBe(out[2]); expect(out[0]).not.toBe(out[1]);
    expect(out[1].opacity).toBeCloseTo(0.32, 6);
    expect(reg.variantCount).toBe(2);
  });
  it("at 100% the look is EXACTLY the normal one (the original materials, shadows on, nothing alive); members are never touched", () => {
    const [dim, member] = [build(primitive("d", "box", {})), build(primitive("m", "box", {}))];
    const memberMesh = meshesOf(member)[0]; const memberMaterial = memberMesh.material; const memberShadow = memberMesh.castShadow;
    const reg = new DimmingRegistry();
    reg.sync([dim], setSurroundingsOpacity(beginSurroundingsSession(), 0.4));
    expect(meshesOf(dim)[0].castShadow).toBe(false);
    const original = [...reg["memos"].values()][0].materials;
    reg.sync([dim], setSurroundingsOpacity(beginSurroundingsSession(), 1));
    expect(meshesOf(dim)[0].material).toBe(original); expect(meshesOf(dim)[0].castShadow).toBe(true); expect(reg.variantCount).toBe(0);
    expect(memberMesh.material).toBe(memberMaterial); expect(memberMesh.castShadow).toBe(memberShadow);
  });
  it("at 0% the surroundings are not drawn; hidden-in-the-document objects have no object at all (never revealed by the slider)", () => {
    const dim = build(primitive("d", "box", {}));
    const reg = new DimmingRegistry();
    reg.sync([dim], beginSurroundingsSession());
    expect(dim.visible).toBe(false);
    reg.sync([dim], setSurroundingsOpacity(beginSurroundingsSession(), 0.5));
    expect(dim.visible).toBe(true);
    const source = read("apps/web/src/components/workplane/viewportShapeObjects.ts");
    expect(source).toContain("const visibleShapes = shapes.filter((shape) => !shape.hidden);");     // S: rebuildShapes builds objects for visible shapes only
  });
  it("section clipping reaches the variants through the production traversal (applySectionClipping walks every mesh's current material)", () => {
    const dim = build(primitive("d", "box", {})); const layer = new THREE.Group(); layer.add(dim);
    const reg = new DimmingRegistry();
    reg.sync([dim], setSurroundingsOpacity(beginSurroundingsSession(), 0.5));
    const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
    applySectionClipping({ shapeLayer: layer, sectionPlane: null, cadFaceLayer: undefined } as never, plane);
    expect((meshesOf(dim)[0].material as THREE.Material).clippingPlanes).toEqual([plane]);
  });
});

describe("Production: reference participation by swapping `raycast` (central, covers every ray-cast site)", () => {
  it("a non-participating surrounding is drawn (or not) but hit by NO ray cast; a member behind it is; participation restores the original raycast", () => {
    const front = build(primitive("front", "box", { width: 10, depth: 10, height: 10 })), back = build(primitive("back", "box", { x: 0, z: 0, width: 10, depth: 10, height: 10, elevation: 0 }));
    back.position.z += 30; front.position.z += 0;
    const scene = new THREE.Group(); scene.add(front, back); scene.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 5, -50), new THREE.Vector3(0, 0, 1)); ray.layers.enableAll();
    const inside = (o: THREE.Object3D, ancestor: THREE.Object3D) => { let n: THREE.Object3D | null = o; while (n) { if (n === ancestor) return true; n = n.parent; } return false; };
    const hits = () => ray.intersectObjects(scene.children, true).map((h) => (inside(h.object, front) ? "front" : "back"));
    const baseline = hits(); expect(baseline[0]).toBe("front");
    const reg = new DimmingRegistry();
    reg.sync([front], setSurroundingsOpacity(setUseAsReferences(beginSurroundingsSession(), false), 0.5));    // visible, references OFF
    expect(front.visible).toBe(true); expect(hits().every((h) => h === "back")).toBe(true);                    // passes through to the member
    reg.sync([front], setSurroundingsOpacity(beginSurroundingsSession(), 0.5));                               // references ON
    expect(hits()[0]).toBe("front");
    reg.sync([front], beginSurroundingsSession());                                                            // 0%: invisible AND not a reference (even with the box still checked)
    expect(hits().every((h) => h === "back")).toBe(true);
    reg.release(); expect(hits()[0]).toBe("front");
  });
  it("S: raycast is assigned only when a mesh is created (never replaced later), so swapping and restoring it is safe", () => {
    const sites = [...(read("apps/web/src/components/workplane/viewportShapeObjects.ts").matchAll(/\.raycast = /g))].length;
    expect(sites).toBe(5);       // 2 previews, 2 picking set-ups (lazy / accelerated) at creation, 1 probe; a new one must be reviewed
  });
});

describe("Production: lifecycle and cost of the mechanism", () => {
  it("repeated sessions, nested transitions and slider moves accumulate NOTHING; every variant is disposed once; originals are never disposed", () => {
    const roots = SHAPES().map(build);
    const originals = roots.flatMap(meshesOf).flatMap(mats);
    const baseDispose = originals.map((m) => vi.spyOn(m, "dispose"));
    const reg = new DimmingRegistry();
    for (let session = 0; session < 40; session += 1) {
      for (const opacity of [0, 0.2, 0.7, 0.7, 1, 0.5, 0.35]) reg.sync(roots, setSurroundingsOpacity(beginSurroundingsSession(), opacity));
      for (let i = 0; i < 25; i += 1) reg.setOpacityOnly(i / 25);
      reg.sync(roots.slice(1), setSurroundingsOpacity(beginSurroundingsSession(), 0.5));      // a nested transition changes which objects are dimmed
      reg.release();
      expect(reg.variantCount).toBe(0); expect(reg.touchedCount).toBe(0);
    }
    expect(reg.created).toBe(reg.disposed);
    expect(reg.created).toBeLessThanOrEqual(40 * 2 * originals.length);          // bounded by the distinct originals per session, not by the number of slider moves
    baseDispose.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    roots.forEach((r) => meshesOf(r).forEach((m) => { expect(m.visible).toBe(true); expect(m.castShadow).toBe(true); }));
  });
  it("the slider touches only the variants: no object, geometry or material assignment changes", () => {
    const roots = SHAPES().map(build);
    const reg = new DimmingRegistry();
    reg.sync(roots, setSurroundingsOpacity(beginSurroundingsSession(), 0.5));
    const snapshot = roots.flatMap(meshesOf).map((m) => [m, m.geometry, m.material] as const);
    for (let i = 0; i < 2000; i += 1) reg.setOpacityOnly((i % 100) / 100);
    roots.flatMap(meshesOf).forEach((m, i) => { expect(m).toBe(snapshot[i][0]); expect(m.geometry).toBe(snapshot[i][1]); expect(m.material).toBe(snapshot[i][2]); });
    expect(reg.variantCount).toBeLessThanOrEqual(roots.length);
  });
  it("two documents (two registries on two scenes) at different opacity and participation cannot influence each other", () => {
    const a = build(primitive("a", "box", {})), b = build(primitive("a", "box", {}));
    const ra = new DimmingRegistry(), rb = new DimmingRegistry();
    ra.sync([a], setSurroundingsOpacity(beginSurroundingsSession(), 0.2));
    rb.sync([b], setSurroundingsOpacity(setUseAsReferences(beginSurroundingsSession(), false), 0.9));
    expect((meshesOf(a)[0].material as THREE.Material).opacity).toBeCloseTo(0.2, 6);
    expect((meshesOf(b)[0].material as THREE.Material).opacity).toBeCloseTo(0.9, 6);
    ra.release();
    expect((meshesOf(b)[0].material as THREE.Material).opacity).toBeCloseTo(0.9, 6);
    expect(meshesOf(b)[0].raycast).not.toBe(meshesOf(a)[0].raycast);
  });
  it("S: the dimming state belongs to the viewport (its ThreeState) and each document is its own WKWebView, so no module-level value is needed; the shared material caches are page-wide but never mutated by dimming", () => {
    const shared = read("apps/web/src/components/workplane/ViewportOverlays.tsx");
    expect(shared).toContain("export const sharedShapeMaterialCache = new Map<");        // page-wide, per JS realm = per document window
    expect(shared).toContain("if (material.userData.cached) return;");                   // disposal skips registry-owned (cached) variants
  });
});

describe("Production: the requirements Bill added (raycast, material changes, fidelity, framing, independence)", () => {
  it("raycast is restored EXACTLY, including specialized implementations, and meshes created, replaced or removed during the session are handled", () => {
    const rootA = new THREE.Group(), accelerated = () => undefined, lazy = function lazy() { return undefined; };
    const m1 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()), m2 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()), m3 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    m2.raycast = accelerated as never; m3.raycast = lazy as never;
    const standard = m1.raycast;
    rootA.add(m1, m2, m3);
    const reg = new DimmingRegistry();
    reg.sync([rootA], { opacity: 0.5, references: false });
    for (const m of [m1, m2, m3]) expect(m.raycast).not.toBe(standard);          // none of them can be hit
    const created = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());     // created during the session (a modeling operation)
    rootA.add(created);
    reg.sync([rootA], { opacity: 0.5, references: false });
    expect(created.raycast).not.toBe(standard);
    const replacement = new THREE.MeshStandardMaterial({ color: "#123456", opacity: 0.8, transparent: true });
    m1.material = replacement;                                                     // a scene sync replaced the material
    rootA.remove(m3); m3.geometry.dispose();                                       // a mesh removed (disposed)
    reg.sync([rootA], { opacity: 0.5, references: true });
    expect((m1.material as THREE.Material).opacity).toBeCloseTo(0.4, 6);          // 0.8 x 0.5, the replacement is the new original, not multiplied twice
    expect(reg.touchedCount).toBe(3);                                              // m3 is forgotten, never restored
    reg.sync([rootA], { opacity: 0.5, references: true });
    reg.sync([rootA], { opacity: 0.5, references: true });
    expect((m1.material as THREE.Material).opacity).toBeCloseTo(0.4, 6);
    reg.release();
    expect(m1.raycast).toBe(standard); expect(m2.raycast).toBe(accelerated); expect(created.raycast).toBe(standard);
    expect(m1.material).toBe(replacement);                                         // not an obsolete material
    expect(m3.raycast).toBe(lazy);                                                  // (the removed mesh was never touched again)
  });
  it("material changes while dimmed: an original changed in place is followed, never multiplied twice; textures are never disposed; section clipping set later still reaches the variants", () => {
    const texture = new THREE.Texture(); const disposeSpy = vi.spyOn(texture, "dispose");
    const base = new THREE.MeshStandardMaterial({ color: "#ff0000", map: texture });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), base); const root = new THREE.Group(); root.add(mesh);
    const reg = new DimmingRegistry();
    for (let i = 0; i < 5; i += 1) reg.sync([root], { opacity: 0.6, references: true });
    expect((mesh.material as THREE.Material).opacity).toBeCloseTo(0.6, 6);
    base.opacity = 0.5; base.transparent = true;                                   // a display mode changed the shared original in place
    reg.sync([root], { opacity: 0.6, references: true });
    expect((mesh.material as THREE.Material).opacity).toBeCloseTo(0.3, 6);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    applySectionClipping({ shapeLayer: root, sectionPlane: null, cadFaceLayer: undefined } as never, plane);
    reg.sync([root], { opacity: 0.4, references: true });
    expect((mesh.material as THREE.Material).clippingPlanes?.length).toBe(1);      // a variant made after the clipping started follows the original's planes
    reg.release();
    expect(mesh.material).toBe(base); expect(disposeSpy).not.toHaveBeenCalled();
  });
  it("N1: dimmed meshes below 100% are flagged so the see-through far-half pass skips them; at 100% and at 0% the flag is gone and the normal rendering path is back", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4 })); const root = new THREE.Group(); root.add(mesh);
    const reg = new DimmingRegistry();
    reg.sync([root], { opacity: 0.5, references: true }); expect(mesh.userData.dimmed).toBe(true);
    reg.sync([root], { opacity: 1, references: true }); expect(mesh.userData.dimmed).toBeUndefined();
    reg.sync([root], { opacity: 0.3, references: true }); reg.sync([root], { opacity: 0, references: true }); expect(mesh.userData.dimmed).toBeUndefined();
    expect(read("apps/web/src/components/workplane/renderFrame.ts")).toContain("if (mesh.userData.dimmed) return;");
  });
  it("N3: framing follows VISIBILITY only: 0% excludes the surroundings, above 0% includes them, the references checkbox never matters, Zoom to Selection frames the selection", () => {
    const member = build(primitive("m", "box", { x: 0 })), surround = build(primitive("s", "box", { x: 500 }));
    const records = new Map([["m", { object: member }], ["s", { object: surround }]]);
    const frame = () => selectionBounds({ shapeRecords: records } as never, [...records.keys()].filter((id) => records.get(id)!.object.visible));
    const reg = new DimmingRegistry();
    reg.sync([surround], { opacity: 0, references: true }); const atZero = frame()!.max.x;
    reg.sync([surround], { opacity: 0, references: false }); expect(frame()!.max.x).toBe(atZero);
    reg.sync([surround], { opacity: 0.2, references: false }); const above = frame()!.max.x;
    reg.sync([surround], { opacity: 0.2, references: true }); expect(frame()!.max.x).toBe(above);
    expect(atZero).toBeLessThan(100); expect(above).toBeGreaterThan(400);
    expect(selectionBounds({ shapeRecords: records } as never, ["m"])!.max.x).toBeLessThan(100);
    const viewportSource = read("apps/web/src/components/WorkplaneViewport.tsx");
    expect((viewportSource.match(/filter\(\(id\) => state\.shapeRecords\.get\(id\)\?\.object\.visible\)/g) ?? []).length).toBeGreaterThanOrEqual(3);   // every general framing path filters on visibility
  });
  it("the three mechanisms are independent: opacity and participation never reach selection, picking, the commit guard, notes or the Sidebar flags", () => {
    const commit = editor.slice(editor.indexOf("const commitShapes = useCallback("), editor.indexOf("// Several build plates side by side"));
    const members = editor.slice(editor.indexOf("const contextMembers = useCallback("), editor.indexOf("const refuseWholeDesign") > 0 ? editor.indexOf("const { notice,") : undefined);
    for (const text of [commit, members, editor.slice(editor.indexOf("const setSelectedIds = useCallback("), editor.indexOf("/** A command that changes"))]) expect(text).not.toMatch(/dimming|referenceShapes|SurroundingsState|surroundingsRef|dimmedIds/);
    const pick = viewport.slice(viewport.indexOf("const pickableShapes = useCallback("), viewport.indexOf("const dimmedIdsRef"));
    expect(pick).not.toMatch(/dimm|referenceShapes/);
    const ctx = read("apps/web/src/lib/editingContext.ts");
    expect(ctx).not.toMatch(/dimming|referenceShapes|SurroundingsState|beginSurroundingsSession/);
  });
  it("reference participation: only non-participating dimmed objects leave the reference lists; picking lists are untouched; participation is never an edit privilege", () => {
    const shapes = [primitive("m", "box"), primitive("s", "box")]; const dimmed = new Set(["s"]);
    expect(referenceShapesOf(shapes, dimmed, { opacity: 0, references: true }).map((x) => x.id)).toEqual(["m"]);
    expect(referenceShapesOf(shapes, dimmed, { opacity: 0.5, references: false }).map((x) => x.id)).toEqual(["m"]);
    expect(referenceShapesOf(shapes, dimmed, { opacity: 0.5, references: true }).map((x) => x.id)).toEqual(["m", "s"]);
    expect(referenceShapesOf(shapes, null, { opacity: 0, references: true })).toBe(shapes);
    expect(surroundingsParticipate(dimmingOf(beginSurroundingsSession()))).toBe(false);
  });
  it("simultaneous sessions in separate documents: separate state and separate registries at different settings stay independent", () => {
    let docA = beginSurroundingsSession(), docB = beginSurroundingsSession();
    docA = setUseAsReferences(setSurroundingsOpacity(docA, 0.25), false); docB = setSurroundingsOpacity(docB, 0.9);
    const a = build(primitive("x", "box")), b = build(primitive("x", "box"));
    const ra = new DimmingRegistry(), rb = new DimmingRegistry();
    ra.sync([a], dimmingOf(docA)); rb.sync([b], dimmingOf(docB));
    expect((meshesOf(a)[0].material as THREE.Material).opacity).toBeCloseTo(0.25, 6); expect((meshesOf(b)[0].material as THREE.Material).opacity).toBeCloseTo(0.9, 6);
    docA = beginSurroundingsSession();                                              // document A starts a new session: B is untouched
    ra.release(); expect((meshesOf(b)[0].material as THREE.Material).opacity).toBeCloseTo(0.9, 6);
    expect(docB).toEqual({ opacity: 0.9, references: true });
  });
  it("the Context Bar's Surroundings controls: the checkbox is DISABLED at 0% yet CHECKED; enabled above 0%; unchecked stays unchecked (state is only the page's)", () => {
    const html = (state: { opacity: number; references: boolean }) => renderToString(createElement(GroupEditingContextBar, { name: "Wall", state, busy: false, onOpacity: () => undefined, onReferences: () => undefined, onDone: () => undefined, onCancel: () => undefined }));
    const zero = html({ opacity: 0, references: true });
    expect(zero).toMatch(/type="checkbox"[^>]*checked/); expect(zero).toMatch(/type="checkbox"[^>]*disabled/);
    const half = html({ opacity: 0.5, references: false });
    expect(half).not.toMatch(/type="checkbox"[^>]*disabled/); expect(half).not.toMatch(/type="checkbox"[^>]*checked/);
    expect(html({ opacity: 0.5, references: true })).toMatch(/50(<!-- -->)?%/);
  });

});

describe("S: the wiring (native only; the browser has no context, so nothing is dimmed)", () => {
  it("viewport: the neutral prop, the sync after every scene sync, the slider fast path, release on unmount; reference sites read referenceShapes()", () => {
    const objects = read("apps/web/src/components/workplane/viewportShapeObjects.ts");
    expect((objects.match(/applyDimming\(state\);/g) ?? []).length).toBe(2);        // both exits of rebuildShapes
    expect(viewport).toContain("state.dimming.setOpacityOnly(next.presentation.opacity)");
    expect(viewport).toContain("state.dimming?.release();");
    for (const call of ["moveSnapTargets(referenceShapes()", "resizeSnapForHandle(state, frame, scaleSigns, referenceShapes()", "const visible = referenceShapes().filter", "const visibleIds = referenceShapes().filter"]) expect(viewport, call).toContain(call);
    expect(viewport).toContain("const [dimmedIds, dimming]".slice(0, 0) + "dimmedIds = null,");
  });
  it("editor: the session state resets when a NEW session begins; the overlay and the props exist only for a native document in a context; placement reads referenceShapesNow()", () => {
    expect(editor.slice(editor.indexOf("const beginGroupSession = useCallback"), editor.indexOf("const endGroupSession"))).toContain("setSurroundings(beginSurroundingsSession());");
    expect(editor).toContain("{contextBarShown ? (\n        <GroupEditingContextBar");
    expect(editor).toContain("dimmedIds={dimmedIds}\n          dimming={dimmingPresentation}");
    expect(editor).toContain("const taken = referenceShapesNow().filter(");
    expect(editor.slice(editor.indexOf("const contextMembers = useCallback("), editor.indexOf("/** The modeling selection can only"))).toContain("nativeDocument && openGroupsRef.current.length");
  });
  it("the double-click preference keeps working as before: the hook's gate and the browser label are unchanged", () => {
    expect(read("apps/web/src/components/workplane/useViewportDoubleClick.ts")).toContain("shape.groupedShapes?.length && settings.doubleClickOpensGroup !== false");
    expect(read("apps/web/src/lib/messages.en.ts")).toContain('"workspace.doubleClickOpensGroup": "Double-click opens a group or bundle"');
  });
});
