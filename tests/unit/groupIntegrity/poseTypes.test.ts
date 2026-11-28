import { beforeAll, describe, expect, it, vi } from "vitest";
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
import { buildHullShapeFromSelection, buildIntersectionShapeFromSelection, groupedShape, groupPartAxes, restoreGroupedChildren } from "@/lib/editorBooleans";
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, startKernel, TRIANGLE_LIMIT } from "./support";
import { bboxDev, makeGroup, openParts, poseFieldsDiff, posedFrom, posedGroup, primitive, rebuildPreserving, reconstructStrict, relSym, type Pose } from "./poseLab";
import { frameOf, unposePart } from "./poseProto";
import { meshForShape } from "@/lib/editorMeshCore";
import { maxVertexDeviation } from "./support";
const meshDev = (a: WorkplaneShape, b: WorkplaneShape) => { const va: number[] = [], vb: number[] = []; meshForShape(a).vertices.forEach((v) => va.push(...v)); meshForShape(b).vertices.forEach((v) => vb.push(...v)); return maxVertexDeviation(va, vb); };

/** Heavy numerical investigation: run with LAYERLING_POSE_INVESTIGATION=1 (and LAYERLING_INTEGRITY_FIXTURES for the real documents). */
beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });

/*
 * Build 0127 verification, experiment C: the specialised group types and features named in decision A2, built synthetically (none occurs in Bill's documents). For each: the prototype's result
 * against today's strict Done (which bakes the pose) and the no-op reconstruction against the ORIGINAL body. A type is only a candidate for the supported set when the preserving build exists,
 * the kernel accepts it, the pose is kept and the body agrees with the original (no-op) / with today's (clean edits).
 */
const poses: Record<string, Pose> = {
  none: {}, mirrorX: { mirrorX: true }, rotXYZ: { rotation: 20, rotationX: 35, rotationZ: 50 }, uniform1_7: { stretch: [1.7, 1.7, 1.7] },
  stretchNonUniform: { stretch: [2, 1.3, 0.6] }, combo: { stretch: [2, 1.3, 0.6], rotation: 20, rotationX: 35, rotationZ: 50, mirrorX: true, mirrorZ: true },
};
const first = (p: WorkplaneShape[]) => p.findIndex((s) => !s.hole);
const edits: Record<string, (p: WorkplaneShape[]) => { parts: WorkplaneShape[]; touched: number[] }> = {
  move: (p) => { const i = first(p); return { parts: p.map((s, k) => (k === i ? { ...s, x: s.x + 3, z: s.z - 2 } : s)), touched: [i] }; },
  delete: (p) => { const i = p.length - 1 - [...p].reverse().findIndex((s) => !s.hole); return { parts: p.filter((_, k) => k !== i), touched: [i] }; },
  add: (p) => ({ parts: [...p, primitive("new", "box", { x: p[0].x + 12, z: p[0].z + 6, elevation: p[0].elevation ?? 0, width: 9, depth: 9, height: 12 })], touched: [] }),
};
const shears = (G: WorkplaneShape, part: WorkplaneShape) => { const [sx, sy, sz] = frameOf(G).S; const v = groupPartAxes(part).map(([x, y, z]) => [x * sx, y * sy, z * sz] as const); const d = (a: readonly number[], b: readonly number[]) => (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b)); return Math.max(Math.abs(d(v[0], v[1])), Math.abs(d(v[0], v[2])), Math.abs(d(v[1], v[2]))); };
const f = (v: number) => (Number.isFinite(v) ? v.toExponential(1) : "n/a");

type Maker = () => Promise<WorkplaneShape | null>;
/** The builders leave `groupOperation` to the caller (the editor sets it); a group of that kind must say so or it is rebuilt as a plain union. */
const opOf = async (r: Promise<{ group: WorkplaneShape | null }>, op: "hull" | "intersection") => { const g = (await r).group; return g ? ({ ...g, groupOperation: op } as WorkplaneShape) : null; };
const solids = () => [primitive("s1", "box", { width: 30, depth: 20, height: 20 }), primitive("s2", "cylinder", { x: 14, z: 4, sides: 32, width: 18, depth: 18, height: 26 }), primitive("s3", "box", { x: -16, z: -3, width: 12, depth: 12, height: 14 })];
const types: Record<string, Maker> = {
  bundle: async () => { const g = groupedShape(solids()); return g ? ({ ...g, groupOperation: "bundle" } as WorkplaneShape) : null; },
  hull: async () => await opOf(buildHullShapeFromSelection(solids(), TRIANGLE_LIMIT, { keepHoles: false }), "hull"),
  hullKeepHoles: async () => { const r = await buildHullShapeFromSelection([...solids(), primitive("h", "cylinder", { hole: true, x: 4, sides: 24, width: 6, depth: 6, height: 40, elevation: -5 })], TRIANGLE_LIMIT, { keepHoles: true }); return r.group ? ({ ...r.group, groupOperation: "hull", hullKeepHoles: true } as WorkplaneShape) : null; },
  intersection: async () => await opOf(buildIntersectionShapeFromSelection([primitive("i1", "box", { width: 30, depth: 30, height: 30 }), primitive("i2", "cylinder", { x: 6, sides: 40, width: 30, depth: 30, height: 30 }), primitive("i3", "sphere", { x: -4, z: 3, sides: 24, width: 34, depth: 34, height: 34 })], TRIANGLE_LIMIT), "intersection"),
  taperedPart: async () => makeGroup([primitive("t1", "box", { width: 20, depth: 20, height: 20, taperTopWidth: 10, taperTopDepth: 12 }), primitive("t2", "box", { x: 25, width: 14, depth: 14, height: 16 }), primitive("th", "cylinder", { hole: true, x: 25, sides: 24, width: 5, depth: 5, height: 30, elevation: -5 })]),
  leanTwistPart: async () => makeGroup([primitive("l1", "box", { width: 20, depth: 20, height: 24, extrudeTwist: 40, extrudeTopOffsetX: 3 }), primitive("l2", "box", { x: 26, width: 14, depth: 14, height: 16 }), primitive("lh", "cylinder", { hole: true, x: 26, sides: 24, width: 5, depth: 5, height: 30, elevation: -5 })]),
  cylinderEllipse: async () => makeGroup([primitive("c1", "cylinder", { sides: 48, width: 20, depth: 20, height: 18 }), primitive("c2", "box", { x: 26, width: 12, depth: 12, height: 10 }), primitive("ch", "cylinder", { hole: true, x: 26, sides: 24, width: 5, depth: 5, height: 30, elevation: -5 })]),
  coneParts: async () => makeGroup([primitive("k1", "cone", { width: 20, depth: 20, height: 20 }), primitive("k2", "box", { x: 26, width: 12, depth: 12, height: 10 }), primitive("kh", "cylinder", { hole: true, x: 26, sides: 24, width: 5, depth: 5, height: 30, elevation: -5 })]),
  starPart: async () => makeGroup([primitive("st", "star", { width: 24, depth: 24, height: 10 }), primitive("sb", "box", { x: 28, width: 12, depth: 12, height: 10 }), primitive("sh", "cylinder", { hole: true, x: 28, sides: 24, width: 5, depth: 5, height: 30, elevation: -5 })]),
  // ---- combinations of features (not each alone)
  combo_hullOfTaperedAndEllipseCylinder: async () => opOf(buildHullShapeFromSelection([primitive("c1", "box", { width: 20, depth: 20, height: 20, taperTopWidth: 10, taperTopDepth: 12 }), primitive("c2", "cylinder", { x: 24, sides: 32, width: 16, depth: 16, height: 14 })], TRIANGLE_LIMIT, { keepHoles: false }), "hull"),
  combo_hullKeepHolesTapered: async () => { const g = await opOf(buildHullShapeFromSelection([primitive("c1", "box", { width: 20, depth: 20, height: 20, taperTopWidth: 10, taperTopDepth: 12 }), primitive("c2", "cylinder", { x: 24, sides: 32, width: 16, depth: 16, height: 14 }), primitive("ch", "cylinder", { hole: true, x: 12, sides: 24, width: 5, depth: 5, height: 40, elevation: -5 })], TRIANGLE_LIMIT, { keepHoles: true }), "hull"); return g ? ({ ...g, hullKeepHoles: true } as WorkplaneShape) : null; },
  combo_intersectionTaperedCone: async () => opOf(buildIntersectionShapeFromSelection([primitive("i1", "box", { width: 30, depth: 30, height: 30, taperTopWidth: 14, taperTopDepth: 18 }), primitive("i2", "cone", { x: 4, width: 34, depth: 34, height: 30 }), primitive("i3", "cylinder", { x: -3, sides: 36, width: 28, depth: 28, height: 30 })], TRIANGLE_LIMIT), "intersection"),   // a CYLINDER IS ROUND: an earlier 30 x 26 input is not a shape the editor can make (canonicalizeShape rounds it) and produced a spurious 5.6% rebuild difference
  combo_bundleWithHullAndTaper: async () => { const hull = await opOf(buildHullShapeFromSelection([primitive("b1", "box", { width: 14, depth: 14, height: 12 }), primitive("b2", "cylinder", { x: 14, sides: 24, width: 10, depth: 10, height: 18 })], TRIANGLE_LIMIT, { keepHoles: false }), "hull"); if (!hull) return null; const g = groupedShape([{ ...hull, x: -12 }, primitive("tp", "box", { x: 16, width: 16, depth: 16, height: 18, taperTopWidth: 8, taperTopDepth: 8 }), primitive("sp", "sphere", { x: 36, sides: 24, width: 14, depth: 14, height: 14 })]); return g ? ({ ...g, groupOperation: "bundle" } as WorkplaneShape) : null; },
  combo_cutWithHullTaperedAndHole: async () => { const hull = await opOf(buildHullShapeFromSelection([primitive("h1", "box", { width: 16, depth: 16, height: 14 }), primitive("h2", "cylinder", { x: 14, sides: 24, width: 10, depth: 10, height: 20 })], TRIANGLE_LIMIT, { keepHoles: false }), "hull"); if (!hull) return null; return makeGroup([{ ...hull, x: -4 }, primitive("tp", "box", { x: 26, width: 16, depth: 16, height: 24, taperTopWidth: 8, taperTopDepth: 10 }), primitive("hole", "cylinder", { x: 26, hole: true, sides: 24, width: 6, depth: 6, height: 40, elevation: -8 })]); },
  combo_holeOnlyTaperedAndCylinder: async () => makeGroup([primitive("h1", "box", { hole: true, width: 16, depth: 16, height: 20, taperTopWidth: 8, taperTopDepth: 8 }), primitive("h2", "cylinder", { hole: true, x: 14, sides: 24, width: 10, depth: 10, height: 24 })]),
  keepPartsFlag: async () => { const g = await makeGroup([primitive("k1", "box", { width: 60, depth: 20, height: 10 }), primitive("kh", "cylinder", { hole: true, x: -25, sides: 24, width: 6, depth: 6, height: 20, elevation: -5 })]); return { ...g, groupResize: "keep" } as WorkplaneShape; },
};
type Row = { leafUntouched: number; leafEdited: number; type: string; pose: string; edit: string; made: boolean; presOk: boolean; bakeOk: boolean; rel: number; bbox: number; noopP: number; noopB: number; poseDiff: number; shearEdited: boolean; shearAny: boolean; ids: string; kinds: string };
const rows: Row[] = [];
const failures: string[] = [];

describe.skipIf(!process.env.LAYERLING_POSE_INVESTIGATION)("specialised group types and features", () => {
  for (const [type, make] of Object.entries(types)) {
    it(type, async () => {
      let base: WorkplaneShape | null = null;
      try { base = await make(); } catch (error) { failures.push(`${type}: cannot be constructed in the Node harness (${(error as Error).message.slice(0, 80)})`); }
      if (!base) { rows.push({ leafUntouched: NaN, leafEdited: NaN, type, pose: "-", edit: "-", made: false, presOk: false, bakeOk: false, rel: NaN, bbox: NaN, noopP: NaN, noopB: NaN, poseDiff: NaN, shearEdited: false, shearAny: false, ids: "", kinds: "" }); return; }
      for (const [poseName, pose] of Object.entries(poses)) {
        const G = posedFrom(base, { ...pose, x: 90, z: -30, elevation: 10 });
        const opened = openParts(G);
        const noopP = await rebuildPreserving(G, opened, opened, { forceUnpose: true });
        const noopB = await reconstructStrict(G, opened);
        const rel0P = noopP.group ? relSym(G, noopP.group) : NaN, rel0B = noopB.group ? relSym(G, noopB.group) : NaN;
        const shearAny = G.groupedShapes!.some((c) => shears(G, c) > 1e-6);
        for (const [editName, edit] of Object.entries(edits)) {
          const { parts } = edit(opened);
          const pres = await rebuildPreserving(G, parts, opened);
          const bake = await reconstructStrict(G, parts);
          const changed = parts.filter((p) => opened.findIndex((o) => o.id === p.id && JSON.stringify(o) === JSON.stringify(p)) < 0);
          const shearEdited = changed.some((p) => shears(G, unposePart(G, p)) > 1e-6);
          const kinds = pres.group ? restoreGroupedChildren(pres.group).map((p) => p.kind).join(",") : "";
          let leafUntouched = 0, leafEdited = 0;
          if (pres.group && pres.group.groupedShapes?.length === parts.length) {
            const after = restoreGroupedChildren(pres.group);
            parts.forEach((p, j) => { const i = opened.findIndex((o) => o.id === p.id); const same = i >= 0 && JSON.stringify(opened[i]) === JSON.stringify(p); const d = meshDev(after[j], same ? opened[i] : p); if (same) leafUntouched = Math.max(leafUntouched, d); else leafEdited = Math.max(leafEdited, d); });
          } else { leafUntouched = NaN; leafEdited = NaN; }
          rows.push({ leafUntouched, leafEdited, type, pose: poseName, edit: editName, made: true, presOk: Boolean(pres.group), bakeOk: Boolean(bake.group), rel: pres.group && bake.group ? relSym(pres.group, bake.group) : NaN, bbox: pres.group && bake.group ? bboxDev(pres.group, bake.group) : NaN, noopP: rel0P, noopB: rel0B, poseDiff: pres.group ? poseFieldsDiff(pres.group, G) : NaN, shearEdited, shearAny, ids: pres.group ? String(pres.group.groupedShapes!.filter((c, j) => parts[j] && c.id === G.groupedShapes![opened.findIndex((o) => o.id === parts[j].id)]?.id).length) : "", kinds });
        }
      }
      expect(true).toBe(true);
    }, 300_000);
  }
  it("summary", () => {
    for (const type of Object.keys(types)) {
      const mine = rows.filter((r) => r.type === type);
      if (!mine.length || !mine[0].made) { console.info(`[types] ${type}: NOT BUILT (${failures.find((x) => x.startsWith(type)) ?? "builder returned no group"})`); continue; }
      const clean = mine.filter((r) => !r.shearAny && !r.shearEdited && r.presOk && r.bakeOk);
      const m = (sel: Row[], k: keyof Row) => Math.max(0, ...sel.map((r) => (Number.isFinite(r[k] as number) ? (r[k] as number) : 0)));
      const shear = mine.filter((r) => (r.shearAny || r.shearEdited) && r.presOk);
      console.info(`[types] ${type}: cases ${mine.length}; preserving built ${mine.filter((r) => r.presOk).length}, today's built ${mine.filter((r) => r.bakeOk).length}; pose diff max ${f(m(mine, "poseDiff"))}; CLEAN cases ${clean.length}: body vs today's max ${f(m(clean, "rel"))}, bbox ${f(m(clean, "bbox"))}; no-op vs ORIGINAL: preserving max ${f(m(mine, "noopP"))}, today's max ${f(m(mine, "noopB"))}; shear cases ${shear.length}: body vs today's max ${f(m(shear, "rel"))}; LEAF level (world mesh of each part after Done vs what it should be): untouched max ${f(m(mine, "leafUntouched"))}, edited max ${f(m(mine, "leafEdited"))}; part kinds after: ${[...new Set(mine.filter((r) => r.presOk).map((r) => r.kinds))].slice(0, 3).join(" | ")}`);
    }
    failures.forEach((x) => console.info(`[types] ${x}`));
    (require("node:fs") as typeof import("node:fs")).writeFileSync("/tmp/pose-types-rows.json", JSON.stringify(rows));
    expect(rows.length).toBeGreaterThan(0);
  });
});
