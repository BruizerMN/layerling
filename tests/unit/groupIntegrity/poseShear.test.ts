import { beforeAll, describe, expect, it, vi } from "vitest";
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, startKernel } from "./support";
import { bboxDev, flatLeaves, leafDev, openParts, posedGroup, primitive, reconstructStrict, rebuildPreserving, relSym } from "./poseLab";
import { unposePart } from "./poseProto";

/** Heavy numerical investigation: run with LAYERLING_POSE_INVESTIGATION=1 (and LAYERLING_INTEGRITY_FIXTURES for the real documents). */
beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });

/*
 * Build 0127 verification, experiment A: ARBITRARY-ANGLE constituent rotations under NON-UNIFORM group stretch (the shear question). Output is a table of measured errors; nothing here changes
 * production behaviour. A part turned by a non-quarter angle inside a group that is stretched along one axis becomes a parallelepiped (a shear) in the exact geometry; the engine's part
 * representation (rotation + three sizes, `groupedPartSizeScale`) is exact only for quarter turns.
 */
const parts = (angle: number, axis: "Y" | "X" | "Z" | "XYZ"): WorkplaneShape[] => {
  const turn = axis === "Y" ? { rotation: angle } : axis === "X" ? { rotationX: angle } : axis === "Z" ? { rotationZ: angle } : { rotation: angle, rotationX: angle * 0.6, rotationZ: angle * 0.4 };
  return [
    primitive("A", "box", { x: 0, width: 40, depth: 20, height: 30 }),
    primitive("H", "cylinder", { x: 0, hole: true, sides: 32, width: 8, depth: 8, height: 40, elevation: -5 }),
    primitive("C", "box", { x: 35, z: 0, elevation: 5, width: 20, depth: 10, height: 10, ...turn }),
  ];
};
const fmt = (v: number) => (Number.isFinite(v) ? v.toExponential(1) : "n/a");
const rows: string[] = [];

describe.skipIf(!process.env.LAYERLING_POSE_INVESTIGATION)("shear and representation limits", () => {
  for (const axis of ["Y", "X", "Z", "XYZ"] as const) {
    for (const angle of [0, 15, 30, 45, 60, 90]) {
      for (const r of [1, 2.5, 5]) {
        it(`part turned ${angle} deg about ${axis}, group stretched x${r} along X`, async () => {
          const G = await posedGroup(parts(angle, axis), { stretch: [r, 1, 1], rotation: 0 });
          const opened = openParts(G);
          // 1. does opening and rebuilding (what today's Done does to every part, edited or not) change the body?
          const baked = (await reconstructStrict(G, opened)).group!;
          const bakeDrift = relSym(G, baked);
          // 2. is the representation invertible? un-pose every opened part and compare with the stored local part
          let invert = 0;
          opened.forEach((p, i) => { const u = unposePart(G, p); const o = G.groupedShapes![i]; for (const k of ["x", "z", "elevation", "width", "depth", "height", "rotation", "rotationX", "rotationZ"] as const) invert = Math.max(invert, Math.abs(((u as never)[k] as number ?? 0) - ((o as never)[k] as number ?? 0))); });
          // 3. an edit elsewhere (move A by 2 mm): the turned part C must come through untouched
          const editA = opened.map((p, i) => (i === 0 ? { ...p, x: p.x + 2 } : p));
          const pa = await rebuildPreserving(G, editA, opened);
          const ba = (await reconstructStrict(G, editA)).group!;
          const cOriginal = flatLeaves(G)[2].verts;
          const cPreserved = pa.group ? flatLeaves(pa.group)[2].verts : [];
          const cBaked = flatLeaves(ba)[2].verts;
          const dev = (a: number[], b: number[]) => (a.length === b.length ? Math.max(...a.map((v, i) => Math.abs(v - b[i]))) : Number.NaN);
          // 4. the turned part itself is moved (world +2 mm in x): where does it end up compared with what the person placed?
          const editC = opened.map((p, i) => (i === 2 ? { ...p, x: p.x + 2 } : p));
          const pc = await rebuildPreserving(G, editC, opened);
          const placedC = flatLeaves({ ...G, groupedShapes: undefined, ...{} } as WorkplaneShape).length; void placedC;
          const wantedC = (await import("./support")).flatLeaves(editC[2]).map((l) => l.verts)[0];
          const gotC = pc.group ? flatLeaves(pc.group)[2].verts : [];
          const bc = (await reconstructStrict(G, editC)).group!;
          rows.push(`${axis.padEnd(3)} ${String(angle).padStart(2)} x${r}  bakeDrift ${fmt(bakeDrift)}  invert ${fmt(invert)}  untouchedC: preserved ${fmt(dev(cOriginal, cPreserved))} baked ${fmt(dev(cOriginal, cBaked))}  movedC vs placed: ${fmt(dev(wantedC, gotC))}  bodies preserve-vs-bake ${fmt(relSym(pa.group!, ba))}/${fmt(relSym(pc.group!, bc))}`);
          expect(pa.group).toBeTruthy();
        });
      }
    }
  }
  it("prints the table", () => { console.info(`[shear]\n${rows.join("\n")}`); expect(rows.length).toBeGreaterThan(0); void bboxDev; void leafDev; });
});
