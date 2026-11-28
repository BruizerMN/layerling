import { beforeAll, describe, expect, it, vi } from "vitest";
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, primitive, startKernel } from "./support";
import { openParts, poseFieldsDiff, posedGroup, reconstructStrict, relSym } from "./poseLab";

beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });

/*
 * Build 0127, FAILING FIRST: what native Done must deliver for an EDITED, pose-carrying group (decision A2, Bill's Q1-Q4 of 2026-11-27). They run against the PRODUCTION strict reconstruction, so they
 * pass-as-expected-failures (`it.fails`) while today's behaviour (the pose is baked into the parts) stands, and turn into failures, the signal to make them plain tests, once 0127 delivers.
 * Measured evidence behind each: BUILD-0127-VERIFICATION.md. Nothing here changes production behaviour.
 */
const local = (): WorkplaneShape[] => [
  primitive("A", "box", { x: 0, width: 40, depth: 20, height: 30 }),
  primitive("H", "cylinder", { x: 0, hole: true, sides: 32, width: 8, depth: 8, height: 40, elevation: -5 }),
  primitive("B", "box", { x: 34, z: 2, elevation: 3, width: 18, depth: 12, height: 14 }),
];
const edit = (parts: WorkplaneShape[]) => parts.map((p, i) => (i === 2 ? { ...p, x: p.x + 3 } : p));

describe("required behaviour of strict Done on an edited, posed group (failing first)", () => {
  it.fails("rotation, mirror and stretch of the group are kept (today they are baked into the parts)", async () => {
    const G = await posedGroup(local(), { rotation: 20, rotationX: 35, rotationZ: 50, mirrorX: true, stretch: [1.7, 1.7, 1.7] });
    const result = await reconstructStrict(G, edit(openParts(G)));
    expect(result.group).toBeTruthy();
    expect(poseFieldsDiff(result.group!, G)).toBeLessThan(1e-9);
  });
  it.fails("untouched parts keep their original ids", async () => {
    const G = await posedGroup(local(), { mirrorX: true });
    const result = await reconstructStrict(G, edit(openParts(G)));
    expect(result.group!.groupedShapes!.map((part) => part.id).slice(0, 2)).toEqual(G.groupedShapes!.map((part) => part.id).slice(0, 2));
  });
  it.fails("a part turned by a non-quarter angle in a non-uniformly stretched group is not changed by an edit elsewhere", async () => {
    const parts = local();
    parts[2] = { ...parts[2], rotation: 30 };
    const G = await posedGroup(parts, { stretch: [2.5, 1, 1] });
    const moveFirst = openParts(G).map((p, i) => (i === 0 ? { ...p, x: p.x + 1 } : p));
    const result = await reconstructStrict(G, moveFirst);
    // moving A by 1 mm changes the body by well under 1%; today the sheared part B is re-derived from its unsheared opened approximation and the body changes by tens of percent
    expect(relSym(result.group!, G)).toBeLessThan(0.02);
  });
  it.fails("an edit that makes a part shear under the group's non-uniform stretch is refused, naming the part", async () => {
    const G = await posedGroup(local(), { stretch: [2, 1.3, 0.6], rotation: 33 });
    const turned = openParts(G).map((p, i) => (i === 2 ? { ...p, rotation: (p.rotation ?? 0) + 25 } : p));
    const result = await reconstructStrict(G, turned);
    expect(result.group).toBeNull();
    expect("failure" in result && result.failure).toMatch(/“B”/);
  });
});
