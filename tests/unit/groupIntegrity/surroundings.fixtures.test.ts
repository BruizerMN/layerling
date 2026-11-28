import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createShapeObject } from "@/components/workplane/viewportShapeObjects";
import { restoreGroupedChildren } from "@/lib/editorBooleans";
import { replaceAtFirst } from "@/lib/openGroupParts";
import type { WorkplaneShape } from "@/types/layerling";
import { fixturePath, loadFixture } from "./support";
import { DimmingRegistry } from "@/components/workplane/viewportDimming";
import { beginSurroundingsSession, setSurroundingsOpacity, dimmingOf } from "@/lib/surroundings";

/*
 * Build 0131 STEP 1: the real documents (LAYERLING_INTEGRITY_FIXTURES). HEADLESS: three.js scene objects are built by the production `createShapeObject` for every visible top-level shape of the document with one group opened
 * (the surroundings are everything else) and the PRODUCTION registry dims them. MEASURED here: counts (objects, meshes = draw calls, triangles, distinct materials) and CPU-side times. NOT measurable here (no GPU): fill rate,
 * overdraw, frame time; those are reported as anticipated from the counts.
 */
const stat = (o: THREE.Object3D) => {
  let meshes = 0, triangles = 0; const materials = new Set<THREE.Material>();
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    meshes += 1;
    const g = m.geometry as THREE.BufferGeometry;
    triangles += (g.index ? g.index.count : g.getAttribute("position").count) / 3;
    (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => materials.add(x));
  });
  return { meshes, triangles, materials };
};
const ms = (f: () => void, n = 1) => { const t0 = performance.now(); for (let i = 0; i < n; i += 1) f(); return (performance.now() - t0) / n; };

for (const file of ["saud.lyl", "foshay.lyl"]) {
  describe.skipIf(!fixturePath(file))(`${file}: translucent surroundings, measured headlessly`, () => {
    it("counts, entering/changing a context versus moving the slider, 100% crossing, repeated sessions", async () => {
      const project = await loadFixture(fixturePath(file)!);
      const doc = project.shapes;
      // the context: the group with the most parts opened; every other top-level shape is a surrounding
      const edited = doc.filter((s) => s.groupedShapes?.length).sort((a, b) => b.groupedShapes!.length - a.groupedShapes!.length)[0];
      const parts = restoreGroupedChildren(edited, undefined, { keepPartVisibility: true });
      const flat: WorkplaneShape[] = replaceAtFirst(doc, [edited.id], parts);
      const memberIds = new Set(parts.map((p) => p.id));
      const build0 = performance.now();
      const objects = new Map<string, THREE.Object3D>();
      for (const shape of flat) if (!shape.hidden) objects.set(shape.id, createShapeObject(shape, false, undefined, false));
      const buildMs = performance.now() - build0;
      const dimmedRoots = flat.filter((s) => !memberIds.has(s.id) && objects.has(s.id)).map((s) => objects.get(s.id)!);
      const total = { meshes: 0, triangles: 0, materials: new Set<THREE.Material>() };
      for (const o of dimmedRoots) { const s = stat(o); total.meshes += s.meshes; total.triangles += s.triangles; s.materials.forEach((m) => total.materials.add(m)); }
      const reg = new DimmingRegistry();
      const enter = ms(() => reg.sync(dimmedRoots, dimmingOf(setSurroundingsOpacity(beginSurroundingsSession(), 0.5))));
      const variants = reg.variantCount;
      const slider = ms(() => { for (let i = 1; i <= 100; i += 1) reg.setOpacityOnly(i / 100 * 0.99); }, 5) / 100;
      const change = ms(() => reg.sync(dimmedRoots.slice(0, Math.floor(dimmedRoots.length / 2)), dimmingOf(setSurroundingsOpacity(beginSurroundingsSession(), 0.5))));   // a transition changes which objects are dimmed
      reg.sync(dimmedRoots, dimmingOf(setSurroundingsOpacity(beginSurroundingsSession(), 0.5)));
      const to100 = ms(() => reg.sync(dimmedRoots, dimmingOf(setSurroundingsOpacity(beginSurroundingsSession(), 1))));
      const to0 = ms(() => reg.sync(dimmedRoots, dimmingOf(beginSurroundingsSession())));
      let leaked = 0;
      const cycles = ms(() => { for (let i = 0; i < 20; i += 1) { reg.sync(dimmedRoots, dimmingOf(setSurroundingsOpacity(beginSurroundingsSession(), 0.4))); reg.release(); } }, 1) / 20;
      leaked = reg.variantCount + reg.touchedCount;
      console.info(`[0131 ${file}] ${flat.length} flat objects (${parts.length} members of "${edited.name}"), ${dimmedRoots.length} surroundings: ${total.meshes} meshes (= draw calls if all drawn), ${Math.round(total.triangles)} triangles, ${total.materials.size} distinct materials -> ${variants} dimming variants\n   build of all scene objects ${buildMs.toFixed(0)} ms (what a full scene build costs; not paid per slider move)\n   enter dimming ${enter.toFixed(2)} ms, change which objects are dimmed (a transition) ${change.toFixed(2)} ms, cross to 100% ${to100.toFixed(2)} ms, to 0% ${to0.toFixed(2)} ms; SLIDER MOVE ${(slider * 1000).toFixed(1)} microseconds (opacity of ${variants} materials)\n   20 enter/leave cycles ${cycles.toFixed(2)} ms each, leaked variants/memos after release: ${leaked}; created ${reg.created}, disposed ${reg.disposed}`);
      expect(leaked).toBe(0);
      expect(reg.created).toBe(reg.disposed);
      expect(slider).toBeLessThan(0.5);
    }, 900_000);
  });
}
