import { beforeAll, describe, expect, it, vi } from "vitest";
const kernel = vi.hoisted(() => ({ runtime: null as Promise<unknown> | null }));
vi.mock("@/lib/editorMeshCore", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/editorMeshCore")>()), getManifoldRuntime: () => kernel.runtime }));
import { buildIntersectionShapeFromSelection, restoreGroupedChildren } from "@/lib/editorBooleans";
import { editorHistoryEntry } from "@/lib/editorHistory";
import { rebuildGroupFromParts } from "@/lib/groupReconstruction";
import { exportLylProject, importLylProject } from "@/lib/lylProject";
import { DEFAULT_SNAP_GRID, DEFAULT_WORKPLANE_WORKSPACE } from "@/lib/workplaneSettings";
import type { WorkplaneShape } from "@/types/layerling";
import { assertKernelLive, bodyStats, primitive, startKernel, TRIANGLE_LIMIT } from "./support";
import { openParts } from "./poseLab";

beforeAll(async () => { kernel.runtime = Promise.resolve(await startKernel()); await assertKernelLive(); });

/*
 * Build 0129 acceptance (2026-11-28): the interactive Boolean Intersection could not be completed in the app (pre-existing defect, DEFERRED-WORK F11), so an Intersection group is made the way the editor's builder makes it
 * (the production builder on two overlapping boxes), edited down to one constituent by the production strict reconstruction, saved, reopened and edited again.
 */
const base = (shapes: WorkplaneShape[]) => ({ projectId: "p", projectName: "t", createdAt: 1, modifiedAt: 2, shapes, history: [editorHistoryEntry(shapes, [])], historyIndex: 0, assets: [], workspace: DEFAULT_WORKPLANE_WORKSPACE, snapGrid: DEFAULT_SNAP_GRID, placementElevation: 0 });
const strict = (G: WorkplaneShape, parts: WorkplaneShape[], opened: readonly WorkplaneShape[]) => rebuildGroupFromParts(G, parts, { triangleLimit: TRIANGLE_LIMIT, strict: true, opened });

describe("an Intersection group of two overlapping boxes, reduced to one constituent", () => {
  it("builds, equals the constituent, saves, reopens, renders (mesh), and is editable again with a second part", async () => {
    const built = await buildIntersectionShapeFromSelection([primitive("a", "box", { width: 20, depth: 20, height: 20 }), primitive("b", "box", { x: 8, width: 20, depth: 20, height: 20 })], TRIANGLE_LIMIT);
    expect(built.group, built.failureNotice).toBeTruthy();
    const G = { ...built.group!, groupOperation: "intersection" } as WorkplaneShape;   // the editor marks the operation after the builder
    const opened = openParts(G);
    const r = await strict(G, [opened[0]], opened);
    expect(r.group, "failure" in r ? r.failure : "").toBeTruthy();
    const one = r.group!;
    expect(one.id).toBe(G.id); expect(one.groupOperation).toBe("intersection"); expect(one.groupedShapes).toHaveLength(1);
    const want = bodyStats(opened[0]);
    const got = bodyStats(one);
    expect(Math.abs(got.volume - want.volume) / want.volume).toBeLessThan(1e-6);   // the intersection of one body IS the body
    expect(got.triangles).toBeGreaterThan(0);                                       // it renders: a real mesh
    const back = (await importLylProject(await exportLylProject(base([one]) as never))).shapes[0];
    expect(back.id).toBe(one.id); expect(back.groupOperation).toBe("intersection"); expect(back.groupedShapes).toHaveLength(1);
    expect(Math.abs(bodyStats(back).volume - want.volume) / want.volume).toBeLessThan(1e-6);
    // edited again after reopening: a second part joins (as Edit Group would allow from 0130 on, or Undo), the intersection is computed again
    const reopened = openParts(back);
    const second = { ...primitive("c", "box", { x: reopened[0].x + 5, width: 20, depth: 20, height: 20 }), locked: false } as WorkplaneShape;
    const again = await strict(back, [reopened[0], second], reopened);
    expect(again.group, "failure" in again ? again.failure : "").toBeTruthy();
    expect(restoreGroupedChildren(again.group!)).toHaveLength(2);
    expect(bodyStats(again.group!).volume).toBeLessThan(want.volume);               // an intersection with a shifted box is smaller
    expect(bodyStats(again.group!).volume).toBeGreaterThan(0);
  });
});
