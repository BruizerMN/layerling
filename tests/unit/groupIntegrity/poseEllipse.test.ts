import { beforeAll, describe, expect, it, vi } from "vitest";
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
import { restoreGroupedChildren } from "@/lib/editorBooleans";
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, startKernel } from "./support";
import { bboxDev, openParts, posedGroup, primitive, rebuildPreserving, type Pose } from "./poseLab";

beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });

/*
 * Build 0127 (Bill, Q-C): an EDITED cylinder in a group stretched unevenly is stored as an ELLIPSE (a cylinder is always round; the stretched shape is not). Intentional, documented, and part of acceptance testing:
 * the geometry is preserved and the part stays parametrically editable (width, depth, height, sides), over repeated edit cycles; untouched cylinders keep their kind; with no uneven stretch a cylinder stays a cylinder.
 */
const local = () => [primitive("A", "box", { x: 0, width: 40, depth: 20, height: 30 }), primitive("C", "cylinder", { x: 34, sides: 36, width: 16, depth: 16, height: 20 }), primitive("H", "cylinder", { x: 0, hole: true, sides: 32, width: 8, depth: 8, height: 40, elevation: -5 })];
const kinds = (g: WorkplaneShape) => restoreGroupedChildren(g).map((p) => p.kind).join(",");
const cycle = async (G0: WorkplaneShape, n: number, resizeAt = 0) => {
  let G = G0; const seen: string[] = [];
  for (let c = 1; c <= n; c += 1) {
    const opened = openParts(G);
    const sign = c % 2 ? 1 : -1;
    const edited = opened.map((p) => (p.name === "C" ? { ...p, x: p.x + sign * 1.5, ...(c === resizeAt ? { width: p.width * 1.2, depth: p.depth * 1.2 } : {}) } : p));
    const r = await rebuildPreserving(G, edited, opened);
    expect(r.group, `cycle ${c}`).toBeTruthy();
    G = r.group!;
    seen.push(kinds(G));
  }
  return { G, seen };
};

describe("cylinder to ellipse under uneven stretch (documented, intentional)", () => {
  it("an edited cylinder becomes an editable ellipse, stays one over repeated cycles, and keeps its geometry", async () => {
    const G0 = await posedGroup(local(), { stretch: [2, 1.3, 0.6] });
    expect(kinds(G0)).toBe("box,ellipse,ellipse");    // opening already presents every stretched cylinder (the hole too) as an ellipse: existing behaviour
    const { G, seen } = await cycle(G0, 6);            // six move cycles: net zero
    expect(new Set(seen).size).toBe(1);               // the same kinds after every cycle: no flipping
    const c = restoreGroupedChildren(G).find((p) => p.name === "C")!;
    expect(c.kind).toBe("ellipse");
    expect(Math.abs(c.width - c.depth)).toBeGreaterThan(1e-6);     // a real ellipse
    expect(c.sides).toBeGreaterThan(8);                              // its parameters survive
    expect(G.groupedShapes!.find((p) => p.name === "C")!.kind).toBe("ellipse");
    expect(bboxDev(G, G0)).toBeLessThan(1e-3);                       // net-zero edits leave the body where it started
    // and it stays parametrically editable: resize it (both axes by 1.2) in a later session and it scales as an ellipse
    const before = restoreGroupedChildren(G).find((p) => p.name === "C")!;
    const { G: G2 } = await cycle(G, 1, 1);
    const after = restoreGroupedChildren(G2).find((p) => p.name === "C")!;
    expect(after.kind).toBe("ellipse");
    expect(after.width / before.width).toBeCloseTo(1.2, 3);
    expect(after.depth / before.depth).toBeCloseTo(1.2, 3);
  });
  it("an untouched cylinder keeps its kind, and with no uneven stretch an edited cylinder stays a cylinder", async () => {
    const G = await posedGroup(local(), { stretch: [2, 1.3, 0.6] });
    const opened = openParts(G);
    const moveBox = opened.map((p) => (p.name === "A" ? { ...p, x: p.x + 2 } : p));
    const r = await rebuildPreserving(G, moveBox, opened);
    expect(r.group!.groupedShapes!.find((p) => p.name === "C")!.kind).toBe("cylinder");   // verbatim: original kind and parameters
    for (const pose of [{}, { rotation: 20, rotationX: 35, rotationZ: 50, mirrorX: true }, { stretch: [1.7, 1.7, 1.7] }] as Pose[]) {
      const g = await posedGroup(local(), pose);
      const o = openParts(g);
      const rr = await rebuildPreserving(g, o.map((p) => (p.name === "C" ? { ...p, x: p.x + 1 } : p)), o);
      expect(rr.group!.groupedShapes!.find((p) => p.name === "C")!.kind, JSON.stringify(pose)).toBe("cylinder");
    }
  });
});
