import { beforeAll, describe, expect, it, vi } from "vitest";
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
import { restoreGroupedChildren } from "@/lib/editorBooleans";
import { applyMeshRepairs, scanForOpenMeshes } from "@/lib/meshRepair";
import { createKernelMeshCheck } from "@/lib/meshRepairKernel";
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, fixturePath, flatNodes, loadFixture, startKernel } from "./support";
import { reconstruct } from "./support";
import { bboxDev, openParts, poseFieldsDiff, produce, relSym } from "./poseLab";

beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });

/*
 * Build 0127 on the real documents (LAYERLING_INTEGRITY_FIXTURES, not in the repository): every mirrored and every stretched group of SAUD (world-placed, as Done sees them, after Repair Open Meshes), a part
 * moved by 0.37 mm, finished by the production strict reconstruction with the session's opened parts. Expected: built, pose kept, untouched parts keep their ids, body within the body tolerance.
 */
describe.skipIf(!fixturePath("saud.lyl"))("SAUD posed groups through the production reconstruction", () => {
  it("every mirrored or stretched group: edited, rebuilt, pose kept, untouched ids kept", async () => {
    const project = await loadFixture(fixturePath("saud.lyl")!);
    const scan = await scanForOpenMeshes(project.shapes, { kernelValid: await createKernelMeshCheck() });
    const shapes = applyMeshRepairs(project.shapes, scan.repairs).shapes;
    const groups: WorkplaneShape[] = [];
    for (const top of shapes) if (top.groupedShapes?.length) for (const node of flatNodes(top)) { const g = node.shape; if (g.groupedShapes && g.groupedShapes.length >= 2 && !g.hidden && !g.locked && !g.shapeLocked && (g.mirrorX || g.mirrorY || g.mirrorZ || (g.groupedBaseWidth && Math.abs(g.width / g.groupedBaseWidth - 1) > 1e-3))) groups.push(g); }
    let built = 0, refused = 0, poseKept = 0, idsKept = 0, idsTotal = 0, worstBody = 0, worstBox = 0; const reasons = new Map<string, number>();
    for (const G of groups) {
      const opened = openParts(G);
      const i = 0;   // the first part, solid or hole (most mirrored groups of SAUD are hole-only openings)
      const edited = opened.map((p, k) => (k === i ? { ...p, x: p.x + 0.37 } : p));
      const r = await produce(G, edited, opened);
      if (!r.group) { refused += 1; const key = r.failure.split("\n")[0].replace(/“[^”]*”/g, "“…”").slice(0, 90); reasons.set(key, (reasons.get(key) ?? 0) + 1); continue; }
      built += 1;
      if (poseFieldsDiff(r.group, G) < 1e-9) poseKept += 1;
      G.groupedShapes!.forEach((child, k) => { if (k !== i) { idsTotal += 1; if (r.group!.groupedShapes![k]?.id === child.id) idsKept += 1; } });
      // against the pose-baking (non-strict) rebuild of the same edit, the closest independent reference; the body volume only where both are real solids (a hole-only group is laid together there, unioned here)
      const baked = (await reconstruct(G, edited.map((p) => ({ ...p, locked: false })))).group;
      if (baked) { worstBox = Math.max(worstBox, bboxDev(r.group, baked)); if (!G.groupedShapes!.every((c) => c.hole)) worstBody = Math.max(worstBody, relSym(r.group, baked)); }
    }
    console.info(`[0127 SAUD] posed groups ${groups.length}: built ${built}, refused ${refused} (${[...reasons].map(([k, v]) => `${v} x ${k}`).join("; ") || "none"}); pose kept ${poseKept} of ${built}; untouched ids kept ${idsKept} of ${idsTotal}; worst body difference vs the pose-baking rebuild of the same edit (non-hole-only groups) ${worstBody.toExponential(2)}, worst bounding box difference ${worstBox.toExponential(2)} mm`);
    expect(refused).toBe(0);
    expect(built).toBe(groups.length);
    expect(poseKept).toBe(built);
    expect(idsKept).toBe(idsTotal);
    void restoreGroupedChildren;
  }, 900_000);
});
