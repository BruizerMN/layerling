import { beforeAll, describe, expect, it, vi } from "vitest";
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
import { applyMeshRepairs, scanForOpenMeshes } from "@/lib/meshRepair";
import { createKernelMeshCheck } from "@/lib/meshRepairKernel";
import { createMeshOfferScheduler, type MeshOfferScan } from "@/lib/meshRepairOffer";
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, fixturePath, loadFixture, startKernel } from "./support";

/*
 * Build 0125 on the real documents (LAYERLING_INTEGRITY_FIXTURES, not in the repository): the scheduler driven by the very same scan the editor uses offers exactly the counts
 * the explicit command reports, stays silent on a repaired document, and records the scan time.
 */
beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });

async function runLoad(shapes: WorkplaneShape[]) {
  const kernelValid = await createKernelMeshCheck();
  const offers: { meshes: number; objects: number }[] = [];
  let scanMs = 0;
  let timer: (() => void) | null = null;
  const scheduler = createMeshOfferScheduler({
    isBusy: () => false,
    scan: async (): Promise<MeshOfferScan> => {
      const started = performance.now();
      const scan = await scanForOpenMeshes(shapes, { kernelValid });
      scanMs = performance.now() - started;
      return { kind: "counts", meshes: scan.repairs.size, objects: scan.objects, scene: shapes, ms: scanMs };
    },
    isCurrent: (scene) => scene === shapes,
    offer: (c) => { offers.push({ meshes: c.meshes, objects: c.objects }); return true; },
    setTimer: (run) => { timer = run; return 1; },
    clearTimer: () => {},
  });
  scheduler.start();
  timer!();
  while (scheduler.state() === "waiting" || scheduler.state() === "scanning") await new Promise((r) => setTimeout(r, 5));
  return { offers, scanMs, state: scheduler.state() };
}

describe("0125 on the real documents", () => {
  for (const [name, file, meshes, objects] of [["SAUD", "saud.lyl", 285, 749], ["Foshay", "foshay.lyl", 57, 57], ["Depot Window Cutout", "dwc.lyl", 1, 1]] as const) {
    it.skipIf(!fixturePath(file))(`${name}: the on-load offer carries the command's counts (${meshes} meshes / ${objects} objects), then the repaired document is silent`, async () => {
      const project = await loadFixture(fixturePath(file)!);
      const first = await runLoad(project.shapes);
      expect(first.state).toBe("offered");
      expect(first.offers).toEqual([{ meshes, objects }]);
      console.info(`[0125] ${name}: scan with kernel check ${Math.round(first.scanMs)} ms`);
      const scan = await scanForOpenMeshes(project.shapes, { kernelValid: await createKernelMeshCheck() });
      const repaired = applyMeshRepairs(project.shapes, scan.repairs).shapes;
      const second = await runLoad(repaired);
      expect(second.state).toBe("silent");
      expect(second.offers).toEqual([]);
    }, 120_000);
  }
});
