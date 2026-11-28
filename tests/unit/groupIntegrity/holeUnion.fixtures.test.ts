import { beforeAll, describe, expect, it, vi } from "vitest";
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
import { disposeManifold, manifoldFromMeshData, restoreGroupedChildren } from "@/lib/editorBooleans";
import { meshForShape } from "@/lib/editorMeshCore";
import { loadedManifoldRuntime } from "@/lib/manifoldHandle";
import { applyMeshRepairs, scanForOpenMeshes } from "@/lib/meshRepair";
import { createKernelMeshCheck } from "@/lib/meshRepairKernel";
import type { WorkplaneShape } from "@/types/layerling";
import { BODY_VOLUME_TOLERANCE } from "./baseline";
import { assertKernelLive, bodyStats, fixturePath, loadFixture, reconstruct, reconstructStrict, startKernel } from "./support";

/*
 * Build 0126 on the real documents (LAYERLING_INTEGRITY_FIXTURES, not in the repository): COST AND CORRECTNESS of the hole-only union. Every hole-only group with a mesh body, at any depth,
 * is opened and finished unchanged through the production reconstruction twice: as native Done runs it now (strict: kernel union) and as it ran before (laid together), before and after
 * the 0124 mesh repair. Prints a table; asserts that every refusal names an object and that every success is a true union.
 */
beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });

function holeOnlyGroups(shapes: readonly WorkplaneShape[], into: WorkplaneShape[] = []): WorkplaneShape[] {
  for (const shape of shapes) {
    const kids = shape.groupedShapes;
    if (!kids?.length) continue;
    if (shape.importedMesh && kids.every((kid) => kid.hole)) into.push(shape);
    holeOnlyGroups(kids, into);
  }
  return into;
}
function truthVolume(parts: WorkplaneShape[]): number | null {
  if (!parts.every((part) => part.importedMesh)) return null;
  const runtime = loadedManifoldRuntime()!;
  const solids: ReturnType<typeof manifoldFromMeshData>[] = [];
  try {
    for (const part of parts) { const solid = manifoldFromMeshData(runtime, meshForShape(part)); solids.push(solid); }
    const union = runtime.Manifold.union(solids);
    try { return union.status() === "NoError" ? union.volume() : null; } finally { disposeManifold(union); }
  } catch { return null; } finally { solids.forEach(disposeManifold); }
}
const pct = (values: number[], p: number) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] : 0;

async function census(label: string, shapes: WorkplaneShape[]) {
  const groups = holeOnlyGroups(shapes);
  const unionMs: number[] = [], concatMs: number[] = [];
  let ok = 0, refused = 0, unnamed = 0, wrongVolume = 0, checked = 0, worstRel = 0, concatOff = 0, unionOff = 0, comparedStored = 0;
  const slow: { name: string; ms: number; triangles: number; parts: number }[] = [];
  const reasons = new Map<string, number>();
  for (const group of groups) {
    const parts = restoreGroupedChildren(group, undefined, { keepPartVisibility: true }).map((part) => ({ ...part, locked: false }));
    let t = performance.now();
    const concat = await reconstruct(group, parts);
    concatMs.push(performance.now() - t);
    t = performance.now();
    const result = await reconstructStrict(group, parts);
    const ms = performance.now() - t;
    unionMs.push(ms);
    const triangles = group.importedMesh?.triangleCount ?? 0;
    slow.push({ name: group.name, ms, triangles, parts: parts.length });
    if (!result.group) {
      refused += 1;
      const text = "failure" in result ? result.failure : "";
      if (!/“[^”]+”/.test(text.replace(/Cannot finish “[^”]*”/, ""))) { unnamed += 1; reasons.set(`UNNAMED: ${text.slice(0, 90)}`, (reasons.get(`UNNAMED: ${text.slice(0, 90)}`) ?? 0) + 1); }
      else reasons.set("names an object (open mesh)", (reasons.get("names an object (open mesh)") ?? 0) + 1);
      continue;
    }
    ok += 1;
    const truth = truthVolume(parts);
    if (truth) { checked += 1; const rel = Math.abs(bodyStats(result.group).volume - truth) / truth; worstRel = Math.max(worstRel, rel); if (rel > BODY_VOLUME_TOLERANCE) wrongVolume += 1; }
    // against the body STORED in the document (the last union that was ever made of these holes)
    const stored = bodyStats(group).volume;
    if (stored > 0 && concat.group) {
      comparedStored += 1;
      if (Math.abs(bodyStats(concat.group).volume - stored) / stored > 0.01) concatOff += 1;
      if (Math.abs(bodyStats(result.group).volume - stored) / stored > 0.01) unionOff += 1;
    }
  }
  slow.sort((a, b) => b.ms - a.ms);
  const lines = [
    `[0126 cost] ${label}: hole-only groups ${groups.length}; union ok ${ok}, refused ${refused} (unnamed ${unnamed}); true-union checks ${checked}, worst relative volume error ${worstRel.toExponential(2)}, over the ${BODY_VOLUME_TOLERANCE} body tolerance: ${wrongVolume}; against the STORED body (${comparedStored} compared), more than 1% off: laid-together ${concatOff}, union ${unionOff}`,
    `[0126 cost] ${label}: union ms median ${pct(unionMs, 0.5).toFixed(1)}, p95 ${pct(unionMs, 0.95).toFixed(1)}, max ${pct(unionMs, 1).toFixed(1)}, total ${unionMs.reduce((a, b) => a + b, 0).toFixed(0)}; laid-together ms median ${pct(concatMs, 0.5).toFixed(1)}, p95 ${pct(concatMs, 0.95).toFixed(1)}, max ${pct(concatMs, 1).toFixed(1)}`,
    `[0126 cost] ${label}: slowest: ${slow.slice(0, 4).map((s) => `${s.name} ${s.ms.toFixed(0)} ms (${s.triangles} tri, ${s.parts} parts)`).join("; ")}`,
    `[0126 cost] ${label}: refusal kinds: ${[...reasons].map(([k, v]) => `${v} x ${k}`).join("; ") || "none"}`,
  ];
  console.info(lines.join("\n"));
  return { groups: groups.length, ok, refused, unnamed, wrongVolume };
}

describe("0126 hole-only union on the real documents", () => {
  for (const [name, file] of [["SAUD", "saud.lyl"], ["Foshay", "foshay.lyl"], ["Depot Window Cutout", "dwc.lyl"]] as const) {
    it.skipIf(!fixturePath(file))(`${name}: cost and correctness, before and after the mesh repair`, async () => {
      const project = await loadFixture(fixturePath(file)!);
      const before = await census(`${name} (unrepaired)`, project.shapes);
      const scan = await scanForOpenMeshes(project.shapes, { kernelValid: await createKernelMeshCheck() });
      const repaired = applyMeshRepairs(project.shapes, scan.repairs).shapes;
      const after = await census(`${name} (after Repair Open Meshes)`, repaired);
      expect(before.unnamed).toBe(0);
      expect(after.unnamed).toBe(0);
      expect(before.wrongVolume).toBe(0);
      expect(after.wrongVolume).toBe(0);
      expect(after.refused).toBeLessThanOrEqual(before.refused);
    }, 900_000);
  }
});
