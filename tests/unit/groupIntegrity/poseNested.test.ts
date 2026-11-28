import { beforeAll, describe, expect, it, vi } from "vitest";
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, editThroughChain, flatLeaves, maxVertexDeviation, startKernel } from "./support";
import { posedGroup, primitive, poseFieldsDiff } from "./poseLab";
import { nestedPreserving } from "./poseProto";

/** Heavy numerical investigation: run with LAYERLING_POSE_INVESTIGATION=1 (and LAYERLING_INTEGRITY_FIXTURES for the real documents). */
beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });
const fmt = (v: number) => v.toExponential(1);

/* Build 0127 verification, experiment E: nested sessions. Each level has its own pose; the deepest level is finished first, then each containing level, as the editor does (finishOpenGroup always finishes the innermost open level). */
describe.skipIf(!process.env.LAYERLING_POSE_INVESTIGATION)("nested sessions with a pose on every level", () => {
  it("three levels: mirror inside rotation inside stretch", async () => {
    const l3 = await posedGroup([primitive("p1", "box", { width: 12, depth: 12, height: 12 }), primitive("p2", "cylinder", { x: 11, sides: 24, width: 8, depth: 8, height: 16 }), primitive("p3", "box", { x: -11, z: 2, width: 6, depth: 6, height: 8 })], { mirrorX: true }, { id: "L3", name: "L3" });
    const l2 = await posedGroup([{ ...l3, x: 18, z: 4 }, primitive("q1", "box", { x: -22, width: 14, depth: 10, height: 12 })], { rotation: 40, stretch: [1.4, 1.4, 1.4] }, { id: "L2", name: "L2" });
    const l1 = await posedGroup([{ ...l2, x: -25 }, primitive("r1", "box", { x: 40, z: 10, width: 20, depth: 12, height: 14 })], { stretch: [2, 1, 1], mirrorZ: true, x: 30 }, { id: "L1", name: "L1" });
    const top = l1;
    const original = flatLeaves(top);
    const mutate = (parts: WorkplaneShape[]) => parts.map((p, i) => (i === 0 ? { ...p, x: p.x + 1.5, z: p.z - 0.5 } : p));
    const pre = await nestedPreserving(top, [0, 0], mutate);
    const cur = await editThroughChain(top, [0, 0], mutate);
    expect(pre.ok && cur.ok).toBe(true);
    if (!pre.ok || !cur.ok) return;
    const dev = (g: WorkplaneShape) => { const l = flatLeaves(g); return l.length === original.length ? l.map((leaf, i) => maxVertexDeviation(leaf.verts, original[i].verts)) : []; };
    const dp = dev(pre.result), dc = dev(cur.result);
    const moved = dp.map((d, i) => (d > 1e-9 ? i : -1)).filter((i) => i >= 0);
    console.info(`[nested] leaves ${original.length}; preserving: leaves that moved ${moved.length} (the edited one expected: 1), others max dev ${fmt(Math.max(0, ...dp.filter((_, i) => !moved.includes(i))))}, top pose diff ${fmt(poseFieldsDiff(pre.result, top))}; today: leaves that moved ${dc.filter((d) => d > 1e-9).length}, top pose diff ${fmt(poseFieldsDiff(cur.result, top))}, top mirrorZ kept ${Boolean(cur.result.mirrorZ)}`);
    expect(moved.length).toBe(1);
  });
});
