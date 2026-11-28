import { beforeAll, describe, expect, it, vi } from "vitest";
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
import { restoreGroupedChildren } from "@/lib/editorBooleans";
import { meshForShape } from "@/lib/editorMeshCore";
import { applyMeshRepairs, scanForOpenMeshes } from "@/lib/meshRepair";
import { createKernelMeshCheck } from "@/lib/meshRepairKernel";
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, fixturePath, flatNodes, loadFixture, maxVertexDeviation, startKernel } from "./support";
import { bboxDev, openParts, posedGroup, primitive, rebuildPreserving, reconstructStrict, relSym } from "./poseLab";

/** Heavy numerical investigation: run with LAYERLING_POSE_INVESTIGATION=1 (and LAYERLING_INTEGRITY_FIXTURES for the real documents). */
beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });

/*
 * Build 0127 verification, experiment D: CUMULATIVE DRIFT over repeated REAL edit-and-Done cycles (not unchanged Done, which is restored exactly and never reconstructs). Each cycle opens the group,
 * moves one part by +d (odd cycles) or -d (even cycles), and finishes; after an even number of cycles the net edit is zero, so the group should be where it began. Compared: today's strict Done
 * (bakes the pose, re-rounds the frame every cycle) and the prototype (pose kept, untouched parts verbatim).
 */
const parts = (scale: number) => [primitive("A", "box", { x: 0, width: 40 * scale, depth: 20 * scale, height: 30 * scale }), primitive("H", "cylinder", { x: 0, hole: true, sides: 32, width: 8 * scale, depth: 8 * scale, height: 40 * scale, elevation: -5 * scale }), primitive("B", "box", { x: 34 * scale, z: 2 * scale, elevation: 3 * scale, width: 18 * scale, depth: 12 * scale, height: 14 * scale }), primitive("C", "cylinder", { x: -30 * scale, sides: 36, width: 12 * scale, depth: 12 * scale, height: 22 * scale })];
const meshVerts = (s: WorkplaneShape) => { const out: number[] = []; meshForShape(s).vertices.forEach((v) => out.push(...v)); return out; };
const fmt = (v: number) => (Number.isFinite(v) ? v.toExponential(1) : "n/a");
type Method = "today" | "preserving";

async function cycles(G0: WorkplaneShape, method: Method, n: number, delta: number, movedIndex: number, watchIndex: number, checkpoints: number[]) {
  let G = G0;
  const original = openParts(G0);
  const out: string[] = [];
  for (let c = 1; c <= n; c += 1) {
    const opened = openParts(G);
    const sign = c % 2 === 1 ? 1 : -1;
    const edited = opened.map((p, i) => (i === movedIndex ? { ...p, x: p.x + sign * delta } : p));
    const next = method === "today" ? (await reconstructStrict(G, edited)).group : (await rebuildPreserving(G, edited, opened)).group;
    if (!next) { out.push(`cycle ${c}: build failed`); break; }
    G = next;
    if (checkpoints.includes(c)) {
      const now = restoreGroupedChildren(G);
      const untouched = Math.max(0, ...now.map((p, i) => (i === movedIndex || original[i] === undefined ? 0 : maxVertexDeviation(meshVerts(p), meshVerts(original[i])))));
      const watched = maxVertexDeviation(meshVerts(now[watchIndex]), meshVerts(original[watchIndex]));
      const even = c % 2 === 0;
      out.push(`c${c}${even ? "" : "(odd)"}: untouched-parts world dev ${fmt(untouched)}${even ? `, moved part back ${fmt(maxVertexDeviation(meshVerts(now[movedIndex]), meshVerts(original[movedIndex])))}, body vs start ${fmt(relSym(G, G0))} bbox ${fmt(bboxDev(G, G0))}` : ""}, frame: ${["x", "z", "elevation", "width", "depth", "height"].map((k) => Math.abs((G as never)[k] as number - ((G0 as never)[k] as number))).map(fmt).join("/")}, rot/mirror kept ${G.rotation === G0.rotation && Boolean(G.mirrorX) === Boolean(G0.mirrorX) ? "yes" : "NO"}`);
      void watched;
    }
  }
  return out;
}

describe.skipIf(!process.env.LAYERLING_POSE_INVESTIGATION)("drift over repeated edit cycles (synthetic)", () => {
  const scenarios: [string, number, Parameters<typeof posedGroup>[1]][] = [
    ["plain 40 mm group, no pose", 1, {}],
    ["tiny 3 mm group (0.001 rounding matters), no pose", 0.075, {}],
    ["mirrored in X", 1, { mirrorX: true }],
    ["non-uniform stretch (2, 1.3, 0.6), quarter-turn parts", 1, { stretch: [2, 1.3, 0.6] }],
    ["rotated (20, 35, 50) + uniform stretch 1.7 + mirror XZ", 1, { rotation: 20, rotationX: 35, rotationZ: 50, stretch: [1.7, 1.7, 1.7], mirrorX: true, mirrorZ: true }],
  ];
  for (const [name, scale, pose] of scenarios) {
    it(name, async () => {
      const G0 = await posedGroup(parts(scale), { ...pose, x: 120, z: -40, elevation: 15 });
      const delta = 0.37 * scale;
      const lines: string[] = [];
      for (const method of ["today", "preserving"] as Method[]) lines.push(`  ${method}: ${(await cycles(G0, method, 40, delta, 2, 3, [2, 10, 20, 40])).join(" | ")}`);
      console.info(`[drift] ${name} (delta ${delta.toFixed(4)} mm, group ${G0.width.toFixed(2)}x${G0.depth.toFixed(2)}x${G0.height.toFixed(2)})\n${lines.join("\n")}`);
      expect(true).toBe(true);
    }, 600_000);
  }
});

describe.skipIf(!process.env.LAYERLING_POSE_INVESTIGATION)("drift over repeated edit cycles (real documents)", () => {
  for (const [name, file, pick] of [["SAUD mirrored groups", "saud.lyl", "mirror"], ["Foshay groups whose frame shifts on rebuild (D11)", "foshay.lyl", "shift"]] as const) {
    it.skipIf(!fixturePath(file))(name, async () => {
      const project = await loadFixture(fixturePath(file)!);
      const scan = await scanForOpenMeshes(project.shapes, { kernelValid: await createKernelMeshCheck() });
      const shapes = applyMeshRepairs(project.shapes, scan.repairs).shapes;   // after Repair Open Meshes, so strict Done can rebuild
      const candidates: WorkplaneShape[] = [];
      for (const top of shapes) if (top.groupedShapes?.length) for (const node of flatNodes(top)) { const g = node.shape; if (g.groupedShapes && g.groupedShapes.length >= 2 && !g.hidden && !g.locked && (g.importedMesh?.triangleCount ?? 0) < 20000 && g.groupedShapes.some((c) => !c.hole)) candidates.push(g); }
      let chosen: WorkplaneShape[] = [];
      if (pick === "mirror") chosen = candidates.filter((g) => g.mirrorX || g.mirrorY || g.mirrorZ).slice(0, 6);
      else for (const g of candidates) { if (chosen.length >= 6) break; const r = await reconstructStrict(g, openParts(g)); if (r.group && bboxDev(g, r.group) > 0.01) chosen.push(g); }
      console.info(`[drift] ${name}: ${chosen.length} groups chosen of ${candidates.length} candidates`);
      for (const G0 of chosen.slice(0, 4)) {
        const opened = openParts(G0);
        const movedIndex = opened.findIndex((p) => !p.hole);
        const watchIndex = opened.length - 1;
        const lines: string[] = [];
        for (const method of ["today", "preserving"] as Method[]) lines.push(`  ${method}: ${(await cycles(G0, method, 20, 0.37, movedIndex, watchIndex, [2, 10, 20])).join(" | ")}`);
        console.info(`[drift] ${name}: "${G0.name}" ${opened.length} parts, mirror ${Boolean(G0.mirrorX || G0.mirrorY || G0.mirrorZ)}, size ${G0.width.toFixed(1)}x${G0.depth.toFixed(1)}x${G0.height.toFixed(1)}\n${lines.join("\n")}`);
      }
      expect(true).toBe(true);
    }, 1_800_000);
  }
});
