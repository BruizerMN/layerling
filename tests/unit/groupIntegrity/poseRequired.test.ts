import { beforeAll, describe, expect, it, vi } from "vitest";
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, primitive, reconstruct, startKernel } from "./support";
import { openParts, poseFieldsDiff, posedGroup, produce, relSym } from "./poseLab";

beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });

/*
 * Build 0127: what native (strict) Done delivers for an EDITED, pose-carrying group (decision A2). These were the failing-first tests of the verification phase (`it.fails` against the pose-baking
 * reconstruction); since 0127 they are plain tests of the PRODUCTION strict reconstruction. The pose-baking behaviour that remains (the browser's non-strict path) is checked at the end.
 */
const local = (): WorkplaneShape[] => [
  primitive("A", "box", { x: 0, width: 40, depth: 20, height: 30 }),
  primitive("H", "cylinder", { x: 0, hole: true, sides: 32, width: 8, depth: 8, height: 40, elevation: -5 }),
  primitive("B", "box", { x: 34, z: 2, elevation: 3, width: 18, depth: 12, height: 14 }),
];
const edit = (parts: WorkplaneShape[]) => parts.map((p, i) => (i === 2 ? { ...p, x: p.x + 3 } : p));

describe("strict Done on an edited, posed group (Build 0127)", () => {
  it("rotation, mirror and stretch of the group are kept", async () => {
    const G = await posedGroup(local(), { rotation: 20, rotationX: 35, rotationZ: 50, mirrorX: true, stretch: [1.7, 1.7, 1.7] });
    const opened = openParts(G);
    const result = await produce(G, edit(opened), opened);
    expect(result.group).toBeTruthy();
    expect(poseFieldsDiff(result.group!, G)).toBeLessThan(1e-9);
  });
  it("untouched parts keep their original ids", async () => {
    const G = await posedGroup(local(), { mirrorX: true });
    const opened = openParts(G);
    const result = await produce(G, edit(opened), opened);
    expect(result.group!.groupedShapes!.map((part) => part.id).slice(0, 2)).toEqual(G.groupedShapes!.map((part) => part.id).slice(0, 2));
  });
  it("a part turned by a non-quarter angle in a non-uniformly stretched group is not changed by an edit elsewhere", async () => {
    const parts = local();
    parts[2] = { ...parts[2], rotation: 30 };
    const G = await posedGroup(parts, { stretch: [2.5, 1, 1] });
    const opened = openParts(G);
    const moveFirst = opened.map((p, i) => (i === 0 ? { ...p, x: p.x + 1 } : p));
    const result = await produce(G, moveFirst, opened);
    expect(relSym(result.group!, G)).toBeLessThan(0.02);   // moving A by 1 mm changes the body by well under 1%; the pose-baking reconstruction changes it by tens of percent
  });
  it("an edit that makes a part shear under the group's non-uniform stretch is refused, naming the part, and the session stays open", async () => {
    const G = await posedGroup(local(), { stretch: [2, 1.3, 0.6], rotation: 33 });
    const opened = openParts(G);
    const turned = opened.map((p, i) => (i === 2 ? { ...p, rotation: (p.rotation ?? 0) + 25 } : p));
    const result = await produce(G, turned, opened);
    expect(result.group).toBeNull();
    expect(result.failure).toMatch(/“B”/);
    expect(result.failure).toContain("resized unevenly");
    expect(result.failure).toContain("Group Editing remains open");
  });
  it("the browser's non-strict reconstruction is unchanged: it still bakes the pose into the parts", async () => {
    const G = await posedGroup(local(), { rotation: 20, mirrorX: true });
    const baked = await reconstruct(G, edit(openParts(G)));
    expect(baked.group).toBeTruthy();
    expect(poseFieldsDiff(baked.group!, G)).toBeGreaterThan(0.5);
  });
});
