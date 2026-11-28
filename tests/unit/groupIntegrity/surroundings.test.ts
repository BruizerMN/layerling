import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { applySectionClipping, createShapeObject } from "@/components/workplane/viewportShapeObjects";
import type { WorkplaneShape } from "@/types/layerling";
import { primitive } from "./support";
import { beginSurroundingsSession, DimmingRegistry, referencesCheckboxDisabled, setSurroundingsOpacity, setUseAsReferences, surroundingsParticipate } from "./surroundingsProto";

/*
 * Build 0131, STEP 1 (investigation and failing-first; no production change). (1) FAILING FIRST against production (`it.fails`): what the build must add. (2) PROTOTYPE tests (plain): the proposed presentation mechanism
 * (surroundingsProto.ts, test tree only, on REAL three.js objects built by the production `createShapeObject`) satisfies Bill's requirements. (3) CENSUS of production source.
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

describe("FAILING FIRST: production must provide (Build 0131)", () => {
  it.fails("a production module lib/surroundings (state machine, participation) exists", async () => {
    const mod = await import("@/lib/surroundings" as string);
    expect(typeof mod.beginSurroundingsSession).toBe("function");
  });
  it.fails("the viewport takes the neutral `dimmedIds` presentation prop and reads references through `referenceShapes()`", () => {
    expect(viewport).toContain("dimmedIds");
    expect(viewport).toContain("referenceShapes()");
  });
  it.fails("the editor owns the session state (opacity, use-as-references) and resets it when a NEW session begins", () => {
    expect(editor).toMatch(/surroundingsRef|surroundingsState/);
  });
  it.fails("every list-based reference consumer (moveSnapTargets callers, tape/protractor point sources) reads referenceShapes(), not shapesRef.current", () => {
    expect((viewport.match(/moveSnapTargets\(shapesRef\.current/g) ?? []).length).toBe(0);
  });
  it.fails("fit-test placement and the new-shape origin ignore non-participating surroundings (Q4)", () => {
    const fit = editor.slice(editor.indexOf("const placeFitTest = useCallback"), editor.indexOf("const regenerateSelectedSbcBoard"));
    expect(fit).toMatch(/referenceShapes|participat/);
  });
});

describe("PROTOTYPE: the session state (Q1, Q6)", () => {
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

describe("PROTOTYPE: appearance on real production shape objects (Q2 preservation, Q3 restoration)", () => {
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

describe("PROTOTYPE: reference participation by swapping `raycast` (central, covers every ray-cast site)", () => {
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

describe("PROTOTYPE: lifecycle and cost of the mechanism", () => {
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
