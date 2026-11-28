import { beforeAll, describe, expect, it, vi } from "vitest";
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
import { groupPartAxes, restoreGroupedChildren } from "@/lib/editorBooleans";
import { meshForShape } from "@/lib/editorMeshCore";
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, maxVertexDeviation, startKernel } from "./support";
import { bboxDev, makeGroup, openParts, poseFieldsDiff, posedGroup, primitive, rebuildPreserving, reconstructStrict, relSym, type Pose } from "./poseLab";
import { frameOf, unposePart } from "./poseProto";

/** Heavy numerical investigation: run with LAYERLING_POSE_INVESTIGATION=1 (and LAYERLING_INTEGRITY_FIXTURES for the real documents). */
beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });

/*
 * Build 0127 verification, experiment B: the matrix. Part sets x poses x edits, run through the prototype (un-pose, rebuild in the own frame, re-pose) and through today's strict Done (which bakes
 * the pose), measuring: pose fields kept, original ids and values of untouched parts, world placement of untouched and edited parts, body bounding box and symmetric-difference volume against
 * today's result and against the ORIGINAL body (the only oracle for untouched geometry), and kernel validity. Numbers only: no production behaviour changes.
 */
const cutter = async (id: string, x: number) => ({ ...(await makeGroup([primitive(`${id}b`, "box", { x, width: 40, depth: 30, height: 30 }), primitive(`${id}c`, "cylinder", { x, hole: true, sides: 32, width: 8, depth: 8, height: 40, elevation: -5 })])), id, name: `Cutter ${id}`, hole: true }) as WorkplaneShape;
const partSets: Record<string, () => Promise<WorkplaneShape[]>> = {
  primitivesOnly: async () => [primitive("a", "box", { x: -20, width: 20, depth: 10, height: 15 }), primitive("b", "cylinder", { x: 8, z: 3, elevation: 4, width: 12, depth: 12, height: 9, sides: 48 }), primitive("c", "box", { x: 30, width: 8, depth: 8, height: 20 })],
  cutQuarter: async () => [primitive("A", "box", { x: 0, width: 40, depth: 20, height: 30 }), primitive("H", "cylinder", { x: 0, hole: true, sides: 32, width: 8, depth: 8, height: 40, elevation: -5 }), primitive("C", "box", { x: 35, elevation: 5, width: 20, depth: 10, height: 10, rotation: 90 })],
  cutArbitraryY: async () => [primitive("A", "box", { x: 0, width: 40, depth: 20, height: 30 }), primitive("H", "cylinder", { x: 0, hole: true, sides: 32, width: 8, depth: 8, height: 40, elevation: -5 }), primitive("C", "box", { x: 35, elevation: 5, width: 20, depth: 10, height: 10, rotation: 30 })],
  threeAxisParts: async () => [primitive("A", "box", { x: 0, width: 40, depth: 20, height: 30, rotation: 20, rotationX: 35, rotationZ: 50 }), primitive("B", "cylinder", { x: 30, z: 5, elevation: 3, sides: 32, width: 12, depth: 12, height: 25, rotation: 15, rotationX: 70 }), primitive("H", "box", { x: 10, hole: true, width: 10, depth: 10, height: 50, elevation: -10, rotationZ: 25 })],
  importedBody: async () => [{ ...(await makeGroup([primitive("ib", "box", { width: 30, depth: 20, height: 20 }), primitive("ic", "cylinder", { hole: true, sides: 32, width: 6, depth: 6, height: 30, elevation: -5 })])), id: "imp", name: "Block" } as WorkplaneShape, primitive("p", "box", { x: 28, width: 14, depth: 10, height: 12 })],
  nestedGroup: async () => [{ ...(await makeGroup([primitive("n1", "box", { width: 20, depth: 20, height: 20 }), primitive("n2", "cylinder", { x: 14, sides: 32, width: 10, depth: 10, height: 26 })])), id: "inner", name: "Inner" } as WorkplaneShape, primitive("o", "box", { x: -30, width: 16, depth: 16, height: 10 }), primitive("oh", "cylinder", { x: -30, hole: true, sides: 24, width: 5, depth: 5, height: 20, elevation: -3 })],
  holeOnly: async () => [await cutter("c1", 0), await cutter("c2", 25)],
};
const poses: Record<string, Pose> = {
  none: {}, rotY30: { rotation: 30 }, rotXYZ: { rotation: 20, rotationX: 35, rotationZ: 50 }, mirrorX: { mirrorX: true }, mirrorY: { mirrorY: true }, mirrorZ: { mirrorZ: true },
  mirrorXZ_rot70: { mirrorX: true, mirrorZ: true, rotation: 70 }, stretchX2_5: { stretch: [2.5, 1, 1] }, stretchUniform1_7: { stretch: [1.7, 1.7, 1.7] }, stretchNonUniform: { stretch: [2, 1.3, 0.6] },
  stretch_rot33: { stretch: [2, 1.3, 0.6], rotation: 33 }, stretch_rotXYZ_mirrorXZ: { stretch: [2, 1.3, 0.6], rotation: 20, rotationX: 35, rotationZ: 50, mirrorX: true, mirrorZ: true },
};
const solidIndex = (parts: WorkplaneShape[], last = false) => { const idx = parts.map((p, i) => (p.hole ? -1 : i)).filter((i) => i >= 0); return last ? idx.at(-1)! : idx[0]; };
type Edit = (parts: WorkplaneShape[]) => { parts: WorkplaneShape[]; touched: number[] };
const edits: Record<string, Edit> = {
  moveFirst: (p) => { const i = solidIndex(p); return { parts: p.map((s, k) => (k === i ? { ...s, x: s.x + 3, z: s.z - 2 } : s)), touched: [i] }; },
  moveLast: (p) => { const i = solidIndex(p, true); return { parts: p.map((s, k) => (k === i ? { ...s, x: s.x + 3, z: s.z - 2 } : s)), touched: [i] }; },
  resizeLast: (p) => { const i = solidIndex(p, true); return { parts: p.map((s, k) => (k === i ? { ...s, width: s.width * 1.25, depth: s.depth * 1.25, size: s.size * 1.25, height: s.height * 1.1 } : s)), touched: [i] }; },
  rotateLast25: (p) => { const i = solidIndex(p, true); return { parts: p.map((s, k) => (k === i ? { ...s, rotation: (s.rotation ?? 0) + 25 } : s)), touched: [i] }; },
  deleteLast: (p) => { const i = solidIndex(p, true); return { parts: p.filter((_, k) => k !== i), touched: [i] }; },
  addBox: (p) => { const c = p[0]; return { parts: [...p, primitive("new", "box", { x: c.x + 15, z: c.z + 8, elevation: c.elevation ?? 0, width: 9, depth: 9, height: 12 })], touched: [] }; },
  replaceFirst: (p) => { const i = solidIndex(p); const old = p[i]; return { parts: p.map((s, k) => (k === i ? primitive("repl", "box", { x: old.x, z: old.z, elevation: old.elevation ?? 0, width: 12, depth: 12, height: 12 }) : s)), touched: [i] }; },
};

/** A part shears under the group's stretch when the stretched axes of the part are no longer perpendicular. */
function shearOf(G: WorkplaneShape, part: WorkplaneShape) {
  const [sx, sy, sz] = frameOf(G).S;
  const v = groupPartAxes(part).map(([x, y, z]) => [x * sx, y * sy, z * sz] as const);
  const dot = (a: readonly number[], b: readonly number[]) => (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
  return Math.max(Math.abs(dot(v[0], v[1])), Math.abs(dot(v[0], v[2])), Math.abs(dot(v[1], v[2])));
}
const meshDev = (a: WorkplaneShape, b: WorkplaneShape) => {
  const va: number[] = [], vb: number[] = [];
  meshForShape(a).vertices.forEach((v) => va.push(...v)); meshForShape(b).vertices.forEach((v) => vb.push(...v));
  return maxVertexDeviation(va, vb);
};

const diffKeys: Record<string, number> = {};
type Row = { presOk: boolean; bakeOk: boolean; label: string; shearEdited: boolean; shearAny: boolean; ok: boolean; valid: boolean; poseDiff: number; idsKept: number; untouched: number; valuesVerbatim: number; maxShift: number; untouchedDev: number; editedDev: number; bboxVsBake: number; relVsBake: number; relNoopPreserve: number; relNoopBake: number };
const rows: Row[] = [];

describe.skipIf(!process.env.LAYERLING_POSE_INVESTIGATION)("verification matrix", () => {
  for (const [setName, make] of Object.entries(partSets)) {
    for (const [poseName, pose] of Object.entries(poses)) {
      it(`${setName} / ${poseName}`, async () => {
        const local = await make();
        const G = await posedGroup(local, { ...pose, x: 120, z: -40, elevation: 15 });
        const opened = openParts(G);
        const shear = G.groupedShapes!.map((c) => shearOf(G, c));
        // no-op through the reconstruction machinery (every part forced through the inverse): the best test of the representation
        const noopP = await rebuildPreserving(G, opened, opened, { forceUnpose: true });
        const noopB = await reconstructStrict(G, opened);
        const relNoopPreserve = noopP.group ? relSym(G, noopP.group) : Number.NaN;
        const relNoopBake = noopB.group ? relSym(G, noopB.group) : Number.NaN;
        for (const [editName, edit] of Object.entries(edits)) {
          const { parts, touched } = edit(opened);
          const pres = await rebuildPreserving(G, parts, opened);
          const bake = await reconstructStrict(G, parts);
          const label = `${setName}/${poseName}/${editName}`;
          if (!pres.group || !bake.group) { rows.push({ presOk: Boolean(pres.group), bakeOk: Boolean(bake.group), label, shearEdited: false, shearAny: false, ok: false, valid: false, poseDiff: Number.NaN, idsKept: 0, untouched: 0, valuesVerbatim: 0, maxShift: 0, untouchedDev: Number.NaN, editedDev: Number.NaN, bboxVsBake: Number.NaN, relVsBake: Number.NaN, relNoopPreserve, relNoopBake }); continue; }
          const after = restoreGroupedChildren(pres.group);
          let idsKept = 0, untouched = 0, valuesVerbatim = 0, maxShift = 0, untouchedDev = 0, editedDev = 0;
          parts.forEach((p, j) => {
            const i = opened.findIndex((o) => o.id === p.id);
            const original = i >= 0 ? G.groupedShapes![i] : undefined;
            const child = pres.group!.groupedShapes![j];
            if (original && !touched.includes(i)) {
              untouched += 1;
              if (child.id === original.id) idsKept += 1;
              // `hole: undefined` and `hole: false` are the same thing (withHoleMode writes the boolean everywhere); position and id of the direct part are compared separately
              const norm = (v: unknown): unknown => (Array.isArray(v) ? v.map(norm) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, w]) => [k, k === "hole" ? Boolean(w) : norm(w)])) : v);
              const strip = (s: WorkplaneShape) => { const { x, z, elevation, id, ...rest } = s as never as Record<string, unknown>; void x; void z; void elevation; void id; return JSON.stringify(norm({ ...rest, hole: Boolean((rest as { hole?: boolean }).hole) })); };
              if (strip(child) === strip(original)) valuesVerbatim += 1;
              else { const a = child as never as Record<string, unknown>, b = original as never as Record<string, unknown>; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!['x', 'z', 'elevation', 'id'].includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffKeys[k] = (diffKeys[k] ?? 0) + 1; }
              maxShift = Math.max(maxShift, Math.abs(child.x - original.x), Math.abs(child.z - original.z), Math.abs((child.elevation ?? 0) - (original.elevation ?? 0)));
              untouchedDev = Math.max(untouchedDev, meshDev(after[j], opened[i]));
            } else editedDev = Math.max(editedDev, meshDev(after[j], p));
          });
          const changedNow = parts.filter((p) => { const i = opened.findIndex((o) => o.id === p.id); return i < 0 || touched.includes(i); });
          const shearEdited = changedNow.some((p) => shearOf(G, unposePart(G, p)) > 1e-6);
          rows.push({ presOk: true, bakeOk: true, label, shearEdited, shearAny: shear.some((s) => s > 1e-6), ok: true, valid: Number.isFinite(relSym(pres.group, bake.group)), poseDiff: poseFieldsDiff(pres.group, G), idsKept, untouched, valuesVerbatim, maxShift, untouchedDev, editedDev, bboxVsBake: bboxDev(pres.group, bake.group), relVsBake: relSym(pres.group, bake.group), relNoopPreserve, relNoopBake });
        }
        expect(true).toBe(true);
      }, 120_000);
    }
  }

  it("prints the summary", () => {
    const f = (v: number) => (Number.isFinite(v) ? v.toExponential(2) : "NaN");
    const cat = (name: string, sel: Row[]) => {
      const ok = sel.filter((r) => r.ok);
      const max = (k: keyof Row) => Math.max(0, ...ok.map((r) => (Number.isFinite(r[k] as number) ? (r[k] as number) : 0)));
      const untouchedTotal = ok.reduce((a, r) => a + r.untouched, 0);
      console.info(`[matrix] ${name}: cases ${sel.length}, built ${ok.length}, kernel-valid ${ok.filter((r) => r.valid).length}; pose max diff ${f(max("poseDiff"))}; untouched parts ${untouchedTotal}: id kept ${ok.reduce((a, r) => a + r.idsKept, 0)}, values verbatim ${ok.reduce((a, r) => a + r.valuesVerbatim, 0)}, max frame shift ${f(max("maxShift"))}, max world dev ${f(max("untouchedDev"))}; edited-part world dev max ${f(max("editedDev"))}; bbox vs today's ${f(max("bboxVsBake"))}; body vs today's (rel sym diff) ${f(max("relVsBake"))}; NO-OP vs ORIGINAL body: preserving ${f(max("relNoopPreserve"))}, today's bake ${f(max("relNoopBake"))}`);
    };
    cat("ALL", rows);
    cat("A. CLEAN: no part shears (before or after the edit)", rows.filter((r) => !r.shearAny && !r.shearEdited));
    cat("B. shear only in UNTOUCHED parts of the original", rows.filter((r) => r.shearAny && !r.shearEdited));
    cat("C. a CHANGED or NEW part shears under the group stretch", rows.filter((r) => r.shearEdited));
    console.info(`[matrix] fields that differ on "non-verbatim" untouched parts: ${JSON.stringify(diffKeys)}`);
    const fails = rows.filter((r) => !r.ok).map((r) => `${r.label}[pres ${r.presOk ? "ok" : "FAIL"}, today ${r.bakeOk ? "ok" : "FAIL"}]`);
    console.info(`[matrix] builds that failed (${fails.length}): ${fails.slice(0, 40).join(", ")}`);
    const worst = [...rows].filter((r) => r.ok && !r.shearEdited).sort((a, b) => (Number.isFinite(b.relVsBake) ? b.relVsBake : 9) - (Number.isFinite(a.relVsBake) ? a.relVsBake : 9)).slice(0, 8);
    console.info(`[matrix] worst non-shear-edited cases by body difference: ${worst.map((r) => `${r.label} ${f(r.relVsBake)}`).join("; ")}`);
    (require("node:fs") as typeof import("node:fs")).writeFileSync("/tmp/pose-matrix-rows.json", JSON.stringify(rows));
    expect(rows.length).toBeGreaterThan(100);
  });
});
